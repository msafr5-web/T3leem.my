/**
 * RLS isolation boundaries against a REAL PostgreSQL 16 instance.
 *
 * Requires TEST_DATABASE_URL pointing at an isolated test database (e.g. a throwaway Docker
 * container) on which `npm run db:migrate` has been run, connecting as the non-superuser
 * application role. Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('PostgreSQL RLS tenant isolation', () => {
  let db: typeof import('../../src/config/database');

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // Loaded lazily (after DATABASE_URL is pointed at the test DB). require(), not import():
    // under module=Node16 a CommonJS file keeps import() as a native ESM load, bypassing ts-jest.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    for (const [tenantId, userId, courseId] of [
      [tenantA, userA, courseA],
      [tenantB, userB, courseB],
    ] as const) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.user.create({ data: { id: userId, tenantId, email: `i@${tenantId}.test`, passwordHash: 'x', role: 'INSTRUCTOR' } });
        // Trainer shares the user's id, mirroring how the provider_management migration moved instructors.
        await tx.trainer.create({ data: { id: userId, tenantId, userId, fullName: `Trainer ${tenantId}` } });
        await tx.course.create({ data: { id: courseId, tenantId, trainerId: userId, title: `Course ${tenantId}`, type: 'RECORDED', price: '1000.00', isPublished: true } });
      });
    }
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  it('runs as a role that cannot bypass RLS (otherwise every assertion below is meaningless)', async () => {
    const [role] = await db.prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('a tenant sees only its own rows, even with no WHERE clause', async () => {
    const courses = await db.forTenant(tenantA).course.findMany({ select: { id: true } });
    expect(courses.map((c) => c.id)).toEqual([courseA]);
  });

  it("another tenant's row is invisible by primary key", async () => {
    await expect(db.forTenant(tenantA).course.findUnique({ where: { id: courseB } })).resolves.toBeNull();
  });

  it('queries without tenant context return nothing', async () => {
    await expect(db.prisma.course.count()).resolves.toBe(0);
  });

  it("updates cannot reach another tenant's rows", async () => {
    const result = await db.forTenant(tenantA).course.updateMany({ where: { id: courseB }, data: { title: 'pwned' } });
    expect(result.count).toBe(0);
    const untouched = await db.forTenant(tenantB).course.findUnique({ where: { id: courseB } });
    expect(untouched?.title).toBe(`Course ${tenantB}`);
  });

  it("WITH CHECK blocks inserting rows tagged with another tenant's id", async () => {
    await expect(
      db.withTenantTransaction(tenantA, (tx) =>
        tx.course.create({ data: { tenantId: tenantB, trainerId: userB, title: 'smuggled', type: 'RECORDED', price: '1.00' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('provider tables (trainers) are isolated too', async () => {
    const trainers = await db.forTenant(tenantA).trainer.findMany({ select: { id: true } });
    expect(trainers.map((t) => t.id)).toEqual([userA]);
    await expect(db.prisma.trainer.count()).resolves.toBe(0);
  });

  it('recorded courses: the real repository builds days + YOUTUBE lessons, and discussions stay per-tenant', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaRecordedCourseRepository } = require('../../src/modules/lms/recorded/recorded.repository') as typeof import('../../src/modules/lms/recorded/recorded.repository');
    const repo = new PrismaRecordedCourseRepository();
    const actor = { userId: userA, role: 'TENANT_ADMIN' as const, ip: null };
    const input = {
      title: 'GitHub',
      description: null,
      trainerId: userA,
      price: '0.00',
      isPublished: false,
      videoId: 'ZJQ-c4HyeX8',
      durationSeconds: 1265,
      config: { maxLectureMinutes: 15, minLectureMinutes: 10, breakMinutes: 5, discussionMinutes: 15, dailyVideoMinutes: 60 },
      trainingHours: 0.6,
      days: [{ title: 'اليوم 1', lessons: [{ title: 'الجزء 1', startSecond: 0, endSecond: 632 }, { title: 'الجزء 2', startSecond: 632, endSecond: 1265 }] }],
    };
    // Tenant B's trainer id satisfies the FK but must be rejected (FK checks bypass RLS).
    await expect(repo.createRecordedCourse(tenantA, actor, { ...input, trainerId: userB })).resolves.toBeNull();
    const courseId = (await repo.createRecordedCourse(tenantA, actor, input))!;
    const detail = (await repo.getRecordedCourse(tenantA, courseId))!;
    expect(detail.days[0]!.lessons.map((l) => [l.startSecond, l.endSecond])).toEqual([[0, 632], [632, 1265]]);
    await expect(repo.getRecordedCourse(tenantB, courseId)).resolves.toBeNull();

    const dayId = detail.days[0]!.id;
    const posted = await repo.createPost(tenantA, userA, dayId, null, 'سؤال');
    expect(posted.kind).toBe('ok');
    // Tenant B can neither see tenant A's day nor post into it.
    await expect(repo.createPost(tenantB, userB, dayId, null, 'x')).resolves.toEqual({ kind: 'module_not_found' });
    await expect(db.forTenant(tenantB).discussionPost.count()).resolves.toBe(0);
    await expect(db.prisma.discussionPost.count()).resolves.toBe(0);
    expect(await repo.listDiscussion(tenantA, dayId, userA)).toEqual([expect.objectContaining({ body: 'سؤال', mine: true, replies: [] })]);
  });

  it('tenant context does not leak across pooled connections', async () => {
    // Interleave many concurrent queries for both tenants over the shared pool.
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const tenantId = i % 2 === 0 ? tenantA : tenantB;
        return db.forTenant(tenantId).course.findMany({ select: { tenantId: true } }).then((rows) => ({ tenantId, rows }));
      }),
    );
    for (const { tenantId, rows } of results) {
      expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
    }
    await expect(db.prisma.course.count()).resolves.toBe(0);
  });
});
