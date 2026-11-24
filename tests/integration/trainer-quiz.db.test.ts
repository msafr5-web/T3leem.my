/** Which courses a trainer may build questions for, against a REAL PostgreSQL instance (RLS on). Skipped without TEST_DATABASE_URL. */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Trainer question-bank ownership (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/provider/trainer-portal.repository').PrismaTrainerPortalRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const [ua, ub, ub2] = [randomUUID(), randomUUID(), randomUUID()];
  const recordedA = randomUUID();
  const liveA = randomUUID();
  const recordedB = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaTrainerPortalRepository } = require('../../src/modules/provider/trainer-portal.repository') as typeof import('../../src/modules/provider/trainer-portal.repository');
    repo = new PrismaTrainerPortalRepository();
    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `qa-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `qb-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: ua, tenantId: tenantA, email: 'a1@q.test', passwordHash: 'x', role: 'INSTRUCTOR' },
          { id: ub2, tenantId: tenantA, email: 'a2@q.test', passwordHash: 'x', role: 'INSTRUCTOR' },
        ],
      });
      await tx.trainer.createMany({
        data: [
          { id: ua, tenantId: tenantA, userId: ua, fullName: 'A1' },
          { id: ub2, tenantId: tenantA, userId: ub2, fullName: 'A2' },
        ],
      });
      await tx.course.createMany({
        data: [
          { id: recordedA, tenantId: tenantA, trainerId: ua, title: 'Recorded', type: 'RECORDED', price: '0.00' },
          { id: liveA, tenantId: tenantA, trainerId: ua, title: 'Live', type: 'LIVE', price: '0.00' },
        ],
      });
    });
    await db.withTenantTransaction(tenantB, async (tx) => {
      await tx.user.create({ data: { id: ub, tenantId: tenantB, email: 'b@q.test', passwordHash: 'x', role: 'INSTRUCTOR' } });
      await tx.trainer.create({ data: { id: ub, tenantId: tenantB, userId: ub, fullName: 'B' } });
      await tx.course.create({ data: { id: recordedB, tenantId: tenantB, trainerId: ub, title: 'B', type: 'RECORDED', price: '0.00' } });
    });
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      await db.withTenantTransaction(t, async (tx) => {
        await tx.course.deleteMany({ where: { tenantId: t } });
        await tx.trainer.deleteMany({ where: { tenantId: t } });
        await tx.user.deleteMany({ where: { tenantId: t } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  it('is true only for a recorded course of this academy taught by this trainer', async () => {
    expect(await repo.ownsRecordedCourse(tenantA, ua, recordedA)).toBe(true);
    expect(await repo.ownsRecordedCourse(tenantA, ub2, recordedA)).toBe(false); // a colleague in the same academy
    expect(await repo.ownsRecordedCourse(tenantA, ua, liveA)).toBe(false); // live courses have no end-of-day quiz
    expect(await repo.ownsRecordedCourse(tenantA, ua, randomUUID())).toBe(false);
  });

  it('never crosses academies, even with the right ids', async () => {
    expect(await repo.ownsRecordedCourse(tenantA, ub, recordedB)).toBe(false);
    expect(await repo.ownsRecordedCourse(tenantB, ub, recordedA)).toBe(false);
    expect(await repo.ownsRecordedCourse(tenantB, ub, recordedB)).toBe(true);
  });
});
