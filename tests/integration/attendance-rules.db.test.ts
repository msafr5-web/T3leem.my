/**
 * Per-course attendance rules and manual decisions against a REAL PostgreSQL instance (RLS on).
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import { CapturingMailer } from './helpers/registration-fakes';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Attendance rules and manual decisions (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/attendance/attendance.repository').PrismaAttendanceRepository;
  let service: import('../../src/modules/attendance/attendance.service').AttendanceService;
  let sweeper: import('../../src/modules/attendance/attendance.sweeper').AttendanceSweeper;
  const clock = { now: new Date('2027-04-01T10:00:00+03:00') };
  const at = (hhmm: string) => new Date(`2027-04-01T${hhmm}:00+03:00`);

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const admin = randomUUID();
  const trainer = randomUUID();
  const t1 = randomUUID();
  const t2 = randomUUID();
  const course = randomUUID();
  const courseB = randomUUID();
  const classroom = randomUUID();
  const otpNoop = { request: async () => ({ challengeId: 'x', expiresInSec: 1 }), confirm: async () => undefined };

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
    const { AttendanceSweeper } = require('../../src/modules/attendance/attendance.sweeper') as typeof import('../../src/modules/attendance/attendance.sweeper');
    repo = new PrismaAttendanceRepository();
    service = new AttendanceService({ repository: repo, otp: otpNoop, clock: () => clock.now });
    sweeper = new AttendanceSweeper({ repository: repo, service, mailer: new CapturingMailer(), clock: () => clock.now });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: admin, tenantId: tenantA, email: 'hr@a.test', passwordHash: 'x', role: 'TENANT_ADMIN' },
          { id: trainer, tenantId: tenantA, email: 'tr@a.test', passwordHash: 'x', role: 'INSTRUCTOR' },
          { id: t1, tenantId: tenantA, email: 't1@a.test', fullName: 'Trainee 1', passwordHash: 'x', role: 'LEARNER' },
          { id: t2, tenantId: tenantA, email: 't2@a.test', fullName: 'Trainee 2', passwordHash: 'x', role: 'LEARNER' },
        ],
      });
      await tx.trainer.create({ data: { id: trainer, tenantId: tenantA, userId: trainer, fullName: 'Trainer' } });
      await tx.course.create({ data: { id: course, tenantId: tenantA, trainerId: trainer, title: 'Course', type: 'LIVE', price: '0.00' } });
      await tx.virtualClassroom.create({ data: { id: classroom, tenantId: tenantA, courseId: course, trainerId: trainer, title: 'Lecture', startsAt: at('10:00'), durationMinutes: 60 } });
      await tx.enrollment.createMany({
        data: [
          { tenantId: tenantA, userId: t1, courseId: course, source: 'ADMIN' },
          { tenantId: tenantA, userId: t2, courseId: course, source: 'ADMIN' },
        ],
      });
    });
    await db.withTenantTransaction(tenantB, async (tx) => {
      const b = randomUUID();
      await tx.user.create({ data: { id: b, tenantId: tenantB, email: 'b@b.test', passwordHash: 'x', role: 'INSTRUCTOR' } });
      await tx.trainer.create({ data: { id: b, tenantId: tenantB, userId: b, fullName: 'B' } });
      await tx.course.create({ data: { id: courseB, tenantId: tenantB, trainerId: b, title: 'B course', type: 'LIVE', price: '0.00' } });
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.attendanceAlert.deleteMany({ where: { tenantId } });
        await tx.attendanceInterval.deleteMany({ where: { tenantId } });
        await tx.sessionAttendance.deleteMany({ where: { tenantId } });
        await tx.virtualClassroom.deleteMany({ where: { tenantId } });
        await tx.enrollment.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  const inA = <T>(fn: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>) => db.withTenantTransaction(tenantA, fn);
  const session = async () => (await repo.getSession(tenantA, 'LIVE', classroom))!;
  const statusOf = async (userId: string) => (await inA((tx) => tx.sessionAttendance.findUnique({ where: { userId_kind_sessionRef: { userId, kind: 'LIVE', sessionRef: classroom } } })));

  it('sessions carry the defaults until the course has its own rules, then those', async () => {
    expect((await session()).rules).toEqual({ lateFraction: 0.1, leaveGraceMinutes: 5, passPercent: 85 });
    expect(await repo.updateCourseSettings(tenantA, admin, course, { latePercent: 25, leaveGraceMinutes: 15, passPercent: 70 })).toBe(true);
    expect((await session()).rules).toEqual({ lateFraction: 0.25, leaveGraceMinutes: 15, passPercent: 70 });
    expect(await repo.courseInfo(tenantA, course)).toEqual({ title: 'Course', settings: { latePercent: 25, leaveGraceMinutes: 15, passPercent: 70 } });
    expect(await repo.updateCourseSettings(tenantA, admin, courseB, { latePercent: 10, leaveGraceMinutes: null, passPercent: null })).toBe(false); // another academy's course
    expect(await db.withTenantTransaction(tenantB, (tx) => tx.course.findUniqueOrThrow({ where: { id: courseB }, select: { attendanceLatePercent: true } }))).toEqual({ attendanceLatePercent: null });
  });

  it('the database itself refuses values outside the allowed ranges', async () => {
    for (const data of [{ attendanceLatePercent: 0 }, { attendanceLatePercent: 51 }, { attendanceLeaveGraceMinutes: 31 }, { attendancePassPercent: 49 }, { attendancePassPercent: 101 }]) {
      await expect(inA((tx) => tx.course.update({ where: { id: course }, data }))).rejects.toThrow();
    }
  });

  it('settling uses the course rules: a check-in at 10:10 is PRESENT under 25% (15 min) but LATE under the default', async () => {
    const s = await session();
    await repo.recordCheckIn(tenantA, t1, s, at('10:10'));
    clock.now = at('11:06');
    await sweeper.sweepTenant(tenantA, 'A');
    expect((await statusOf(t1))?.status).toBe('PRESENT');

    // back to the defaults: the old result is cleared and the next settling recomputes it
    await repo.updateCourseSettings(tenantA, admin, course, { latePercent: null, leaveGraceMinutes: null, passPercent: null });
    expect((await statusOf(t1))?.finalizedAt).toBeNull();
    await sweeper.sweepTenant(tenantA, 'A');
    expect((await statusOf(t1))?.status).toBe('LATE');
  });

  it("a manual decision is stored with its reason, survives settling and a rules change, and can be taken back", async () => {
    const s = await session();
    // t2 never checked in and the earlier settling already computed ABSENT for them: that is the status the decision replaces
    expect(await repo.setManualStatus(tenantA, admin, t2, s, 'PRESENT', 'Confirmed by the HR manager', at('11:30'))).toBe('ABSENT');
    const row = await statusOf(t2);
    expect(row).toMatchObject({ status: 'PRESENT', source: 'MANUAL', note: 'Confirmed by the HR manager', adjustedBy: admin });
    expect(row?.finalizedAt).not.toBeNull();

    clock.now = at('11:40');
    await sweeper.sweepTenant(tenantA, 'A'); // would compute ABSENT for t2 (never checked in)
    expect((await statusOf(t2))?.status).toBe('PRESENT');
    await repo.updateCourseSettings(tenantA, admin, course, { latePercent: 20, leaveGraceMinutes: null, passPercent: null });
    expect(await statusOf(t2)).toMatchObject({ status: 'PRESENT', source: 'MANUAL' }); // a rules change keeps the decision
    expect((await statusOf(t1))?.status).toBe('PENDING'); // ...but un-settles the automatic result

    expect(await repo.setManualStatus(tenantA, admin, t2, s, 'ABSENT', 'Changed my mind after the report', at('11:50'))).toBe('PRESENT'); // returns the previous status
    expect(await repo.clearManualStatus(tenantA, admin, t2, s)).toBe(true);
    expect(await repo.clearManualStatus(tenantA, admin, t2, s)).toBe(false); // nothing left to take back
    expect(await statusOf(t2)).toMatchObject({ source: 'OTP', note: null, adjustedBy: null, status: 'PENDING' });
    await sweeper.sweepTenant(tenantA, 'A');
    expect((await statusOf(t2))?.status).toBe('ABSENT'); // the automatic result applies again
  });

  it('the report shows manual decisions with their reason and counts them in the percentage; the audit trail has ids and states only', async () => {
    const s = await session();
    await repo.setManualStatus(tenantA, admin, t2, s, 'LATE', 'Arrived late, confirmed by the trainer', at('12:00'));
    clock.now = at('12:10');
    const report = await service.courseReport(tenantA, course);
    const row = report.trainees.find((t) => t.userId === t2)!;
    expect(row.statuses[classroom]).toBe('LATE');
    expect(row.adjusted).toEqual({ [classroom]: 'Arrived late, confirmed by the trainer' });
    expect(row.summary).toMatchObject({ held: 1, attended: 1, late: 1, percent: 100 });
    expect(report.rules.lateFraction).toBe(0.2);
    expect(report.settings).toEqual({ latePercent: 20, leaveGraceMinutes: null, passPercent: null });

    const log = await inA((tx) => tx.auditLog.findMany({ where: { tenantId: tenantA, action: { startsWith: 'attendance.' } }, select: { action: true, metadata: true } }));
    expect(new Set(log.map((l) => l.action))).toEqual(new Set(['attendance.rules_changed', 'attendance.adjusted', 'attendance.adjustment_reverted']));
    expect(JSON.stringify(log)).not.toMatch(/a\.test|Trainee|Confirmed by/); // no e-mail, name or reason text in the audit rows
  });
});
