/**
 * Trainer logins and the trainer's own page, against a REAL PostgreSQL instance (RLS on): the account is an INSTRUCTOR
 * linked to the trainer, removal keeps the trainer, and the trainer reads only their own courses, sessions and trainees.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Trainer login and trainer page (real database)', () => {
  let db: typeof import('../../src/config/database');
  let provider: import('../../src/modules/provider/provider.repository').PrismaProviderRepository;
  let portal: import('../../src/modules/provider/trainer-portal.repository').PrismaTrainerPortalRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const admin = randomUUID();
  const trainerNew = randomUUID(); // has an e-mail, no login yet
  const trainerNoEmail = randomUUID();
  const trainerTaken = randomUUID(); // e-mail already belongs to a trainee
  const trainerOther = randomUUID(); // another trainer, with their own course
  const traineeId = randomUUID();
  const traineeTwo = randomUUID();
  const courseMine = randomUUID();
  const courseOther = randomUUID();
  const classroomMine = randomUUID();
  const classroomOther = randomUUID();
  const actor = { userId: admin, role: 'TENANT_ADMIN' as const, ip: '127.0.0.1' };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaProviderRepository } = require('../../src/modules/provider/provider.repository') as typeof import('../../src/modules/provider/provider.repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaTrainerPortalRepository } = require('../../src/modules/provider/trainer-portal.repository') as typeof import('../../src/modules/provider/trainer-portal.repository');
    provider = new PrismaProviderRepository();
    portal = new PrismaTrainerPortalRepository();

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: admin, tenantId: tenantA, email: 'admin@corp.test', passwordHash: 'x', role: 'TENANT_ADMIN' },
          { id: traineeId, tenantId: tenantA, email: 'taken@corp.test', fullName: 'Trainee One', phone: '+966551110001', employeeNo: 'E-1', passwordHash: 'x', role: 'LEARNER' },
          { id: traineeTwo, tenantId: tenantA, email: 'two@corp.test', passwordHash: 'x', role: 'LEARNER' },
        ],
      });
      await tx.trainer.createMany({
        data: [
          { id: trainerNew, tenantId: tenantA, fullName: 'Trainer New', email: 'New.Trainer@Corp.Test' },
          { id: trainerNoEmail, tenantId: tenantA, fullName: 'No Email' },
          { id: trainerTaken, tenantId: tenantA, fullName: 'Taken', email: 'taken@corp.test' },
          { id: trainerOther, tenantId: tenantA, fullName: 'Other Trainer', email: 'other@corp.test' },
        ],
      });
      await tx.course.createMany({
        data: [
          { id: courseMine, tenantId: tenantA, trainerId: trainerNew, title: 'Mine', type: 'RECORDED', price: '0.00' },
          { id: courseOther, tenantId: tenantA, trainerId: trainerOther, title: 'Not mine', type: 'LIVE', price: '0.00' },
        ],
      });
      await tx.enrollment.createMany({
        data: [
          { tenantId: tenantA, userId: traineeId, courseId: courseMine, progressPercentage: '40.00' },
          { tenantId: tenantA, userId: traineeTwo, courseId: courseMine },
          { tenantId: tenantA, userId: traineeId, courseId: courseOther },
        ],
      });
      const soon = new Date(Date.now() + 3_600_000);
      await tx.virtualClassroom.createMany({
        data: [
          { id: classroomMine, tenantId: tenantA, courseId: courseMine, trainerId: trainerNew, title: 'My live', startsAt: soon, durationMinutes: 60, joinUrl: 'https://zoom.example/mine' },
          { id: classroomOther, tenantId: tenantA, courseId: courseOther, trainerId: trainerOther, title: 'Their live', startsAt: soon, durationMinutes: 60, joinUrl: 'https://zoom.example/theirs' },
        ],
      });
    });
    await db.withTenantTransaction(tenantB, async (tx) => {
      await tx.user.create({ data: { id: randomUUID(), tenantId: tenantB, email: 'new.trainer@corp.test', passwordHash: 'x', role: 'LEARNER' } });
    });
  });

  afterAll(async () => {
    await db.prisma.loginOtp.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.virtualClassroom.deleteMany({ where: { tenantId } });
        await tx.enrollment.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  const inA = <T>(fn: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>) => db.withTenantTransaction(tenantA, fn);

  it('refuses when there is nothing to give a login to: unknown trainer, no e-mail, e-mail already used here', async () => {
    expect(await provider.grantTrainerAccount(tenantA, actor, randomUUID(), 'h')).toEqual({ kind: 'not_found' });
    expect(await provider.grantTrainerAccount(tenantA, actor, trainerNoEmail, 'h')).toEqual({ kind: 'no_email' });
    expect(await provider.grantTrainerAccount(tenantA, actor, trainerTaken, 'h')).toEqual({ kind: 'email_taken' });
    expect(await provider.grantTrainerAccount(tenantB, actor, trainerNew, 'h')).toEqual({ kind: 'not_found' }); // another academy's trainer
    expect(await inA((tx) => tx.user.count({ where: { role: 'INSTRUCTOR' } }))).toBe(0);
  });

  it('creates an INSTRUCTOR login on the trainer\'s e-mail (lower-cased, even though the same address exists in another academy) and links it', async () => {
    const r = await provider.grantTrainerAccount(tenantA, actor, trainerNew, 'hash-of-a-random-secret');
    expect(r).toEqual({ kind: 'granted', email: 'new.trainer@corp.test', fullName: 'Trainer New' });
    const trainer = await inA((tx) => tx.trainer.findUniqueOrThrow({ where: { id: trainerNew }, select: { userId: true, user: { select: { email: true, role: true, fullName: true, passwordHash: true } } } }));
    expect(trainer.userId).not.toBeNull();
    expect(trainer.user).toMatchObject({ email: 'new.trainer@corp.test', role: 'INSTRUCTOR', fullName: 'Trainer New', passwordHash: 'hash-of-a-random-secret' });
    expect(await provider.grantTrainerAccount(tenantA, actor, trainerNew, 'h')).toEqual({ kind: 'already_has_account' });
    const list = await provider.listTrainers(tenantA);
    expect(list.find((t) => t.id === trainerNew)?.hasAccount).toBe(true);
  });

  it('the trainer page finds the trainer by login and shows only their own courses (with trainee counts) and sessions', async () => {
    const userId = (await inA((tx) => tx.trainer.findUniqueOrThrow({ where: { id: trainerNew }, select: { userId: true } }))).userId as string;
    expect(await portal.findTrainerByUser(tenantA, userId)).toMatchObject({ id: trainerNew, fullName: 'Trainer New' });
    expect(await portal.findTrainerByUser(tenantB, userId)).toBeNull(); // not visible from another academy
    expect(await portal.findTrainerByUser(tenantA, admin)).toBeNull(); // an admin login is not a trainer

    const courses = await portal.listCourses(tenantA, trainerNew);
    expect(courses.map((c) => [c.title, c.enrollmentCount])).toEqual([['Mine', 2]]);
    const sessions = await portal.listUpcomingSessions(tenantA, trainerNew, new Date(Date.now() - 12 * 3_600_000), 20);
    expect(sessions.map((s) => [s.title, s.joinUrl, s.courseTitle])).toEqual([['My live', 'https://zoom.example/mine', 'Mine']]);
  });

  it('lists the trainees of the trainer\'s own course with progress only, and nothing for another trainer\'s course', async () => {
    const mine = await portal.listCourseTrainees(tenantA, trainerNew, courseMine);
    expect(mine?.title).toBe('Mine');
    expect(mine?.trainees.map((t) => [t.name, t.progress, t.completionStatus])).toEqual([
      ['Trainee One', 40, 'ENROLLED'],
      ['two', 0, 'ENROLLED'], // no full name yet: the e-mail's first part, never the whole address
    ]);
    expect(Object.keys(mine?.trainees[0] ?? {}).sort()).toEqual(['completionStatus', 'enrolledAt', 'name', 'progress', 'status']);
    expect(await portal.listCourseTrainees(tenantA, trainerNew, courseOther)).toBeNull();
    expect(await portal.listCourseTrainees(tenantA, trainerOther, courseMine)).toBeNull();
  });

  it('removes the login only; the trainer, their courses and sessions stay; admins and trainees are never removed this way', async () => {
    expect(await provider.revokeTrainerAccount(tenantA, actor, trainerNew)).toBe('revoked');
    expect(await provider.revokeTrainerAccount(tenantA, actor, trainerNew)).toBe('no_account');
    expect(await provider.revokeTrainerAccount(tenantA, actor, randomUUID())).toBe('not_found');
    await inA(async (tx) => {
      const t = await tx.trainer.findUniqueOrThrow({ where: { id: trainerNew }, select: { userId: true } });
      expect(t.userId).toBeNull();
      expect(await tx.user.count({ where: { email: 'new.trainer@corp.test', role: 'INSTRUCTOR' } })).toBe(0);
      expect(await tx.course.count({ where: { id: courseMine } })).toBe(1);
      expect(await tx.virtualClassroom.count({ where: { id: classroomMine } })).toBe(1);
      // a trainer record linked to a NON-instructor login is left alone
      await tx.trainer.update({ where: { id: trainerOther }, data: { userId: traineeTwo } });
    });
    expect(await provider.revokeTrainerAccount(tenantA, actor, trainerOther)).toBe('no_account');
    expect(await inA((tx) => tx.user.count({ where: { id: traineeTwo } }))).toBe(1);
  });

  it('records grant and removal in the audit log without the e-mail address', async () => {
    const log = await inA((tx) => tx.auditLog.findMany({ where: { tenantId: tenantA, action: { in: ['trainer.account_granted', 'trainer.account_revoked'] } }, orderBy: { createdAt: 'asc' }, select: { action: true, metadata: true } }));
    expect(log.map((l) => l.action)).toEqual(['trainer.account_granted', 'trainer.account_revoked']);
    expect(JSON.stringify(log)).not.toContain('corp.test');
  });
});
