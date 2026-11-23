/**
 * Trainee badges against a REAL PostgreSQL instance (RLS on). Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import { newBadgeToken } from '../../src/modules/badge/badge.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Trainee badge (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/badge/badge.repository').PrismaBadgeRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const trainerId = randomUUID();
  const t1 = randomUUID();
  const t2 = randomUUID();
  const course = randomUUID();
  const code = `T3L-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaBadgeRepository } = require('../../src/modules/badge/badge.repository') as typeof import('../../src/modules/badge/badge.repository');
    repo = new PrismaBadgeRepository();

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Badge Academy', slug: `ba-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'Other', slug: `bb-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: trainerId, tenantId: tenantA, email: 'tr@badge.test', passwordHash: 'x', role: 'INSTRUCTOR' },
          { id: t1, tenantId: tenantA, email: 'sara.ali@badge.test', fullName: 'Sara Ali', passwordHash: 'x', role: 'LEARNER' },
          { id: t2, tenantId: tenantA, email: 'noname@badge.test', passwordHash: 'x', role: 'LEARNER' },
        ],
      });
      await tx.trainer.create({ data: { id: trainerId, tenantId: tenantA, userId: trainerId, fullName: 'Trainer' } });
      await tx.course.create({ data: { id: course, tenantId: tenantA, trainerId, title: 'Safety', type: 'LIVE', price: '0.00' } });
      const e = await tx.enrollment.create({ data: { tenantId: tenantA, userId: t1, courseId: course, source: 'ADMIN' } });
      await tx.certificate.create({ data: { tenantId: tenantA, enrollmentId: e.id, certificateCode: code } });
    });
  });

  afterAll(async () => {
    await db.prisma.traineeBadge.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.certificate.deleteMany({ where: { tenantId: tenantA } });
      await tx.enrollment.deleteMany({ where: { tenantId: tenantA } });
      await tx.course.deleteMany({ where: { tenantId: tenantA } });
      await tx.trainer.deleteMany({ where: { tenantId: tenantA } });
      await tx.user.deleteMany({ where: { tenantId: tenantA } });
    });
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  it('publishes the name, academy and certificates of the trainee only, and nothing else', async () => {
    const token = newBadgeToken();
    await repo.enable(tenantA, t1, token);
    const view = await repo.publicView(token);
    expect(view).toMatchObject({ name: 'Sara Ali', academy: { name: 'Badge Academy' } });
    expect(view?.certificates.map((c) => [c.code, c.courseTitle])).toEqual([[code, 'Safety']]);
    expect(JSON.stringify(view)).not.toContain('badge.test');
  });

  it('falls back to the e-mail local part when the trainee has no name, never the full address', async () => {
    const token = newBadgeToken();
    await repo.enable(tenantA, t2, token);
    expect((await repo.publicView(token))?.name).toBe('noname');
  });

  it('turning it off hides it; the same link comes back when turned on; a new link kills the old one', async () => {
    const first = (await repo.find(tenantA, t1))!.token;
    expect(await repo.disable(tenantA, t1)).toBe(true);
    expect(await repo.publicView(first)).toBeNull();
    expect((await repo.enable(tenantA, t1, newBadgeToken())).token).toBe(first);
    const fresh = newBadgeToken();
    await repo.regenerate(tenantA, t1, fresh);
    expect(await repo.publicView(first)).toBeNull();
    expect(await repo.publicView(fresh)).not.toBeNull();
  });

  it("another academy cannot touch or see a trainee's badge", async () => {
    expect(await repo.find(tenantB, t1)).toBeNull();
    expect(await repo.disable(tenantB, t1)).toBe(false);
    expect((await repo.find(tenantA, t1))?.enabled).toBe(true);
  });

  it('an academy that is not active shows nothing', async () => {
    const token = (await repo.find(tenantA, t1))!.token;
    await db.prisma.tenant.update({ where: { id: tenantA }, data: { status: 'SUSPENDED' } });
    expect(await repo.publicView(token)).toBeNull();
    await db.prisma.tenant.update({ where: { id: tenantA }, data: { status: 'ACTIVE' } });
    expect(await repo.publicView(token)).not.toBeNull();
  });

  it('the database refuses a malformed token, and erasing the trainee erases the badge', async () => {
    await expect(db.prisma.traineeBadge.create({ data: { tenantId: tenantA, userId: t2, token: 'bad token!' } })).rejects.toThrow();
    const token = (await repo.find(tenantA, t2))!.token;
    await db.withTenantTransaction(tenantA, (tx) => tx.user.delete({ where: { id: t2 } }));
    expect(await repo.publicView(token)).toBeNull();
    expect(await db.prisma.traineeBadge.count({ where: { userId: t2 } })).toBe(0);
  });
});
