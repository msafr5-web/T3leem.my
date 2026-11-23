/** Weekly digest claims against a REAL PostgreSQL instance (RLS on). Skipped when TEST_DATABASE_URL is unset. */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Weekly attendance digest claims (real database)', () => {
  let db: typeof import('../../src/config/database');
  let claims: import('../../src/modules/attendance/attendance.weekly').PrismaWeeklyClaims;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaWeeklyClaims } = require('../../src/modules/attendance/attendance.weekly') as typeof import('../../src/modules/attendance/attendance.weekly');
    claims = new PrismaWeeklyClaims();
    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `wa-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `wb-${tenantB}`, status: 'ACTIVE' },
      ],
    });
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) await db.withTenantTransaction(t, (tx) => tx.attendanceWeeklyReport.deleteMany({ where: { tenantId: t } }));
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  it('one claim per academy and week; an unsent claim is handed out again; a sent one never is', async () => {
    const first = await claims.claim(tenantA, '2026-11-15');
    expect(first).not.toBeNull();
    expect(await claims.claim(tenantA, '2026-11-15')).toEqual(first); // not sent yet: retried
    await claims.markSent(tenantA, (first as { id: string }).id, new Date());
    expect(await claims.claim(tenantA, '2026-11-15')).toBeNull();
    expect(await claims.claim(tenantA, '2026-11-22')).not.toBeNull(); // the next week is a new claim
  });

  it('academies do not see or block each other', async () => {
    expect(await claims.claim(tenantB, '2026-11-15')).not.toBeNull();
    expect(await db.withTenantTransaction(tenantB, (tx) => tx.attendanceWeeklyReport.count())).toBe(1);
  });

  it('the database refuses a malformed week key', async () => {
    await expect(db.withTenantTransaction(tenantA, (tx) => tx.attendanceWeeklyReport.create({ data: { tenantId: tenantA, weekStart: 'next week' } }))).rejects.toThrow();
  });
});
