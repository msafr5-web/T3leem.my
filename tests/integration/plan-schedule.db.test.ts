/**
 * Plan scheduling against a REAL PostgreSQL instance (RLS on): day lengths read from stored courses, ordering by start date,
 * the overlap rule through plan create/update and through a moved start date. Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Plan scheduling: order by start date and no overlap (real database)', () => {
  let db: typeof import('../../src/config/database');
  let recorded: import('../../src/modules/lms/recorded/recorded.repository').PrismaRecordedCourseRepository;
  let provider: import('../../src/modules/provider/provider.service').ProviderService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const admin = randomUUID();
  const actor = { userId: admin, role: 'TENANT_ADMIN' as const, ip: '127.0.0.1' };
  const at = (iso: string) => new Date(`${iso}:00+03:00`);

  // Each course: one day with two lectures (0-600 s and 600-1200 s) = 20 min video + 1 break (5) + discussion (15) = 40 min.
  const ids = { early: randomUUID(), middle: randomUUID(), late: randomUUID(), undated: randomUUID(), plain: randomUUID(), foreign: randomUUID() };
  const plan = randomUUID();

  async function seedCourse(tx: import('@prisma/client').Prisma.TransactionClient, tenantId: string, id: string, title: string, startsAt: Date | null, recordedCourse = true) {
    await tx.course.create({
      data: {
        id, tenantId, trainerId: admin, title, type: 'RECORDED', price: '0.00', isPublished: false,
        ...(recordedCourse ? { sourceVideoId: 'abcdefghijk', sourceDurationSeconds: 1200, scheduleConfig: { breakMinutes: 5, discussionMinutes: 15 }, scheduleStartsAt: startsAt } : {}),
      },
    });
    if (!recordedCourse) return;
    const mod = randomUUID();
    await tx.module.create({ data: { id: mod, tenantId, courseId: id, title: 'Day 1', sortOrder: 1 } });
    await tx.lesson.createMany({
      data: [
        { tenantId, moduleId: mod, title: 'P1', contentType: 'YOUTUBE', sortOrder: 0, startSecond: 0, endSecond: 600 },
        { tenantId, moduleId: mod, title: 'P2', contentType: 'YOUTUBE', sortOrder: 1, startSecond: 600, endSecond: 1200 },
      ],
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaRecordedCourseRepository } = require('../../src/modules/lms/recorded/recorded.repository') as typeof import('../../src/modules/lms/recorded/recorded.repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaProviderRepository } = require('../../src/modules/provider/provider.repository') as typeof import('../../src/modules/provider/provider.repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProviderService } = require('../../src/modules/provider/provider.service') as typeof import('../../src/modules/provider/provider.service');
    recorded = new PrismaRecordedCourseRepository();
    provider = new ProviderService({ repository: new PrismaProviderRepository(), hashPassword: async (p) => p });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.create({ data: { id: admin, tenantId: tenantA, email: 'admin@corp.test', passwordHash: 'x', role: 'TENANT_ADMIN' } });
      await tx.trainer.create({ data: { id: admin, tenantId: tenantA, userId: admin, fullName: 'Trainer' } });
      await seedCourse(tx, tenantA, ids.early, 'Early', at('2026-12-01T19:00')); // 19:00-19:40
      await seedCourse(tx, tenantA, ids.middle, 'Middle', at('2026-12-05T19:00'));
      await seedCourse(tx, tenantA, ids.late, 'Late', at('2026-12-10T19:00'));
      await seedCourse(tx, tenantA, ids.undated, 'Undated', null);
      await seedCourse(tx, tenantA, ids.plain, 'Plain course', null, false); // not a recorded course
    });
    await db.withTenantTransaction(tenantB, async (tx) => {
      const adminB = randomUUID();
      await tx.user.create({ data: { id: adminB, tenantId: tenantB, email: 'b@corp.test', passwordHash: 'x', role: 'TENANT_ADMIN' } });
      await tx.trainer.create({ data: { id: adminB, tenantId: tenantB, userId: adminB, fullName: 'B' } });
      await tx.course.create({ data: { id: ids.foreign, tenantId: tenantB, trainerId: adminB, title: 'Foreign', type: 'RECORDED', price: '0.00', sourceVideoId: 'abcdefghijk', scheduleStartsAt: at('2026-12-01T19:00') } });
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.trainingPlan.deleteMany({ where: { tenantId } });
        await tx.lesson.deleteMany({ where: { tenantId } });
        await tx.module.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  const order = (planId: string) =>
    db.withTenantTransaction(tenantA, async (tx) => {
      const rows = await tx.trainingPlanCourse.findMany({ where: { planId }, orderBy: { sortOrder: 'asc' }, select: { courseId: true, sortOrder: true } });
      return rows.map((r) => r.courseId);
    });
  const name = (id: string) => Object.entries(ids).find(([, v]) => v === id)?.[0];

  it('reads each stored course\'s start and the length of each day (video + breaks + discussion), skipping undated and non-recorded courses', async () => {
    const list = await recorded.loadPlanSchedules(tenantA, randomUUID());
    expect(list).toBeNull(); // no such plan
    const one = await recorded.loadCourseSchedule(tenantA, ids.early);
    expect(one).toMatchObject({ courseId: ids.early, title: 'Early', dayMinutes: [40] });
    expect(one?.startsAt.toISOString()).toBe('2026-12-01T16:00:00.000Z');
    expect(await recorded.loadCourseSchedule(tenantA, ids.undated)).toBeNull();
    expect(await recorded.loadCourseSchedule(tenantA, ids.plain)).toBeNull();
    expect(await recorded.loadCourseSchedule(tenantA, ids.foreign)).toBeNull(); // RLS: another academy's course is invisible
  });

  it('a new plan is saved in start-date order whatever order the courses were ticked in; undated ones last', async () => {
    await provider.createPlan(tenantA, actor, { title: 'Plan', description: null, type: 'DEVELOPMENT', status: 'ACTIVE', startsOn: null, endsOn: null, courseIds: [ids.undated, ids.late, ids.early, ids.middle] }).then(async (id) => {
      // the id of the plan created through the service
      expect((await order(id)).map(name)).toEqual(['early', 'middle', 'late', 'undated']);
      await db.withTenantTransaction(tenantA, (tx) => tx.trainingPlan.update({ where: { id }, data: { title: 'Plan (kept)' } }));
      Object.assign(ids, { planId: id });
    });
  });

  it('refuses a plan whose course list has two overlapping courses, and saves nothing', async () => {
    const planId = (ids as unknown as { planId: string }).planId;
    // move "late" onto "early"'s hour (19:20 on 1 December) directly in the database, then try to save a list holding both
    await db.withTenantTransaction(tenantA, (tx) => tx.course.update({ where: { id: ids.late }, data: { scheduleStartsAt: at('2026-12-01T19:20') } }));
    await expect(provider.updatePlan(tenantA, actor, planId, { courseIds: [ids.early, ids.late] })).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT', details: { conflict: { title: 'Late' } } });
    expect((await order(planId)).map(name)).toEqual(['early', 'middle', 'late', 'undated']); // unchanged
    await db.withTenantTransaction(tenantA, (tx) => tx.course.update({ where: { id: ids.late }, data: { scheduleStartsAt: at('2026-12-10T19:00') } }));
  });

  it('adding a course by appending puts it in its date place, and moving a start date re-orders every plan that holds it', async () => {
    const planId = (ids as unknown as { planId: string }).planId;
    await db.withTenantTransaction(tenantA, async (tx) => {
      await seedCourse(tx, tenantA, randomUUID(), 'Between', at('2026-12-07T19:00'));
    });
    const between = (await db.withTenantTransaction(tenantA, (tx) => tx.course.findFirstOrThrow({ where: { title: 'Between' }, select: { id: true } }))).id;
    expect(await recorded.appendCoursesToPlan(tenantA, actor, planId, [between])).toBe(true);
    expect((await order(planId)).map((id) => (id === between ? 'between' : name(id)))).toEqual(['early', 'middle', 'between', 'late', 'undated']);

    // pushing "early" after "late" re-orders the plan
    expect(await recorded.updateRecordedSource(tenantA, actor, ids.early, { channelUrl: null, channelName: null, startsAt: at('2026-12-20T19:00') })).toBe(true);
    expect((await order(planId)).map((id) => (id === between ? 'between' : name(id)))).toEqual(['middle', 'between', 'late', 'early', 'undated']);
  });

  it('knows which plans hold a course and the OTHER dated courses of each (for the moved-start-date check)', async () => {
    const planId = (ids as unknown as { planId: string }).planId;
    const plans = await recorded.loadPlansOfCourse(tenantA, ids.middle);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.planId).toBe(planId);
    expect(plans[0]?.others.map((o) => o.title).sort()).toEqual(['Between', 'Early', 'Late']); // not itself, not the undated one
  });
});
