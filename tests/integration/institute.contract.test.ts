/** HTTP contracts for institute management: roles, branch scope, redaction, integrity rules, tenant isolation. */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { TENANT_A, TENANT_B, adminToken, buildApp, learnerToken, sign, tenants } from './helpers/test-app';
import type { buildInstituteFakes } from './helpers/institute-fakes';

type Inst = ReturnType<typeof buildInstituteFakes> & { users: Record<string, { tenantId: string; email: string; fullName: string }> };

const as = (app: ReturnType<typeof buildApp>, token: string, tenant = TENANT_A) => ({
  get: (p: string) => request(app).get(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object) => request(app).post(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
  put: (p: string, body: object) => request(app).put(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
  del: (p: string) => request(app).delete(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
});

const ROOM = { name: 'معمل 1', kind: 'LAB', area_m2: 80, capacity: 24, power_kw: 12 };
const ASSET = { name: 'جهاز حاسب', category: 'IT', purchase_value: '4500.00', salvage_percent: 10, useful_life_months: 36 };

/** An institute with two branches, a room and an asset in each, and one user per role. */
async function seeded() {
  const app = buildApp();
  const inst = app.locals.institute as Inst;
  const admin = as(app, adminToken);
  const riyadh = (await admin.post('/branches', { name: 'الرياض', city: 'الرياض' })).body.data.id as string;
  const jeddah = (await admin.post('/branches', { name: 'جدة', city: 'جدة' })).body.data.id as string;
  const roomR = (await admin.post('/rooms', { ...ROOM, branch_id: riyadh })).body.data.id as string;
  const roomJ = (await admin.post('/rooms', { ...ROOM, branch_id: jeddah })).body.data.id as string;
  const assetR = (await admin.post('/assets', { ...ASSET, branch_id: riyadh, room_id: roomR })).body.data.id as string;
  const assetJ = (await admin.post('/assets', { ...ASSET, branch_id: jeddah, room_id: roomJ })).body.data.id as string;

  const people = {} as Record<'manager' | 'finance' | 'affairs' | 'instructor' | 'plain', { id: string; as: ReturnType<typeof as> }>;
  const add = async (key: keyof typeof people, role: string | null, branchId: string | null, base = 'INSTRUCTOR') => {
    const id = randomUUID();
    inst.users[id] = { tenantId: TENANT_A, email: `${key}@rukn.test`, fullName: key };
    if (role) expect((await admin.put('/members', { email: `${key}@rukn.test`, role, branch_id: branchId })).status).toBe(200);
    people[key] = { id, as: as(app, sign({ sub: id, tid: TENANT_A, role: base })) };
  };
  await add('manager', 'BRANCH_MANAGER', riyadh);
  await add('finance', 'FINANCE', null);
  await add('affairs', 'STUDENT_AFFAIRS', riyadh);
  await add('instructor', 'INSTRUCTOR', null);
  await add('plain', null, null, 'LEARNER');
  return { app, inst, admin, riyadh, jeddah, roomR, roomJ, assetR, assetJ, people };
}

describe('access: module switch and membership', () => {
  it('is closed when the academy does not have the module, and for users with no institute role', async () => {
    const { app, people } = await seeded();
    expect((await as(app, learnerToken).get('/me')).status).toBe(403); // learner without membership
    expect((await people.plain.as.get('/branches')).status).toBe(403);

    tenants[TENANT_A]!.features = { health: true, recorded: true, institute: false };
    const off = await as(app, adminToken).get('/branches');
    tenants[TENANT_A]!.features = { health: true, recorded: true, institute: true };
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('requires sign-in', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/v1/admin/institute/branches').set('x-tenant-id', TENANT_A)).status).toBe(401);
  });

  it('tells each role what it may write', async () => {
    const { admin, people } = await seeded();
    expect((await admin.get('/me')).body.data).toMatchObject({ role: 'HQ', branch_id: null, can_write: { branch: true, member: true, room: true, asset: true } });
    expect((await people.manager.as.get('/me')).body.data).toMatchObject({ role: 'BRANCH_MANAGER', can_write: { branch: false, member: false, room: true, asset: true } });
    expect((await people.finance.as.get('/me')).body.data).toMatchObject({ role: 'FINANCE', can_write: { room: false, asset: false } });
    expect((await people.instructor.as.get('/me')).body.data).toMatchObject({ role: 'INSTRUCTOR', can_write: { room: false } });
  });
});

describe('branch scope', () => {
  it('a branch manager sees only their branch; HQ and finance see all', async () => {
    const { admin, people, riyadh } = await seeded();
    expect((await admin.get('/branches')).body.data.branches).toHaveLength(2);
    expect((await people.finance.as.get('/branches')).body.data.branches).toHaveLength(2);
    const mine = (await people.manager.as.get('/branches')).body.data.branches;
    expect(mine.map((b: { id: string }) => b.id)).toEqual([riyadh]);
    expect((await people.manager.as.get('/rooms')).body.data.rooms.map((r: { branch_id: string }) => r.branch_id)).toEqual([riyadh]);
    expect((await people.manager.as.get('/assets')).body.data.assets).toHaveLength(1);
  });

  it('asking for another branch returns nothing, and its records look missing (404), not forbidden', async () => {
    const { people, jeddah, roomJ, assetJ, riyadh } = await seeded();
    const m = people.manager.as;
    expect((await m.get(`/rooms?branch_id=${jeddah}`)).body.data.rooms).toEqual([]);
    expect((await m.get(`/assets?branch_id=${jeddah}`)).body.data.assets).toEqual([]);
    expect((await m.put(`/rooms/${roomJ}`, { ...ROOM, name: 'x' })).status).toBe(404);
    expect((await m.del(`/rooms/${roomJ}`)).status).toBe(404);
    expect((await m.put(`/assets/${assetJ}`, { ...ASSET, name: 'x' })).status).toBe(404);
    expect((await m.del(`/assets/${assetJ}`)).status).toBe(404);
    expect((await m.post('/rooms', { ...ROOM, name: 'جديد', branch_id: jeddah })).status).toBe(404);
    expect((await m.post('/assets', { ...ASSET, branch_id: jeddah })).status).toBe(404);
    // ...while their own branch works
    expect((await m.post('/rooms', { ...ROOM, name: 'قاعة جديدة', branch_id: riyadh })).status).toBe(201);
  });
});

describe('role permissions', () => {
  it('only HQ manages branches and members', async () => {
    const { people } = await seeded();
    for (const who of [people.manager, people.finance, people.affairs, people.instructor]) {
      expect((await who.as.post('/branches', { name: 'فرع جديد' })).status).toBe(403);
      expect((await who.as.get('/members')).status).toBe(403);
      expect((await who.as.put('/members', { email: 'plain@rukn.test', role: 'HQ' })).status).toBe(403);
    }
  });

  it('finance reads assets but cannot change rooms or assets; instructors read rooms but not assets', async () => {
    const { people, riyadh, roomR, assetR } = await seeded();
    expect((await people.finance.as.get('/assets')).body.data.assets).toHaveLength(2);
    expect((await people.finance.as.post('/rooms', { ...ROOM, name: 'ز', branch_id: riyadh })).status).toBe(403);
    expect((await people.finance.as.put(`/assets/${assetR}`, { ...ASSET, name: 'ز' })).status).toBe(403);
    expect((await people.instructor.as.get('/rooms')).body.data.rooms).toHaveLength(2);
    expect((await people.instructor.as.get('/assets')).status).toBe(403);
    expect((await people.instructor.as.del(`/rooms/${roomR}`)).status).toBe(403);
  });

  it('student affairs works rooms and assets of their branch', async () => {
    const { people, riyadh } = await seeded();
    const a = people.affairs.as;
    const room = await a.post('/rooms', { ...ROOM, name: 'قاعة 7', branch_id: riyadh });
    expect(room.status).toBe(201);
    expect((await a.post('/assets', { ...ASSET, name: 'سبورة', branch_id: riyadh, room_id: room.body.data.id })).status).toBe(201);
  });
});

describe('financial fields', () => {
  it('are hidden from student affairs, and an edit by them cannot overwrite them', async () => {
    const { admin, people, assetR } = await seeded();
    const seen = (await people.affairs.as.get('/assets')).body.data.assets[0];
    expect(seen).not.toHaveProperty('purchase_value');
    expect(seen).not.toHaveProperty('useful_life_months');

    const edited = await people.affairs.as.put(`/assets/${assetR}`, { name: 'جهاز معدّل', purchase_value: '1.00', salvage_percent: 99, useful_life_months: 1 });
    expect(edited.status).toBe(200);
    expect(edited.body.data).not.toHaveProperty('purchase_value');

    const real = (await admin.get('/assets')).body.data.assets.find((a: { id: string }) => a.id === assetR);
    expect(real).toMatchObject({ name: 'جهاز معدّل', purchase_value: '4500.00', salvage_percent: '10.00', useful_life_months: 36 });
  });

  it('are visible to HQ, the branch manager and finance', async () => {
    const { admin, people } = await seeded();
    for (const who of [admin, people.manager.as, people.finance.as]) {
      expect((await who.get('/assets')).body.data.assets[0]).toMatchObject({ purchase_value: '4500.00', salvage_percent: '10.00', useful_life_months: 36 });
    }
  });
});

describe('integrity rules', () => {
  it('validates branches, rooms and assets', async () => {
    const { admin, riyadh } = await seeded();
    expect((await admin.post('/branches', { name: '  ' })).status).toBe(422);
    const room = (extra: object) => admin.post('/rooms', { ...ROOM, name: 'ت', branch_id: riyadh, ...extra });
    expect((await room({ area_m2: 0 })).status).toBe(422);
    expect((await room({ capacity: 0 })).status).toBe(422);
    expect((await room({ kind: 'GARDEN' })).status).toBe(422);
    expect((await room({ power_kw: -1 })).status).toBe(422);
    const asset = (extra: object) => admin.post('/assets', { ...ASSET, branch_id: riyadh, ...extra });
    expect((await asset({ purchase_value: '-5' })).status).toBe(422);
    expect((await asset({ purchase_value: '10.555' })).status).toBe(422);
    expect((await asset({ salvage_percent: 101 })).status).toBe(422);
    expect((await asset({ useful_life_months: 0 })).status).toBe(422);
    expect((await asset({ purchase_date: '2026-13-40' })).status).toBe(422);
    expect((await asset({ status: 'LOST' })).status).toBe(422);
  });

  it('rejects duplicate names, and a room from another branch on an asset', async () => {
    const { admin, riyadh, roomJ } = await seeded();
    expect((await admin.post('/branches', { name: 'الرياض' })).status).toBe(409);
    expect((await admin.post('/rooms', { ...ROOM, branch_id: riyadh })).status).toBe(409);
    const cross = await admin.post('/assets', { ...ASSET, branch_id: riyadh, room_id: roomJ });
    expect(cross.status).toBe(422);
    expect(cross.body.error.code).toBe('ROOM_BRANCH_MISMATCH');
  });

  it('keeps a room in its branch on edit, and refuses to delete a room that holds assets', async () => {
    const { admin, riyadh, roomR, assetR } = await seeded();
    const moved = await admin.put(`/rooms/${roomR}`, { ...ROOM, name: 'معمل الرياض', capacity: 30 });
    expect(moved.body.data).toMatchObject({ branch_id: riyadh, name: 'معمل الرياض', capacity: 30, area_m2: '80.00' });
    expect((await admin.del(`/rooms/${roomR}`)).status).toBe(409);
    expect((await admin.del(`/assets/${assetR}`)).status).toBe(204);
    expect((await admin.del(`/rooms/${roomR}`)).status).toBe(204);
  });

  it('branch-bound roles must name a branch; HQ and finance ignore one', async () => {
    const { admin, people, inst } = await seeded();
    inst.users[randomUUID()] = { tenantId: TENANT_A, email: 'new@rukn.test', fullName: 'New' };
    const bad = await admin.put('/members', { email: 'new@rukn.test', role: 'BRANCH_MANAGER' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('BRANCH_REQUIRED');
    expect((await admin.put('/members', { email: 'new@rukn.test', role: 'BRANCH_MANAGER', branch_id: randomUUID() })).status).toBe(404);
    const hq = await admin.put('/members', { email: 'finance@rukn.test', role: 'FINANCE', branch_id: (await admin.get('/branches')).body.data.branches[0].id });
    expect(hq.body.data.branch_id).toBeNull();
    expect((await admin.put('/members', { email: 'nobody@rukn.test', role: 'HQ' })).status).toBe(404);
    expect((await admin.del(`/members/${people.manager.id}`)).status).toBe(204);
    expect((await people.manager.as.get('/branches')).status).toBe(403);
  });
});

describe('tenant isolation', () => {
  it('another institute sees none of it, and cannot touch it by id', async () => {
    const { app, roomR, assetR, riyadh } = await seeded();
    const otherAdmin = as(app, sign({ sub: randomUUID(), tid: TENANT_B, role: 'TENANT_ADMIN' }), TENANT_B);
    expect((await otherAdmin.get('/branches')).body.data.branches).toEqual([]);
    expect((await otherAdmin.get('/rooms')).body.data.rooms).toEqual([]);
    expect((await otherAdmin.put(`/rooms/${roomR}`, { ...ROOM })).status).toBe(404);
    expect((await otherAdmin.del(`/assets/${assetR}`)).status).toBe(404);
    expect((await otherAdmin.post('/rooms', { ...ROOM, name: 'س', branch_id: riyadh })).status).toBe(404);
    // and a token for institute A does not work against institute B
    expect((await as(app, adminToken, TENANT_B).get('/branches')).status).toBe(403);
  });
});

describe('audit', () => {
  it('records branch creation', async () => {
    const { inst } = await seeded();
    expect(inst.audit.filter((a) => a.action === 'institute.branch_created')).toHaveLength(2);
  });
});
