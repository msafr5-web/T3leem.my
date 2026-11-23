/**
 * Attendance against a REAL PostgreSQL instance (RLS on): sessions from classrooms and recorded days, Zoom intervals,
 * the late alert (once, to the admin, only about the company's own trainees), settling, the report, and erasure.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import { CapturingMailer } from './helpers/registration-fakes';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Attendance and check-out (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/attendance/attendance.repository').PrismaAttendanceRepository;
  let service: import('../../src/modules/attendance/attendance.service').AttendanceService;
  let sweeper: import('../../src/modules/attendance/attendance.sweeper').AttendanceSweeper;
  const clock = { now: new Date('2027-03-01T10:00:00+03:00') };
  const mailer = new CapturingMailer();
  const at = (hhmm: string, day = '2027-03-01') => new Date(`${day}T${hhmm}:00+03:00`);

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const admin = randomUUID();
  const trainer = randomUUID();
  const t1 = randomUUID(); // company trainee: checks in on time, stays
  const t2 = randomUUID(); // company trainee: never checks in
  const t3 = randomUUID(); // self-enrolled learner: tracked, but never chased
  const t4 = randomUUID(); // company trainee: checks in late
  const t5 = randomUUID(); // company trainee: checks in, leaves early
  const stranger = randomUUID(); // not enrolled
  const liveCourse = randomUUID();
  const recCourse = randomUUID();
  const classroom = randomUUID();
  const mod1 = randomUUID();
  const mod2 = randomUUID();
  const lessonA = randomUUID();
  const lessonB = randomUUID();
  const lessonC = randomUUID();
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
    sweeper = new AttendanceSweeper({ repository: repo, service, mailer, clock: () => clock.now });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Hila Co', slug: `hila-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'Other', slug: `other-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: admin, tenantId: tenantA, email: 'hr@hila.test', fullName: 'HR Manager', passwordHash: 'x', role: 'TENANT_ADMIN' },
          { id: trainer, tenantId: tenantA, email: 'trainer@hila.test', passwordHash: 'x', role: 'INSTRUCTOR' },
          ...[t1, t2, t3, t4, t5, stranger].map((id, i) => ({ id, tenantId: tenantA, email: `u${i + 1}@hila.test`, fullName: `Trainee ${i + 1}`, passwordHash: 'x', role: 'LEARNER' as const })),
        ],
      });
      await tx.trainer.create({ data: { id: trainer, tenantId: tenantA, userId: trainer, fullName: 'Trainer' } });
      await tx.course.create({ data: { id: liveCourse, tenantId: tenantA, trainerId: trainer, title: 'Live course', type: 'LIVE', price: '0.00' } });
      await tx.course.create({
        data: {
          id: recCourse, tenantId: tenantA, trainerId: trainer, title: 'Recorded course', type: 'RECORDED', price: '0.00', sourceVideoId: 'abcdefghijk', sourceDurationSeconds: 2400,
          scheduleConfig: { breakMinutes: 5, discussionMinutes: 15 }, scheduleStartsAt: at('19:00'),
        },
      });
      await tx.virtualClassroom.create({ data: { id: classroom, tenantId: tenantA, courseId: liveCourse, trainerId: trainer, title: 'Live lecture', startsAt: at('10:00'), durationMinutes: 60, joinUrl: 'https://zoom.example/x' } });
      // Day 1: two lectures of 10 minutes = 20 + 5 + 15 = 40 minutes (19:00-19:40). Day 2 (a day later): one lecture of 10 minutes.
      await tx.module.createMany({
        data: [
          { id: mod1, tenantId: tenantA, courseId: recCourse, title: 'Day 1', sortOrder: 1 },
          { id: mod2, tenantId: tenantA, courseId: recCourse, title: 'Day 2', sortOrder: 2 },
        ],
      });
      await tx.lesson.createMany({
        data: [
          { id: lessonA, tenantId: tenantA, moduleId: mod1, title: 'A', contentType: 'YOUTUBE', sortOrder: 0, startSecond: 0, endSecond: 600 },
          { id: lessonB, tenantId: tenantA, moduleId: mod1, title: 'B', contentType: 'YOUTUBE', sortOrder: 1, startSecond: 600, endSecond: 1200 },
          { id: lessonC, tenantId: tenantA, moduleId: mod2, title: 'C', contentType: 'YOUTUBE', sortOrder: 0, startSecond: 1200, endSecond: 1800 },
        ],
      });
      await tx.enrollment.createMany({
        data: [
          { tenantId: tenantA, userId: t1, courseId: liveCourse, source: 'ADMIN' },
          { tenantId: tenantA, userId: t2, courseId: liveCourse, source: 'ADMIN' },
          { tenantId: tenantA, userId: t3, courseId: liveCourse, source: 'SELF' },
          { tenantId: tenantA, userId: t4, courseId: liveCourse, source: 'ADMIN' },
          { tenantId: tenantA, userId: t5, courseId: liveCourse, source: 'ADMIN' },
          { tenantId: tenantA, userId: t1, courseId: recCourse, source: 'ADMIN' },
          { tenantId: tenantA, userId: t2, courseId: recCourse, source: 'ADMIN' },
        ],
      });
    });
    await db.withTenantTransaction(tenantB, async (tx) => {
      await tx.user.create({ data: { id: randomUUID(), tenantId: tenantB, email: 'hr@other.test', passwordHash: 'x', role: 'TENANT_ADMIN' } });
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.attendanceAlert.deleteMany({ where: { tenantId } });
        await tx.attendanceInterval.deleteMany({ where: { tenantId } });
        await tx.sessionAttendance.deleteMany({ where: { tenantId } });
        await tx.lessonProgress.deleteMany({ where: { tenantId } });
        await tx.virtualClassroom.deleteMany({ where: { tenantId } });
        await tx.enrollment.deleteMany({ where: { tenantId } });
        await tx.lesson.deleteMany({ where: { tenantId } });
        await tx.module.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  const live = async () => (await repo.getSession(tenantA, 'LIVE', classroom))!;
  const inA = <T>(fn: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>) => db.withTenantTransaction(tenantA, fn);

  it('builds sessions from classrooms and from the days of a dated recorded course (day N a day later, same time, its own length)', async () => {
    const sessions = await repo.listSessions(tenantA, at('00:00'), at('23:59', '2027-03-03'));
    expect(sessions.map((s) => [s.kind, s.title, s.startsAt.toISOString(), (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000])).toEqual([
      ['LIVE', 'Live lecture', at('10:00').toISOString(), 60],
      ['DAY', 'Recorded course — Day 1', at('19:00').toISOString(), 40],
      ['DAY', 'Recorded course — Day 2', at('19:00', '2027-03-02').toISOString(), 25], // 10 min video + 15 discussion
    ]);
    expect((await live()).joinUrl).toBe('https://zoom.example/x');
    expect(await repo.listSessions(tenantB, at('00:00'), at('23:59', '2027-03-03'))).toEqual([]); // another academy sees nothing
    expect(await repo.listSessions(tenantA, at('00:00'), at('23:59', '2027-03-03'), recCourse)).toHaveLength(2);
    expect((await repo.courseInfo(tenantA, liveCourse))?.title).toBe('Live course');
    expect(await repo.courseInfo(tenantB, liveCourse)).toBeNull();
  });

  it('the first check-in is the one that counts', async () => {
    const s = await live();
    const first = await repo.recordCheckIn(tenantA, t1, s, at('09:58'));
    const again = await repo.recordCheckIn(tenantA, t1, s, at('10:30'));
    expect(first.otpVerifiedAt).toEqual(at('09:58'));
    expect(again.otpVerifiedAt).toEqual(at('09:58'));
  });

  it('Zoom: finds the trainee by e-mail among the course\'s ACTIVE enrollments, keeps one open interval, and a leave closes it', async () => {
    expect(await repo.findTraineeByEmail(tenantA, liveCourse, 'U1@hila.test')).toBe(t1);
    expect(await repo.findTraineeByEmail(tenantA, liveCourse, 'u6@hila.test')).toBeNull(); // not enrolled
    await service.onZoomPresence(tenantA, classroom, 'u1@hila.test', 'join', at('10:01'));
    await service.onZoomPresence(tenantA, classroom, 'u1@hila.test', 'join', at('10:01')); // a repeated event
    await service.onZoomPresence(tenantA, classroom, 'u1@hila.test', 'leave', at('10:20'));
    await service.onZoomPresence(tenantA, classroom, 'u1@hila.test', 'join', at('10:25'));
    await service.onZoomPresence(tenantA, classroom, 'u1@hila.test', 'leave', at('11:00'));
    await service.onZoomPresence(tenantA, classroom, 'u5@hila.test', 'leave', at('10:30')); // a leave whose join was missed
    const rows = await inA((tx) => tx.attendanceInterval.findMany({ where: { sessionRef: classroom, userId: t1 }, orderBy: { joinedAt: 'asc' } }));
    expect(rows.map((r) => [r.joinedAt.toISOString(), r.leftAt?.toISOString()])).toEqual([
      [at('10:01').toISOString(), at('10:20').toISOString()],
      [at('10:25').toISOString(), at('11:00').toISOString()],
    ]);
    const t5rows = await inA((tx) => tx.attendanceInterval.findMany({ where: { userId: t5 } }));
    expect(t5rows.map((r) => [r.joinedAt.toISOString(), r.leftAt?.toISOString()])).toEqual([[at('10:00').toISOString(), at('10:30').toISOString()]]);
  });

  it('the late alert: not before 25 minutes; then ONE e-mail to the admin naming only the company trainees who have not checked in', async () => {
    const s = await live();
    // t4 checks in late (after the 6-minute mark), t5 checks in; t2 and t3 never do
    await repo.recordCheckIn(tenantA, t4, s, at('10:07'));
    await repo.recordCheckIn(tenantA, t5, s, at('10:02'));

    clock.now = at('10:24');
    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).alerts).toBe(0);
    expect(mailer.sent).toHaveLength(0);

    clock.now = at('10:26');
    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).alerts).toBe(1);
    expect(mailer.sent.map((m) => m.to)).toEqual(['hr@hila.test']); // the admin, never a trainee
    const body = mailer.sent[0]!.text;
    expect(body).toContain('Trainee 2'); // t2: company trainee, no check-in
    expect(body).not.toContain('Trainee 3'); // t3 enrolled herself: not chased
    expect(body).not.toContain('Trainee 1');
    expect(body).toContain('Live lecture');
    expect(mailer.sent[0]!.subject).toContain('1 متدرب');

    clock.now = at('10:40');
    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).alerts).toBe(0); // once per session
    expect(mailer.sent).toHaveLength(1);
    const alert = await inA((tx) => tx.attendanceAlert.findFirstOrThrow({ where: { sessionRef: classroom } }));
    expect(alert.absentCount).toBe(1);
    expect(alert.sentAt).not.toBeNull();
  });

  it('settles finished sessions: PRESENT, LATE, ABSENT (never checked in / left early), once; and the report agrees', async () => {
    clock.now = at('11:04'); // 4 minutes after the end: not yet
    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).settled).toBe(0);
    clock.now = at('11:06');
    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).settled).toBeGreaterThanOrEqual(1);
    const rows = await inA((tx) => tx.sessionAttendance.findMany({ where: { kind: 'LIVE', sessionRef: classroom } }));
    const by = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(by[t1]?.status).toBe('PRESENT'); // checked in 09:58, in the call until 11:00
    expect(by[t4]?.status).toBe('LATE'); // 10:07 is after the 10:06 mark; no Zoom data: the check-in decides
    expect(by[t5]?.status).toBe('ABSENT'); // checked in, but left at 10:30
    expect(by[t2]?.status).toBe('ABSENT');
    expect(by[t3]?.status).toBe('ABSENT'); // tracked too, even though never chased
    expect(by[stranger]).toBeUndefined(); // not enrolled: no row
    expect(rows.every((r) => r.finalizedAt)).toBe(true);
    expect(by[t1]?.attendedSeconds).toBe((19 + 35) * 60);

    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).settled).toBe(0); // nothing left to settle

    const report = await service.courseReport(tenantA, liveCourse);
    const row = (id: string) => report.trainees.find((t) => t.userId === id)!;
    expect(row(t1).summary).toMatchObject({ held: 1, attended: 1, percent: 100, passes: true });
    expect(row(t4).summary).toMatchObject({ attended: 1, late: 1, passes: true });
    expect(row(t2).summary).toMatchObject({ attended: 0, percent: 0, passes: false });
    expect(report.passingTrainees).toBe(2);
  });

  it('recorded days: check-in on time + every lesson of the day finished within the day = PRESENT; unfinished = ABSENT', async () => {
    const day1 = (await repo.listSessions(tenantA, at('00:00'), at('23:59'), recCourse)).find((s) => s.ref === mod1)!;
    await repo.recordCheckIn(tenantA, t1, day1, at('18:58'));
    await repo.recordCheckIn(tenantA, t2, day1, at('19:02'));
    await inA(async (tx) => {
      const e1 = await tx.enrollment.findFirstOrThrow({ where: { userId: t1, courseId: recCourse } });
      const e2 = await tx.enrollment.findFirstOrThrow({ where: { userId: t2, courseId: recCourse } });
      await tx.lessonProgress.createMany({
        data: [
          { tenantId: tenantA, enrollmentId: e1.id, lessonId: lessonA, completedAt: at('19:12') },
          { tenantId: tenantA, enrollmentId: e1.id, lessonId: lessonB, completedAt: at('19:30') },
          { tenantId: tenantA, enrollmentId: e2.id, lessonId: lessonA, completedAt: at('19:12') }, // t2 finished only one of the two
        ],
      });
    });
    const ev = await repo.loadEvidence(tenantA, day1, [t1, t2]);
    expect(ev.get(t1)?.dayCompletedAt).toEqual(at('19:30'));
    expect(ev.get(t2)?.dayCompletedAt).toBeNull();

    clock.now = at('19:50');
    await sweeper.sweepTenant(tenantA, 'Hila Co');
    const rows = await inA((tx) => tx.sessionAttendance.findMany({ where: { kind: 'DAY', sessionRef: mod1 } }));
    const by = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(by[t1]?.status).toBe('PRESENT');
    expect(by[t1]?.lastLeaveAt).toEqual(at('19:30')); // finishing the day is the check-out
    expect(by[t2]?.status).toBe('ABSENT');
  });

  it('the alert is retried while the session still runs when the e-mail fails', async () => {
    // a second live session, 20:00-21:00, nobody has checked in to it
    const second = randomUUID();
    await inA((tx) => tx.virtualClassroom.create({ data: { id: second, tenantId: tenantA, courseId: liveCourse, trainerId: trainer, title: 'Second lecture', startsAt: at('20:00'), durationMinutes: 60 } }));
    const before = mailer.sent.length;
    clock.now = at('20:26');
    mailer.failNext = true;
    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).alerts).toBe(0); // SMTP down: not sent...
    const unsent = await inA((tx) => tx.attendanceAlert.findFirstOrThrow({ where: { sessionRef: second } }));
    expect(unsent.sentAt).toBeNull(); // ...and remembered as unsent
    clock.now = at('20:27');
    expect((await sweeper.sweepTenant(tenantA, 'Hila Co')).alerts).toBe(1); // retried
    expect(mailer.sent.length).toBe(before + 1);
    expect(mailer.sent.at(-1)?.text).toContain('Second lecture');
  });

  it('erasing a trainee removes their attendance too (cascade)', async () => {
    expect(await inA((tx) => tx.sessionAttendance.count({ where: { userId: t5 } }))).toBeGreaterThan(0);
    await inA(async (tx) => {
      await tx.enrollment.deleteMany({ where: { userId: t5 } });
      await tx.user.delete({ where: { id: t5 } });
    });
    expect(await inA((tx) => tx.sessionAttendance.count({ where: { userId: t5 } }))).toBe(0);
    expect(await inA((tx) => tx.attendanceInterval.count({ where: { userId: t5 } }))).toBe(0);
  });
});
