/** What an invitation tells the trainee, read from a REAL PostgreSQL instance (RLS on). Skipped when TEST_DATABASE_URL is unset. */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Invitation course info (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/provider/provider.repository').PrismaProviderRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const admin = randomUUID();
  const recorded = randomUUID();
  const live = randomUUID();
  const plain = randomUUID();
  const foreign = randomUUID();
  const start = new Date('2030-03-01T16:00:00Z');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaProviderRepository } = require('../../src/modules/provider/provider.repository') as typeof import('../../src/modules/provider/provider.repository');
    repo = new PrismaProviderRepository();
    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.create({ data: { id: admin, tenantId: tenantA, email: 'a@a.test', passwordHash: 'x', role: 'TENANT_ADMIN' } });
      await tx.trainer.create({ data: { id: admin, tenantId: tenantA, userId: admin, fullName: 'T' } });
      await tx.course.create({ data: { id: recorded, tenantId: tenantA, trainerId: admin, title: 'Recorded one', type: 'RECORDED', price: '0.00', sourceVideoId: 'abcdefghijk', scheduleStartsAt: start } });
      await tx.module.createMany({
        data: [
          { tenantId: tenantA, courseId: recorded, title: 'Day 1', sortOrder: 1 },
          { tenantId: tenantA, courseId: recorded, title: 'Day 2', sortOrder: 2 },
          { tenantId: tenantA, courseId: recorded, title: 'Day 3', sortOrder: 3 },
        ],
      });
      await tx.course.create({ data: { id: live, tenantId: tenantA, trainerId: admin, title: 'Live one', type: 'LIVE', price: '0.00' } });
      await tx.course.create({ data: { id: plain, tenantId: tenantA, trainerId: admin, title: 'Plain', type: 'LIVE', price: '0.00' } });
      const day = 86_400_000;
      await tx.virtualClassroom.createMany({
        data: [
          { tenantId: tenantA, courseId: live, trainerId: admin, title: 'Cancelled one', startsAt: new Date(Date.now() + day), durationMinutes: 60, status: 'CANCELLED' },
          { tenantId: tenantA, courseId: live, trainerId: admin, title: 'Past one', startsAt: new Date(Date.now() - day), durationMinutes: 60 },
          { tenantId: tenantA, courseId: live, trainerId: admin, title: 'Later one', startsAt: new Date(Date.now() + 5 * day), durationMinutes: 60 },
          { tenantId: tenantA, courseId: live, trainerId: admin, title: 'Next one', startsAt: new Date(Date.now() + 2 * day), durationMinutes: 60 },
        ],
      });
    });
    await db.withTenantTransaction(tenantB, async (tx) => {
      const b = randomUUID();
      await tx.user.create({ data: { id: b, tenantId: tenantB, email: 'b@b.test', passwordHash: 'x', role: 'TENANT_ADMIN' } });
      await tx.trainer.create({ data: { id: b, tenantId: tenantB, userId: b, fullName: 'B' } });
      await tx.course.create({ data: { id: foreign, tenantId: tenantB, trainerId: b, title: 'Foreign', type: 'LIVE', price: '0.00' } });
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.virtualClassroom.deleteMany({ where: { tenantId } });
        await tx.module.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  it('a recorded course: its first day and number of days', async () => {
    expect(await repo.courseInvitationInfo(tenantA, recorded)).toEqual({ title: 'Recorded one', startsAt: start, days: 3, nextSession: null });
  });

  it('a live course: the NEXT scheduled session (not cancelled, not past, not a later one)', async () => {
    const info = await repo.courseInvitationInfo(tenantA, live);
    expect(info).toMatchObject({ title: 'Live one', startsAt: null, days: 0 });
    expect(info?.nextSession?.title).toBe('Next one');
  });

  it('a course with nothing scheduled, and other academies\' or unknown courses', async () => {
    expect(await repo.courseInvitationInfo(tenantA, plain)).toEqual({ title: 'Plain', startsAt: null, days: 0, nextSession: null });
    expect(await repo.courseInvitationInfo(tenantA, foreign)).toBeNull(); // another academy's course is invisible
    expect(await repo.courseInvitationInfo(tenantA, randomUUID() as string)).toBeNull();
  });
});
