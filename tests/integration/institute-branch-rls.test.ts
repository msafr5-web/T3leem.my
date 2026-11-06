/**
 * The second RLS layer for branches, against a REAL PostgreSQL instance: with a branch scope set, the DATABASE hides and protects the
 * other branches' rows whatever the application code asks for (RESTRICTIVE policies on every branch-owned table).
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, sign, tenants } from './helpers/test-app';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Branch-scope row level security', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/institute/institute.repository').InstituteRepository;

  const tenant = randomUUID();
  const other = randomUUID();
  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();
  const roomA = randomUUID();
  const roomB = randomUUID();
  const managerUser = randomUUID();
  let app: ReturnType<typeof buildApp>;

  const inScope = <T>(ids: string[] | null, fn: () => Promise<T>) =>
    db.runWithBranchScope(async () => {
      db.setBranchScope(ids);
      return fn();
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    /* eslint-disable @typescript-eslint/no-require-imports */
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    const { PrismaInstituteRepository } = require('../../src/modules/institute/institute.repository') as typeof import('../../src/modules/institute/institute.repository');
    /* eslint-enable @typescript-eslint/no-require-imports */
    repo = new PrismaInstituteRepository();
    const { InstituteService } = require('../../src/modules/institute/institute.service') as typeof import('../../src/modules/institute/institute.service'); // eslint-disable-line @typescript-eslint/no-require-imports
    // A service with a BUG: its repository ignores the branch filter the service passes (as if a developer forgot it).
    const buggy = new Proxy(repo, {
      get(target, prop) {
        if (prop === 'listRooms') return (t: string) => target.listRooms(t, null);
        if (prop === 'listBranches') return (t: string) => target.listBranches(t, null);
        const v = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    app = buildApp({ instituteService: new InstituteService(buggy) });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenant, name: 'BR', slug: `br-${tenant}`, status: 'ACTIVE' },
        { id: other, name: 'BO', slug: `bo-${other}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenant, async (tx) => {
      await tx.branch.createMany({ data: [{ id: A, tenantId: tenant, name: 'A' }, { id: B, tenantId: tenant, name: 'B' }, { id: C, tenantId: tenant, name: 'C' }] });
      await tx.room.createMany({ data: [{ id: roomA, tenantId: tenant, branchId: A, name: 'RA', areaM2: '10', capacity: 5 }, { id: roomB, tenantId: tenant, branchId: B, name: 'RB', areaM2: '10', capacity: 5 }] });
      await tx.asset.createMany({ data: [{ tenantId: tenant, branchId: A, roomId: roomA, name: 'aa' }, { tenantId: tenant, branchId: B, roomId: roomB, name: 'ab' }] });
      await tx.student.createMany({ data: [{ tenantId: tenant, branchId: A, fullName: 'sa' }, { tenantId: tenant, branchId: B, fullName: 'sb' }] });
      await tx.expense.createMany({ data: [{ tenantId: tenant, branchId: A, category: 'x', amount: '1', incurredOn: new Date('2026-09-01') }, { tenantId: tenant, branchId: B, category: 'x', amount: '2', incurredOn: new Date('2026-09-01') }] });
      await tx.department.createMany({ data: [{ tenantId: tenant, branchId: null, name: 'عام' }, { tenantId: tenant, branchId: A, name: 'قسم أ' }, { tenantId: tenant, branchId: B, name: 'قسم ب' }] });
    });
    await db.withTenantTransaction(other, (tx) => tx.branch.create({ data: { id: randomUUID(), tenantId: other, name: 'O' } }));
    tenants[tenant] = { id: tenant, slug: `br-${tenant}`, name: 'BR', status: 'ACTIVE', legalName: null, vatNumber: null, brandSettings: {}, logoUpdatedAt: null, subscriptionEndsAt: null, features: { health: true, recorded: true, institute: true } };
    await db.withTenantTransaction(tenant, async (tx) => {
      await tx.user.create({ data: { id: managerUser, tenantId: tenant, email: `${managerUser}@t.test`, passwordHash: 'x', role: 'INSTRUCTOR' } });
      await tx.instituteMember.create({ data: { tenantId: tenant, userId: managerUser, role: 'BRANCH_MANAGER', branchId: A } });
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenant, other]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.instituteMember.deleteMany({ where: { tenantId } });
        await tx.expense.deleteMany({ where: { tenantId } });
        await tx.asset.deleteMany({ where: { tenantId } });
        await tx.student.deleteMany({ where: { tenantId } });
        await tx.department.deleteMany({ where: { tenantId } });
        await tx.room.deleteMany({ where: { tenantId } });
        await tx.branch.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
      delete tenants[tenantId];
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenant, other] } } });
    await db.prisma.$disconnect();
  });

  it('with no scope (head office, jobs, other modules) every branch of the tenant is visible, as before', async () => {
    expect(await db.forTenant(tenant).room.count()).toBe(2);
    expect(await inScope(null, () => db.forTenant(tenant).room.count())).toBe(2);
    expect(await db.forTenant(tenant).branch.count()).toBe(3);
  });

  it('a scoped request sees only its branch in every table, even when the query asks for everything', async () => {
    const seen = await inScope([A], async () => {
      const c = db.forTenant(tenant);
      return {
        branches: (await c.branch.findMany()).map((b) => b.name),
        rooms: (await c.room.findMany()).map((r) => r.name),
        assets: (await c.asset.findMany()).map((a) => a.name),
        students: (await c.student.findMany()).map((s) => s.fullName),
        expenses: await c.expense.count(),
        // institute-wide departments (no branch) stay visible, other branches' do not
        departments: (await c.department.findMany()).map((d) => d.name).sort(),
      };
    });
    expect(seen).toEqual({ branches: ['A'], rooms: ['RA'], assets: ['aa'], students: ['sa'], expenses: 1, departments: ['عام', 'قسم أ'].sort() });
  });

  it('a scope of several branches, and the repository methods a buggy service would call without a filter', async () => {
    expect(await inScope([A, B], () => db.forTenant(tenant).room.count())).toBe(2);
    expect(await inScope([C], () => db.forTenant(tenant).room.count())).toBe(0);
    // listRooms(tenant, null) is "all rooms" at the application level: under a scope the database narrows it
    expect((await inScope([A], () => repo.listRooms(tenant, null))).map((r) => r.name)).toEqual(['RA']);
    expect((await inScope([B], () => repo.listAssets(tenant, { branchId: null }))).map((a) => a.name)).toEqual(['ab']);
    expect(await inScope([A], () => repo.getRoom(tenant, roomB))).toBeNull(); // a known id of another branch is simply not there
  });

  it('writes into, or onto, another branch are refused or affect nothing', async () => {
    await inScope([A], async () => {
      await expect(db.forTenant(tenant).room.create({ data: { tenantId: tenant, branchId: B, name: 'sneaky', areaM2: '1', capacity: 1 } })).rejects.toThrow(); // WITH CHECK
      expect((await db.forTenant(tenant).room.updateMany({ where: { id: roomB }, data: { name: 'hacked' } })).count).toBe(0);
      expect((await db.forTenant(tenant).room.deleteMany({ where: { id: roomB } })).count).toBe(0);
      await expect(db.withTenantTransaction(tenant, (tx) => tx.expense.create({ data: { tenantId: tenant, branchId: B, category: 'x', amount: '9', incurredOn: new Date('2026-09-02') } }))).rejects.toThrow();
      // its own branch still works
      await expect(db.withTenantTransaction(tenant, (tx) => tx.expense.create({ data: { tenantId: tenant, branchId: A, category: 'ok', amount: '3', incurredOn: new Date('2026-09-02') } }))).resolves.toBeDefined();
    });
    expect((await db.forTenant(tenant).room.findFirstOrThrow({ where: { id: roomB } })).name).toBe('RB'); // untouched
    await db.withTenantTransaction(tenant, (tx) => tx.expense.deleteMany({ where: { category: 'ok' } }));
  });

  it('applies inside interactive transactions too, and the scope never leaks to the next request or between concurrent ones', async () => {
    const inTx = await inScope([B], () => db.withTenantTransaction(tenant, async (tx) => (await tx.student.findMany()).map((s) => s.fullName)));
    expect(inTx).toEqual(['sb']);
    expect(await db.forTenant(tenant).student.count()).toBe(2); // outside any scope again

    const [a, b, none] = await Promise.all([
      inScope([A], async () => {
        await new Promise((r) => setTimeout(r, 30));
        return (await db.forTenant(tenant).room.findMany()).map((r) => r.name);
      }),
      inScope([B], async () => (await db.forTenant(tenant).room.findMany()).map((r) => r.name)),
      inScope(null, async () => (await db.forTenant(tenant).room.findMany()).length),
    ]);
    expect([a, b, none]).toEqual([['RA'], ['RB'], 2]);
  });

  it('the tenant layer still holds underneath, and a scope naming a foreign branch id shows nothing of another tenant', async () => {
    const o = await db.forTenant(other).branch.findFirstOrThrow();
    expect(await inScope([o.id], () => db.forTenant(tenant).branch.count())).toBe(0); // not a branch of this tenant
    expect(await inScope(null, () => db.forTenant(other).room.count())).toBe(0);
    expect(await inScope(null, () => db.forTenant(other).branch.count())).toBe(1);
  });

  it('refuses a malformed scope instead of building SQL from it', () => {
    expect(() => db.runWithBranchScope(() => db.setBranchScope(["x'); DROP TABLE rooms;--"]))).toThrow();
    expect(() => db.runWithBranchScope(() => db.setBranchScope(['not-a-uuid']))).toThrow();
    expect(() => db.setBranchScope([A])).not.toThrow(); // outside a request it is a harmless no-op
  });

  it('through the HTTP stack: a branch manager asking a service that forgot its branch filter still gets only their branch', async () => {
    const as = (userId: string, role: string) => ({
      get: (p: string) => request(app).get(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${sign({ sub: userId, tid: tenant, role })}`),
    });
    const mgr = as(managerUser, 'INSTRUCTOR');
    expect((await mgr.get('/rooms')).body.data.rooms.map((r: { name: string }) => r.name)).toEqual(['RA']); // the buggy repository asked for ALL rooms
    expect((await mgr.get('/branches')).body.data.branches.map((b: { name: string }) => b.name)).toEqual(['A']);
    // head office, with no branch restriction, sees them all through the very same buggy service
    const hq = as(randomUUID(), 'TENANT_ADMIN');
    expect((await hq.get('/rooms')).body.data.rooms.map((r: { name: string }) => r.name).sort()).toEqual(['RA', 'RB']);
    expect((await hq.get('/branches')).body.data.branches).toHaveLength(3);
    // and one request's scope does not bleed into the next: the manager again, then head office again
    expect((await mgr.get('/rooms')).body.data.rooms).toHaveLength(1);
    expect((await hq.get('/rooms')).body.data.rooms).toHaveLength(2);
  });
});
