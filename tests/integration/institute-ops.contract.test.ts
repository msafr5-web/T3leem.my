/** Institute management, rest of phase 1: departments, staff, maintenance log, inventory exceptions, Excel in/out. */
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { TENANT_A, adminToken, buildApp, sign } from './helpers/test-app';
import type { buildInstituteFakes } from './helpers/institute-fakes';
import { inventoryAttention, monthsBetween } from '../../src/modules/institute/institute.inventory';
import type { AssetRow } from '../../src/modules/institute/institute.repository';

type Inst = ReturnType<typeof buildInstituteFakes> & { users: Record<string, { tenantId: string; email: string; fullName: string }> };

const as = (app: ReturnType<typeof buildApp>, token: string) => ({
  get: (p: string) => request(app).get(`/api/v1/admin/institute${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object) => request(app).post(`/api/v1/admin/institute${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body),
  put: (p: string, body: object) => request(app).put(`/api/v1/admin/institute${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body),
  del: (p: string) => request(app).delete(`/api/v1/admin/institute${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  upload: (p: string, file: Buffer) =>
    request(app).post(`/api/v1/admin/institute${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(file),
  download: (p: string) =>
    request(app).get(`/api/v1/admin/institute${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }),
});

const ROOM = { name: 'معمل 1', kind: 'LAB', area_m2: 80, capacity: 24, power_kw: 12 };

async function seeded() {
  const app = buildApp();
  const inst = app.locals.institute as Inst;
  const admin = as(app, adminToken);
  const riyadh = (await admin.post('/branches', { name: 'الرياض' })).body.data.id as string;
  const jeddah = (await admin.post('/branches', { name: 'جدة' })).body.data.id as string;
  const roomR = (await admin.post('/rooms', { ...ROOM, branch_id: riyadh })).body.data.id as string;
  const assetR = (await admin.post('/assets', { name: 'جهاز', branch_id: riyadh, room_id: roomR, purchase_value: '4500.00' })).body.data.id as string;
  const assetJ = (await admin.post('/assets', { name: 'طابعة', branch_id: jeddah })).body.data.id as string;

  const people = {} as Record<'manager' | 'finance' | 'affairs', ReturnType<typeof as>>;
  const add = async (key: keyof typeof people, role: string, branchId: string | null) => {
    const id = randomUUID();
    inst.users[id] = { tenantId: TENANT_A, email: `${key}@rukn.test`, fullName: key };
    expect((await admin.put('/members', { email: `${key}@rukn.test`, role, branch_id: branchId })).status).toBe(200);
    people[key] = as(app, sign({ sub: id, tid: TENANT_A, role: 'INSTRUCTOR' }));
  };
  await add('manager', 'BRANCH_MANAGER', riyadh);
  await add('finance', 'FINANCE', null);
  await add('affairs', 'STUDENT_AFFAIRS', riyadh);
  return { app, admin, riyadh, jeddah, roomR, assetR, assetJ, people };
}

describe('departments', () => {
  it('HQ makes institute-wide and branch departments; names are unique per branch', async () => {
    const { admin, riyadh } = await seeded();
    expect((await admin.post('/departments', { name: 'المالية' })).status).toBe(201);
    expect((await admin.post('/departments', { name: 'المالية' })).status).toBe(409);
    expect((await admin.post('/departments', { name: 'المالية', branch_id: riyadh })).status).toBe(201); // same name, different level
    expect((await admin.post('/departments', { name: 'س', branch_id: randomUUID() })).status).toBe(404);
  });

  it('a branch manager sees wide departments and their own, may add to their branch, and cannot touch head office ones', async () => {
    const { admin, people, riyadh, jeddah } = await seeded();
    const wide = (await admin.post('/departments', { name: 'الموارد' })).body.data.id as string;
    await admin.post('/departments', { name: 'قسم جدة', branch_id: jeddah });
    const mine = await people.manager.post('/departments', { name: 'قسم الرياض', branch_id: riyadh });
    expect(mine.status).toBe(201);
    expect((await people.manager.get('/departments')).body.data.departments.map((d: { name: string }) => d.name).sort()).toEqual(['الموارد', 'قسم الرياض']);
    expect((await people.manager.post('/departments', { name: 'عام' })).status).toBe(403);
    expect((await people.manager.post('/departments', { name: 'ج', branch_id: jeddah })).status).toBe(404);
    expect((await people.manager.del(`/departments/${wide}`)).status).toBe(403);
    expect((await people.manager.del(`/departments/${mine.body.data.id}`)).status).toBe(204);
    expect((await people.affairs.post('/departments', { name: 'x', branch_id: riyadh })).status).toBe(403);
  });
});

describe('staff', () => {
  it('records staff per branch with a department that fits the branch', async () => {
    const { admin, riyadh, jeddah } = await seeded();
    const dep = (await admin.post('/departments', { name: 'قسم جدة', branch_id: jeddah })).body.data.id as string;
    const wide = (await admin.post('/departments', { name: 'عام' })).body.data.id as string;
    const ok = await admin.post('/staff', { branch_id: riyadh, full_name: 'سارة', job_title: 'منسقة', department_id: wide, email: 's@x.test' });
    expect(ok.status).toBe(201);
    const bad = await admin.post('/staff', { branch_id: riyadh, full_name: 'خالد', department_id: dep });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('DEPARTMENT_BRANCH_MISMATCH');
    expect((await admin.post('/staff', { branch_id: riyadh, full_name: ' ' })).status).toBe(422);
    expect((await admin.post('/staff', { branch_id: riyadh, full_name: 'ع', email: 'not-an-email' })).status).toBe(422);
  });

  it('is limited to the branch of a manager, hidden from the instructor, and never moves branch on edit', async () => {
    const { admin, people, riyadh, jeddah } = await seeded();
    const own = (await people.manager.post('/staff', { branch_id: riyadh, full_name: 'منى' })).body.data.id as string;
    const other = (await admin.post('/staff', { branch_id: jeddah, full_name: 'نواف' })).body.data.id as string;
    expect((await people.manager.get('/staff')).body.data.staff.map((s: { full_name: string }) => s.full_name)).toEqual(['منى']);
    expect((await people.manager.put(`/staff/${other}`, { full_name: 'x' })).status).toBe(404);
    expect((await people.manager.post('/staff', { branch_id: jeddah, full_name: 'x' })).status).toBe(404);
    const edited = await people.manager.put(`/staff/${own}`, { full_name: 'منى العلي', branch_id: jeddah, active: false });
    expect(edited.body.data).toMatchObject({ branch_id: riyadh, full_name: 'منى العلي', active: false });
    expect((await people.finance.post('/staff', { branch_id: riyadh, full_name: 'x' })).status).toBe(403);
    expect((await people.finance.get('/staff')).body.data.staff).toHaveLength(2);
    expect((await people.manager.del(`/staff/${own}`)).status).toBe(204);
  });

  it('a department with staff cannot be deleted', async () => {
    const { admin, riyadh } = await seeded();
    const dep = (await admin.post('/departments', { name: 'قسم', branch_id: riyadh })).body.data.id as string;
    await admin.post('/staff', { branch_id: riyadh, full_name: 'سارة', department_id: dep });
    expect((await admin.del(`/departments/${dep}`)).status).toBe(409);
  });
});

describe('maintenance log', () => {
  it('records entries newest first, and rejects a next date before the work date', async () => {
    const { admin, assetR } = await seeded();
    expect((await admin.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-01-10', kind: 'SERVICE', cost: '150.50', next_due_on: '2026-07-10' })).status).toBe(201);
    expect((await admin.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-03-01', kind: 'REPAIR', cost: 80, notes: 'مروحة' })).status).toBe(201);
    const list = (await admin.get(`/assets/${assetR}/maintenance`)).body.data.maintenance;
    expect(list.map((m: { performed_on: string }) => m.performed_on)).toEqual(['2026-03-01', '2026-01-10']);
    expect(list[1]).toMatchObject({ cost: '150.50', next_due_on: '2026-07-10', kind: 'SERVICE' });
    expect((await admin.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-03-01', next_due_on: '2026-02-01' })).status).toBe(422);
    expect((await admin.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-02-30' })).status).toBe(422);
    expect((await admin.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-03-01', cost: '-1' })).status).toBe(422);
    expect((await admin.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-03-01', kind: 'WASH' })).status).toBe(422);
  });

  it('follows branch scope and hides cost from student affairs, who also cannot record one', async () => {
    const { admin, people, assetR, assetJ } = await seeded();
    expect((await people.manager.post(`/assets/${assetJ}/maintenance`, { performed_on: '2026-03-01' })).status).toBe(404);
    expect((await people.manager.get(`/assets/${assetJ}/maintenance`)).status).toBe(404);
    expect((await people.finance.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-03-01' })).status).toBe(403);

    const saved = await people.affairs.post(`/assets/${assetR}/maintenance`, { performed_on: '2026-03-01', cost: '999.00' });
    expect(saved.status).toBe(201);
    expect(saved.body.data).not.toHaveProperty('cost');
    expect((await people.affairs.get(`/assets/${assetR}/maintenance`)).body.data.maintenance[0]).not.toHaveProperty('cost');
    expect((await admin.get(`/assets/${assetR}/maintenance`)).body.data.maintenance[0].cost).toBe('0.00'); // their cost was not stored
    expect((await people.finance.get(`/assets/${assetR}/maintenance`)).body.data.maintenance[0]).toHaveProperty('cost');
  });
});

describe('inventory attention', () => {
  it('lists assets that are out of a room, in the workshop, overdue or past their life, inside the caller scope', async () => {
    const { admin, people, assetR, assetJ } = await seeded();
    await admin.put(`/assets/${assetR}`, { name: 'جهاز', status: 'MAINTENANCE', room_id: null, purchase_date: '2020-01-01', useful_life_months: 36 });
    await admin.post(`/assets/${assetR}/maintenance`, { performed_on: '2025-01-01', next_due_on: '2025-06-01' });
    const items = (await admin.get('/inventory/attention')).body.data.items as { asset_id: string; reasons: string[] }[];
    expect(items.find((i) => i.asset_id === assetR)?.reasons.sort()).toEqual(['END_OF_LIFE', 'IN_MAINTENANCE', 'MAINTENANCE_OVERDUE']);
    expect(items.find((i) => i.asset_id === assetJ)?.reasons).toEqual(['NO_ROOM']);
    // a Riyadh manager only sees their own branch's items
    expect((await people.manager.get('/inventory/attention')).body.data.items.map((i: { asset_id: string }) => i.asset_id)).toEqual([assetR]);
  });
});

describe('inventory rules (pure)', () => {
  const asset = (over: Partial<AssetRow>): AssetRow => ({
    id: 'a', branchId: 'b', roomId: 'r', name: 'x', category: null, serialNo: null, purchaseDate: null, retiredOn: null, purchaseValue: '0.00', salvagePercent: '10.00', usefulLifeMonths: null, status: 'IN_SERVICE', notes: null, ...over,
  });
  it('counts whole months only', () => {
    expect(monthsBetween('2026-01-15', '2026-02-14')).toBe(0);
    expect(monthsBetween('2026-01-15', '2026-02-15')).toBe(1);
    expect(monthsBetween('2023-01-31', '2026-01-31')).toBe(36);
    expect(monthsBetween('2023-02-01', '2026-01-31')).toBe(35);
  });
  it('flags end of life exactly on the last day of the useful life, never retired assets, and not-yet-due maintenance', () => {
    const a = asset({ purchaseDate: '2023-01-31', usefulLifeMonths: 36 });
    expect(inventoryAttention([a], [], '2026-01-30')).toEqual([]);
    expect(inventoryAttention([a], [], '2026-01-31')).toEqual([{ assetId: 'a', reasons: ['END_OF_LIFE'] }]);
    expect(inventoryAttention([{ ...a, status: 'RETIRED' }], [], '2030-01-01')).toEqual([]);
    expect(inventoryAttention([asset({})], [{ assetId: 'a', performedOn: '2026-01-01', nextDueOn: '2026-06-01' }], '2026-06-01')).toEqual([]);
    expect(inventoryAttention([asset({})], [{ assetId: 'a', performedOn: '2026-01-01', nextDueOn: '2026-06-01' }], '2026-06-02')).toEqual([{ assetId: 'a', reasons: ['MAINTENANCE_OVERDUE'] }]);
  });
});

describe('Excel import and export', () => {
  async function sheet(rows: (string | number)[][], header = ['Name', 'Branch', 'Room', 'Category', 'Serial', 'Purchase_Date', 'Purchase_Value', 'Salvage_Percent', 'Useful_Life_Months', 'Status']) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('A');
    [header, ...rows].forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('imports assets by branch and room name and exports them back', async () => {
    const { admin } = await seeded();
    const file = await sheet([
      ['شاشة', 'الرياض', 'معمل 1', 'AV', 'SN-1', '2026-02-01', '1200.50', 5, 48, 'IN_SERVICE'],
      ['كرسي', 'جدة', '', '', '', '', '', '', '', ''],
    ]);
    const res = await admin.upload('/assets-import', file);
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(2);
    const list = (await admin.get('/assets')).body.data.assets;
    expect(list.find((a: { name: string }) => a.name === 'شاشة')).toMatchObject({ purchase_value: '1200.50', salvage_percent: '5.00', useful_life_months: 48, serial_no: 'SN-1' });

    const out = await admin.download('/assets-export');
    expect(out.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.body as never);
    expect(wb.worksheets[0]!.getRow(1).values).toEqual(expect.arrayContaining(['Name', 'Purchase_Value']));
    expect(wb.worksheets[0]!.rowCount).toBe(1 + 2 + 2); // header + 2 seeded + 2 imported
  });

  it('rejects the whole file when any row is bad, and reports each problem with its row number', async () => {
    const { admin } = await seeded();
    const before = (await admin.get('/assets')).body.data.assets.length;
    const res = await admin.upload('/assets-import', await sheet([['جيد', 'الرياض', '', '', '', '', '', '', '', ''], ['', 'الرياض', '', '', '', '', '', '', '', ''], ['س', 'غير موجود', '', '', '', '', '', '', '', ''], ['س', 'الرياض', 'لا توجد', '', '', '', '', '', '', ''], ['س', 'الرياض', '', '', '', '2026-13-45', '', '', '', ''], ['س', 'الرياض', '', '', '', '', '-5', '', '', ''], ['س', 'الرياض', '', '', '', '', '', '', '', 'LOST']]));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    expect(res.body.error.details.map((e: { row: number }) => e.row)).toEqual([3, 4, 5, 6, 7, 8]);
    expect((await admin.get('/assets')).body.data.assets).toHaveLength(before); // nothing half-imported
    expect((await admin.upload('/assets-import', await sheet([], ['Foo']))).status).toBe(422);
    expect((await admin.upload('/assets-import', Buffer.alloc(0))).status).toBe(422);
  });

  it('a branch manager can only import into their own branch; student affairs cannot set values; finance cannot import', async () => {
    const { admin, people } = await seeded();
    const jeddahRow = await sheet([['س', 'جدة', '', '', '', '', '', '', '', '']]);
    expect((await people.manager.upload('/assets-import', jeddahRow)).status).toBe(422); // Jeddah is outside their scope
    expect((await people.finance.upload('/assets-import', await sheet([['س', 'الرياض', '', '', '', '', '', '', '', '']]))).status).toBe(403);

    const priced = await sheet([['حاسب', 'الرياض', '', '', '', '', '9999.00', 50, 12, '']]);
    expect((await people.affairs.upload('/assets-import', priced)).status).toBe(201);
    const stored = (await admin.get('/assets')).body.data.assets.find((a: { name: string }) => a.name === 'حاسب');
    expect(stored).toMatchObject({ purchase_value: '0.00', salvage_percent: '10.00', useful_life_months: null });

    // their export leaves the money columns out entirely
    const out = await people.affairs.download('/assets-export');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.body as never);
    const header = (wb.worksheets[0]!.getRow(1).values as unknown[]).map(String);
    expect(header).not.toContain('Purchase_Value');
    expect(header).toContain('Name');
  });

  it('serves a template with a sample row', async () => {
    const { admin } = await seeded();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await admin.download('/assets-export?template=1')).body as never);
    expect(wb.worksheets[0]!.rowCount).toBe(2);
  });
});
