/**
 * Institute tables against a REAL PostgreSQL instance: row-level security plus the integrity rules that
 * live in the database (composite foreign keys, CHECK constraints). Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Institute tables: RLS and database-level integrity', () => {
  let db: typeof import('../../src/config/database');

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const branchB = randomUUID();
  const roomA1 = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `ia-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `ib-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.create({ data: { id: userA, tenantId: tenantA, email: `u@${tenantA}.test`, passwordHash: 'x', role: 'INSTRUCTOR' } });
      await tx.branch.createMany({ data: [{ id: branchA1, tenantId: tenantA, name: 'Riyadh' }, { id: branchA2, tenantId: tenantA, name: 'Jeddah' }] });
      await tx.room.create({ data: { id: roomA1, tenantId: tenantA, branchId: branchA1, name: 'Lab 1', areaM2: '80', capacity: 24 } });
      await tx.asset.create({ data: { tenantId: tenantA, branchId: branchA1, roomId: roomA1, name: 'PC', purchaseValue: '4500.00' } });
    });
    await db.withTenantTransaction(tenantB, (tx) => tx.branch.create({ data: { id: branchB, tenantId: tenantB, name: 'Riyadh' } }));
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.asset.deleteMany({ where: { tenantId } });
        await tx.room.deleteMany({ where: { tenantId } });
        await tx.instituteMember.deleteMany({ where: { tenantId } });
        await tx.branch.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  it('each institute sees only its own branches, rooms and assets; the same branch name can exist in both', async () => {
    expect((await db.forTenant(tenantA).branch.findMany()).map((b) => b.name).sort()).toEqual(['Jeddah', 'Riyadh']);
    expect(await db.forTenant(tenantB).branch.findMany()).toHaveLength(1);
    expect(await db.forTenant(tenantB).room.findMany()).toHaveLength(0);
    expect(await db.forTenant(tenantB).asset.findMany()).toHaveLength(0);
    // B cannot even address A's rows
    expect(await db.forTenant(tenantB).room.findFirst({ where: { id: roomA1 } })).toBeNull();
  });

  it('a row cannot be written for another tenant (WITH CHECK)', async () => {
    await expect(db.forTenant(tenantB).branch.create({ data: { tenantId: tenantA, name: 'Sneaky' } })).rejects.toThrow();
  });

  it('a room or asset cannot point at another institute branch (composite foreign key, even though FK checks skip RLS)', async () => {
    await expect(db.withTenantTransaction(tenantA, (tx) => tx.room.create({ data: { tenantId: tenantA, branchId: branchB, name: 'X', areaM2: '10', capacity: 5 } }))).rejects.toThrow();
    await expect(db.withTenantTransaction(tenantA, (tx) => tx.asset.create({ data: { tenantId: tenantA, branchId: branchB, name: 'X' } }))).rejects.toThrow();
  });

  it('an asset cannot sit in a room of a different branch', async () => {
    await expect(db.withTenantTransaction(tenantA, (tx) => tx.asset.create({ data: { tenantId: tenantA, branchId: branchA2, roomId: roomA1, name: 'Misplaced' } }))).rejects.toThrow();
    // no room at all is fine, and so is the room of its own branch
    await expect(db.withTenantTransaction(tenantA, (tx) => tx.asset.create({ data: { tenantId: tenantA, branchId: branchA2, name: 'Loose' } }))).resolves.toBeDefined();
  });

  it('a room that still holds assets cannot be deleted; a branch with rooms cannot be deleted', async () => {
    await expect(db.withTenantTransaction(tenantA, (tx) => tx.room.delete({ where: { id: roomA1 } }))).rejects.toThrow();
    await expect(db.withTenantTransaction(tenantA, (tx) => tx.branch.delete({ where: { id: branchA1 } }))).rejects.toThrow();
  });

  it('CHECK constraints reject impossible numbers and roles', async () => {
    const room = (data: object) => db.withTenantTransaction(tenantA, (tx) => tx.room.create({ data: { tenantId: tenantA, branchId: branchA2, name: randomUUID(), areaM2: '10', capacity: 5, ...data } }));
    await expect(room({ areaM2: '0' })).rejects.toThrow();
    await expect(room({ capacity: 0 })).rejects.toThrow();
    await expect(room({ powerKw: '-1' })).rejects.toThrow();
    await expect(room({ kind: 'GARDEN' })).rejects.toThrow();
    const asset = (data: object) => db.withTenantTransaction(tenantA, (tx) => tx.asset.create({ data: { tenantId: tenantA, branchId: branchA1, name: 'A', ...data } }));
    await expect(asset({ purchaseValue: '-1' })).rejects.toThrow();
    await expect(asset({ salvagePercent: '101' })).rejects.toThrow();
    await expect(asset({ usefulLifeMonths: 0 })).rejects.toThrow();
    await expect(asset({ status: 'LOST' })).rejects.toThrow();
  });

  it('branch-bound roles need a branch; one membership per user; unknown roles are refused', async () => {
    const member = (data: object) => db.withTenantTransaction(tenantA, (tx) => tx.instituteMember.create({ data: { tenantId: tenantA, userId: userA, ...data } as never }));
    await expect(member({ role: 'BRANCH_MANAGER', branchId: null })).rejects.toThrow();
    await expect(member({ role: 'OWNER', branchId: null })).rejects.toThrow();
    await expect(member({ role: 'FINANCE', branchId: null })).resolves.toBeDefined();
    await expect(member({ role: 'HQ', branchId: null })).rejects.toThrow(); // userId is unique
    // a branch from another institute is refused
    await db.withTenantTransaction(tenantA, (tx) => tx.instituteMember.deleteMany({ where: { tenantId: tenantA } }));
    await expect(member({ role: 'BRANCH_MANAGER', branchId: branchB })).rejects.toThrow();
  });
});
