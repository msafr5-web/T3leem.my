/**
 * The owner's attendance summary against a REAL PostgreSQL instance: each live academy is read under its own isolation,
 * suspended academies are left out of the summary (but can still be opened by id), figures match the academy's own report.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import { CapturingMailer } from './helpers/registration-fakes';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Owner attendance summary (real database)', () => {
  let db: typeof import('../../src/config/database');
  let owner: import('../../src/modules/attendance/attendance.owner').OwnerAttendanceService;
  const clock = { now: new Date('2027-05-01T12:00:00+03:00') };
  const at = (hhmm: string) => new Date(`2027-05-01T${hhmm}:00+03:00`);

  const tenantA = randomUUID(); // live: 2 company trainees, one attends, one is absent
  const tenantB = randomUUID(); // live: nothing held yet
  const tenantS = randomUUID(); // suspended
  const ids = { a: { admin: randomUUID(), t1: randomUUID(), t2: randomUUID(), course: randomUUID(), room: randomUUID() }, b: { admin: randomUUID(), course: randomUUID(), room: randomUUID(), t1: randomUUID() }, s: { admin: randomUUID(), course: randomUUID(), room: randomUUID(), t1: randomUUID() } };

  async function seed(tenantId: string, name: string, status: 'ACTIVE' | 'SUSPENDED', x: { admin: string; course: string; room: string; t1: string; t2?: string }, startsAt: Date): Promise<void> {
    await db.prisma.tenant.create({ data: { id: tenantId, name, slug: `${name.toLowerCase().replace(/\W/g, '')}-${tenantId.slice(0, 8)}`, status } });
    await db.withTenantTransaction(tenantId, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: x.admin, tenantId, email: `admin@${tenantId}.test`, passwordHash: 'x', role: 'TENANT_ADMIN' },
          { id: x.t1, tenantId, email: `t1@${tenantId}.test`, fullName: 'T1', passwordHash: 'x', role: 'LEARNER' },
          ...(x.t2 ? [{ id: x.t2, tenantId, email: `t2@${tenantId}.test`, fullName: 'T2', passwordHash: 'x', role: 'LEARNER' as const }] : []),
        ],
      });
      await tx.trainer.create({ data: { id: x.admin, tenantId, userId: x.admin, fullName: 'Trainer' } });
      await tx.course.create({ data: { id: x.course, tenantId, trainerId: x.admin, title: `${name} course`, type: 'LIVE', price: '0.00' } });
      await tx.virtualClassroom.create({ data: { id: x.room, tenantId, courseId: x.course, trainerId: x.admin, title: 'Lecture', startsAt, durationMinutes: 60 } });
      await tx.enrollment.createMany({ data: [x.t1, ...(x.t2 ? [x.t2] : [])].map((userId) => ({ tenantId, userId, courseId: x.course, source: 'ADMIN' })) });
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaAttendanceRepository } = require('../../src/modules/attendance/attendance.repository') as typeof import('../../src/modules/attendance/attendance.repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AttendanceService } = require('../../src/modules/attendance/attendance.service') as typeof import('../../src/modules/attendance/attendance.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OwnerAttendanceService } = require('../../src/modules/attendance/attendance.owner') as typeof import('../../src/modules/attendance/attendance.owner');
    void CapturingMailer;
    const repo = new PrismaAttendanceRepository();
    const service = new AttendanceService({ repository: repo, otp: { request: async () => ({ challengeId: 'x', expiresInSec: 1 }), confirm: async () => undefined }, clock: () => clock.now });
    owner = new OwnerAttendanceService({ repository: repo, service });

    await seed(tenantA, 'AcademyA', 'ACTIVE', ids.a, at('10:00')); // held (ended 11:00, now 12:00)
    await seed(tenantB, 'AcademyB', 'ACTIVE', ids.b, at('20:00')); // still ahead
    await seed(tenantS, 'AcademyS', 'SUSPENDED', ids.s, at('10:00'));
    // academy A: T1 checked in on time (present), T2 never did (absent)
    await db.withTenantTransaction(tenantA, (tx) => tx.sessionAttendance.create({ data: { tenantId: tenantA, userId: ids.a.t1, courseId: ids.a.course, kind: 'LIVE', sessionRef: ids.a.room, startsAt: at('10:00'), endsAt: at('11:00'), otpVerifiedAt: at('09:58') } }));
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB, tenantS]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.sessionAttendance.deleteMany({ where: { tenantId } });
        await tx.virtualClassroom.deleteMany({ where: { tenantId } });
        await tx.enrollment.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB, tenantS] } } });
    await db.prisma.$disconnect();
  });

  it('lists the live academies with their figures, leaves the suspended one out, and totals them', async () => {
    const { academies, totals } = await owner.summary();
    const mine = academies.filter((a) => ([tenantA, tenantB, tenantS] as string[]).includes(a.tenantId));
    expect(mine.map((a) => a.name)).toEqual(['AcademyA', 'AcademyB']); // sorted by name; the suspended academy is not in the summary
    const a = mine.find((x) => x.tenantId === tenantA)!;
    expect(a).toMatchObject({ courses: 1, heldSessions: 1, trainees: 2, passingTrainees: 1, attendancePercent: 50, lateSlots: 0, absentSlots: 1 });
    expect(mine.find((x) => x.tenantId === tenantB)).toMatchObject({ courses: 1, heldSessions: 0, trainees: 1, passingTrainees: 0, attendancePercent: null });
    expect(totals.academies).toBeGreaterThanOrEqual(2);
    expect(totals.heldSessions).toBeGreaterThanOrEqual(1);
  });

  it("opens an academy's course rows by id, even a suspended academy's, matching what its admin would see", async () => {
    const rowsA = await owner.courses(tenantA);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({ courseId: ids.a.course, title: 'AcademyA course', sessions: 1, held: 1, trainees: 2, passingTrainees: 1, heldSlots: 2, attendedSlots: 1, lateSlots: 0 });
    const rowsS = await owner.courses(tenantS);
    expect(rowsS[0]).toMatchObject({ held: 1, trainees: 1, passingTrainees: 0, heldSlots: 1, attendedSlots: 0 }); // its only trainee never checked in
    expect(await owner.courses(randomUUID() as string)).toEqual([]);
  });
});
