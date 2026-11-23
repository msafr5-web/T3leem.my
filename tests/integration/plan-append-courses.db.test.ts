/**
 * Appending recorded courses to a training plan, against a REAL PostgreSQL instance (RLS on): order, duplicates,
 * and academy isolation. Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Recorded courses appended to a training plan (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/lms/recorded/recorded.repository').PrismaRecordedCourseRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const adminA = randomUUID();
  const adminB = randomUUID();
  const planA = randomUUID();
  const planB = randomUUID();
  const c1 = randomUUID();
  const c2 = randomUUID();
  const c3 = randomUUID();
  const foreign = randomUUID(); // a course of academy B
  const actor = { userId: adminA, role: 'TENANT_ADMIN' as const, ip: '127.0.0.1' };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaRecordedCourseRepository } = require('../../src/modules/lms/recorded/recorded.repository') as typeof import('../../src/modules/lms/recorded/recorded.repository');
    repo = new PrismaRecordedCourseRepository();

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    for (const [tenantId, userId, planId, courses] of [
      [tenantA, adminA, planA, [c1, c2, c3]],
      [tenantB, adminB, planB, [foreign]],
    ] as const) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.user.create({ data: { id: userId, tenantId, email: `admin@${tenantId}.test`, passwordHash: 'x', role: 'TENANT_ADMIN' } });
        await tx.trainer.create({ data: { id: userId, tenantId, userId, fullName: 'Trainer' } });
        await tx.trainingPlan.create({ data: { id: planId, tenantId, title: 'Plan', type: 'DEVELOPMENT' } });
        for (const id of courses) await tx.course.create({ data: { id, tenantId, trainerId: userId, title: `C ${id}`, type: 'RECORDED', price: '0.00' } });
      });
    }
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.trainingPlan.deleteMany({ where: { tenantId } }); // plan courses cascade
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  const planCourses = (tenantId: string, planId: string) =>
    db.withTenantTransaction(tenantId, (tx) => tx.trainingPlanCourse.findMany({ where: { planId }, orderBy: { sortOrder: 'asc' }, select: { courseId: true, sortOrder: true } }));

  it('knows its own trainers and plans only (RLS), not another academy\'s', async () => {
    expect(await repo.trainerExists(tenantA, adminA)).toBe(true);
    expect(await repo.trainerExists(tenantA, adminB)).toBe(false);
    expect(await repo.planExists(tenantA, planA)).toBe(true);
    expect(await repo.planExists(tenantA, planB)).toBe(false);
  });

  it('appends at the end in the given order, then skips courses that are already in the plan', async () => {
    expect(await repo.appendCoursesToPlan(tenantA, actor, planA, [c1, c2])).toBe(true);
    expect(await repo.appendCoursesToPlan(tenantA, actor, planA, [c2, c3])).toBe(true);
    expect((await planCourses(tenantA, planA)).map((r) => [r.courseId, r.sortOrder])).toEqual([
      [c1, 0],
      [c2, 1],
      [c3, 2],
    ]);
  });

  it("never links another academy's course, and an unknown plan answers false", async () => {
    expect(await repo.appendCoursesToPlan(tenantA, actor, planA, [foreign])).toBe(true);
    expect(await planCourses(tenantA, planA)).toHaveLength(3); // unchanged
    expect(await repo.appendCoursesToPlan(tenantA, actor, randomUUID(), [c1])).toBe(false);
    expect(await repo.appendCoursesToPlan(tenantA, actor, planB, [c1])).toBe(false); // B's plan is invisible to A
  });

  it('records what was added, as a count', async () => {
    const log = await db.withTenantTransaction(tenantA, (tx) => tx.auditLog.findMany({ where: { tenantId: tenantA, action: 'plan.courses_added' }, orderBy: { createdAt: 'asc' }, select: { metadata: true } }));
    expect(log.map((l) => l.metadata)).toEqual([{ added: 2 }, { added: 1 }, { added: 0 }, { added: 0 }].slice(0, log.length));
    expect(log.length).toBeGreaterThanOrEqual(3);
  });
});
