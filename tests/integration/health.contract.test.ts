/** HTTP contracts for the health-certificates academy: sectors, question bank, Excel in/out, practice, trial / fee. */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { ADMIN, TENANT_A, TENANT_B, USER, adminToken, buildApp, learnerToken, sign } from './helpers/test-app';
import type { buildHealthFakes } from './helpers/health-fakes';

type Health = ReturnType<typeof buildHealthFakes> & { clock: { now: Date } };
const healthOf = (app: ReturnType<typeof buildApp>) => app.locals.health as Health;

const as = (app: ReturnType<typeof buildApp>, token: string, tenant = TENANT_A) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object) => request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
  put: (p: string, body: object) => request(app).put(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
  del: (p: string) => request(app).delete(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  upload: (p: string, file: Buffer) => request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(file),
});

const HEADER = ['Question_ID', 'Sector', 'Question_Text', 'Option_A', 'Option_B', 'Option_C', 'Option_D', 'Correct', 'Explanation', 'Active'];

async function workbook(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Q');
  [HEADER, ...rows].forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function seededApp() {
  const app = buildApp();
  const a = as(app, adminToken);
  const food = (await a.post('/admin/health/sectors', { name: 'الأغذية', title: 'قطاع الأغذية' })).body.data.id as string;
  const salon = (await a.post('/admin/health/sectors', { name: 'الحلاقة' })).body.data.id as string;
  const q = (sector: string, n: number) => a.post('/admin/health/questions', { sector_id: sector, body: `سؤال ${n}`, options: ['أ', 'ب', 'ج', 'د'], correct_index: 1, explanation: `شرح ${n}` });
  for (let i = 1; i <= 4; i++) await q(food, i);
  await q(salon, 5);
  return { app, food, salon };
}

describe('sectors and questions (admin)', () => {
  it('creates sectors and questions, lists them with counts and hides nothing from the admin', async () => {
    const { app, food } = await seededApp();
    const o = (await as(app, adminToken).get('/admin/health')).body.data;
    expect(o.settings).toEqual({ enabled: true, trial_ends_at: null, price: null });
    expect(o.sectors.map((s: { name: string; question_count: number }) => [s.name, s.question_count])).toEqual([['الأغذية', 4], ['الحلاقة', 1]]);

    const list = (await as(app, adminToken).get(`/admin/health/questions?sector_id=${food}`)).body.data;
    expect(list.total).toBe(4);
    expect(list.questions[0]).toMatchObject({ options: ['أ', 'ب', 'ج', 'د'], correct_index: 1, active: true });
    expect(list.questions[0].code).toMatch(/^HQ-/);
  });

  it('validates the question form: 2-6 distinct options and a valid correct option', async () => {
    const { app, food } = await seededApp();
    const a = as(app, adminToken);
    const bad = (extra: object) => a.post('/admin/health/questions', { sector_id: food, body: 'س', options: ['x', 'y'], correct_index: 0, ...extra });
    expect((await bad({ options: ['x'] })).status).toBe(422);
    expect((await bad({ options: ['x', 'x'] })).status).toBe(422);
    expect((await bad({ correct_index: 3 })).status).toBe(422);
    expect((await bad({ body: '   ' })).status).toBe(422);
    expect((await bad({})).status).toBe(201);
  });

  it('edits and deletes a question; a sector with questions cannot be deleted', async () => {
    const { app, food, salon } = await seededApp();
    const a = as(app, adminToken);
    const id = (await a.get(`/admin/health/questions?sector_id=${salon}`)).body.data.questions[0].id as string;
    expect((await a.put(`/admin/health/questions/${id}`, { sector_id: food, body: 'معدّل', options: ['1', '2', '3'], correct_index: 2, active: false })).status).toBe(200);
    const edited = (await a.get(`/admin/health/questions?q=${encodeURIComponent('معدّل')}`)).body.data.questions[0];
    expect(edited).toMatchObject({ sector_id: food, correct_index: 2, active: false });

    expect((await a.del(`/admin/health/sectors/${food}`)).status).toBe(409);
    expect((await a.del(`/admin/health/questions/${id}`)).status).toBe(204);
    expect((await a.del(`/admin/health/sectors/${salon}`)).status).toBe(204);
  });

  it('is admin-only', async () => {
    const { app } = await seededApp();
    expect((await as(app, learnerToken).get('/admin/health')).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/health').set('x-tenant-id', TENANT_A)).status).toBe(401);
  });
});

describe('Excel import / export', () => {
  it('imports by sector name or code, upserts by Question_ID, and exports back', async () => {
    const { app, food } = await seededApp();
    const a = as(app, adminToken);
    const sheet = await workbook([
      ['X1', 'الأغذية', 'ما أفضل درجة حرارة لحفظ الأغذية المبردة؟', '٤°م أو أقل', '١٠°م', '٢٠°م', '٣٠°م', 'A', 'التبريد يبطئ نمو البكتيريا', 'Yes'],
      ['X2', 'الحلاقة', 'سؤال ثان', 'نعم', 'لا', '', '', 'لا', '', 'No'],
    ]);
    const res = await a.upload('/admin/health/import', sheet);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ created: 2, updated: 0, removed: 0 });

    const again = await a.upload('/admin/health/import', await workbook([['X1', 'الأغذية', 'نص محدّث', 'ص', 'خ', '', '', 'B', '', 'Yes']]));
    expect(again.body.data).toEqual({ created: 0, updated: 1, removed: 0 });
    const x1 = (await a.get(`/admin/health/questions?sector_id=${food}&q=X1`)).body.data.questions[0];
    expect(x1).toMatchObject({ body: 'نص محدّث', options: ['ص', 'خ'], correct_index: 1 });

    const file = await a.get('/admin/health/export').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as ExcelJS.Buffer);
    const codes: string[] = [];
    wb.getWorksheet('Questions')!.eachRow((row, n) => n > 1 && row.getCell(1).value && codes.push(String(row.getCell(1).value)));
    expect(codes).toHaveLength(5 + 2);
    expect(codes).toEqual(expect.arrayContaining(['X1', 'X2']));
  });

  it('imports nothing when any row is wrong, and names the rows', async () => {
    const { app } = await seededApp();
    const a = as(app, adminToken);
    const res = await a.upload(
      '/admin/health/import',
      await workbook([
        ['G1', 'الأغذية', 'جيد', 'a', 'b', '', '', 'A', '', ''],
        ['G2', 'قطاع غير موجود', 'سؤال', 'a', 'b', '', '', 'A', '', ''],
        ['G3', 'الأغذية', 'خيارات مكررة', 'a', 'a', '', '', 'A', '', ''],
        ['G4', 'الأغذية', 'إجابة غير صحيحة', 'a', 'b', '', '', 'Z', '', ''],
      ]),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_QUESTION_SHEET');
    expect(res.body.error.details.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
    expect((await a.get('/admin/health/questions')).body.data.total).toBe(5);
  });

  it('replace mode swaps the whole bank', async () => {
    const { app } = await seededApp();
    const a = as(app, adminToken);
    const res = await a.upload('/admin/health/import?mode=replace', await workbook([['R1', 'الأغذية', 'وحيد', 'a', 'b', '', '', 'B', '', '']]));
    expect(res.body.data).toEqual({ created: 1, updated: 0, removed: 5 });
  });

  it('rejects an empty upload', async () => {
    const { app } = await seededApp();
    expect((await as(app, adminToken).upload('/admin/health/import', Buffer.alloc(0))).status).toBe(422);
  });
});

describe('starter bank', () => {
  it('installs 6 sectors and 660 balanced questions, and is idempotent', async () => {
    const app = buildApp();
    const a = as(app, adminToken);
    const first = await a.post('/admin/health/starter', {});
    expect(first.status).toBe(201);
    expect(first.body.data).toEqual({ sectors_created: 6, created: 660, updated: 0 });
    const o = (await a.get('/admin/health')).body.data;
    expect(o.sectors.map((s: { question_count: number }) => s.question_count)).toEqual([110, 110, 110, 110, 110, 110]);
    const all = (await a.get('/admin/health/questions?limit=100&offset=0')).body.data.questions as { correct_index: number }[];
    // The source bank had 95% of the answers in slot B; the starter bank spreads them over all four slots.
    expect(new Set(all.map((q) => q.correct_index)).size).toBe(4);

    const again = await a.post('/admin/health/starter', {});
    expect(again.body.data).toEqual({ sectors_created: 0, created: 0, updated: 660 });
  });
});

describe('learner: practice and progress', () => {
  it('lists sectors, practises with server grading and never reveals the answer up front', async () => {
    const { app, food } = await seededApp();
    const l = as(app, learnerToken);
    const status = (await l.get('/me/health')).body.data;
    expect(status.access).toBe('open');
    expect(status.sectors.map((s: { name: string }) => s.name)).toEqual(['الأغذية', 'الحلاقة']);

    const run = await l.post('/me/health/practice', { sector_id: food, count: 3 });
    expect(run.status).toBe(200);
    const qs = run.body.data.questions as { id: string; options: string[]; correct_index?: number }[];
    expect(qs).toHaveLength(3);
    expect(JSON.stringify(qs)).not.toContain('correct');
    expect(JSON.stringify(qs)).not.toContain('شرح');
    expect(qs.every((q) => [...q.options].sort().join() === ['أ', 'ب', 'ج', 'د'].join())).toBe(true);

    // The right option's text is "ب" in the seed data, wherever the shuffle put it.
    const right = await l.post('/me/health/answer', { question_id: qs[0]!.id, option: 'ب' });
    expect(right.body.data).toMatchObject({ correct: true, correct_option: 'ب' });
    expect(right.body.data.explanation).toMatch(/شرح/);
    const wrong = await l.post('/me/health/answer', { question_id: qs[1]!.id, option: 'أ' });
    expect(wrong.body.data).toMatchObject({ correct: false, correct_option: 'ب' });
  });

  it('shuffles the options (not always the same order)', async () => {
    const { app, food } = await seededApp();
    const l = as(app, learnerToken);
    const orders = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const r = await l.post('/me/health/practice', { sector_id: food, count: 1 });
      orders.add((r.body.data.questions[0].options as string[]).join('|'));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('hides inactive questions and sectors from learners', async () => {
    const { app, salon } = await seededApp();
    const a = as(app, adminToken);
    await a.put(`/admin/health/sectors/${salon}`, { name: 'الحلاقة', active: false });
    const l = as(app, learnerToken);
    expect((await l.get('/me/health')).body.data.sectors).toHaveLength(1);
    expect((await l.get('/me/health/questions')).body.data.total).toBe(4);
    expect((await l.post('/me/health/practice', { sector_id: salon, count: 5 })).status).toBe(422);
  });

  it('browses with search and keeps favourites, read marks and session history', async () => {
    const { app, food } = await seededApp();
    const l = as(app, learnerToken);
    const list = (await l.get(`/me/health/questions?sector_id=${food}&limit=2`)).body.data;
    expect(list.total).toBe(4);
    expect(list.questions).toHaveLength(2);
    expect(list.questions[0]).toMatchObject({ correct_index: 1, explanation: expect.any(String) });

    const id = list.questions[0].id as string;
    expect((await l.put(`/me/health/questions/${id}/state`, { favorite: true })).status).toBe(204);
    const fav = await l.post('/me/health/practice', { favorites_only: true, count: 5 });
    expect(fav.body.data.questions.map((q: { id: string }) => q.id)).toEqual([id]);

    const session = { client_session_id: 'session-0001', sector_id: food, total: 10, correct: 7 };
    expect((await l.post('/me/health/sessions', session)).status).toBe(201);
    expect((await l.post('/me/health/sessions', session)).status).toBe(201);
    expect((await l.post('/me/health/sessions', { ...session, client_session_id: 'session-0002', correct: 11 })).status).toBe(422);

    const p = (await l.get('/me/health/progress')).body.data;
    expect(p).toMatchObject({ favorites: [id], answered: 10, correct: 7, sessions: 1 });
    expect(p.history).toHaveLength(1);
  });

  it('refuses favourites-only practice with no favourites', async () => {
    const { app } = await seededApp();
    expect((await as(app, learnerToken).post('/me/health/practice', { favorites_only: true })).status).toBe(422);
  });

  it('requires sign-in and is per tenant', async () => {
    const { app } = await seededApp();
    expect((await request(app).get('/api/v1/me/health').set('x-tenant-id', TENANT_A)).status).toBe(401);
    const other = sign({ sub: USER, tid: TENANT_B, role: 'LEARNER' });
    expect((await as(app, other, TENANT_B).get('/me/health')).body.data.sectors).toEqual([]);
  });
});

describe('trial period and fee', () => {
  const settings = (app: ReturnType<typeof buildApp>, body: object) => as(app, adminToken).put('/admin/health/settings', body);

  it('is free while no fee is set', async () => {
    const { app } = await seededApp();
    await settings(app, { enabled: true, trial_ends_at: '2020-01-01T00:00:00Z', price: null });
    expect((await as(app, learnerToken).get('/me/health')).body.data.access).toBe('open');
  });

  it('stays open during the trial, then locks learners until access is granted; staff still preview', async () => {
    const { app } = await seededApp();
    const h = healthOf(app);
    h.repository.knownEmails.set('learner@rukn.test', USER);
    h.clock.now = new Date('2026-11-01T00:00:00Z');
    await settings(app, { enabled: true, trial_ends_at: '2026-11-10T00:00:00Z', price: 49 });

    const l = as(app, learnerToken);
    expect((await l.get('/me/health')).body.data).toMatchObject({ access: 'trial', price: 49, trial_ends_at: '2026-11-10T00:00:00.000Z' });
    expect((await l.post('/me/health/practice', { count: 2 })).status).toBe(200);

    h.clock.now = new Date('2026-11-11T00:00:00Z');
    expect((await l.get('/me/health')).body.data.access).toBe('locked');
    const blocked = await l.post('/me/health/practice', { count: 2 });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('HEALTH_TRIAL_ENDED');
    expect((await l.get('/me/health/questions')).status).toBe(402);
    expect((await as(app, adminToken).get('/me/health')).body.data.access).toBe('paid');

    expect((await as(app, adminToken).post('/admin/health/access', { email: 'nobody@x.test', days: 30 })).status).toBe(404);
    const grant = await as(app, adminToken).post('/admin/health/access', { email: 'Learner@Rukn.test', days: 30 });
    expect(grant.status).toBe(201);
    expect((await l.get('/me/health')).body.data.access).toBe('paid');
    expect((await l.post('/me/health/practice', { count: 2 })).status).toBe(200);

    h.clock.now = new Date('2026-12-20T00:00:00Z');
    expect((await l.get('/me/health')).body.data.access).toBe('locked');
  });

  it('can be switched off', async () => {
    const { app } = await seededApp();
    await settings(app, { enabled: false, trial_ends_at: null, price: null });
    expect((await as(app, learnerToken).get('/me/health')).body.data.access).toBe('disabled');
    const r = await as(app, learnerToken).post('/me/health/practice', { count: 2 });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('HEALTH_DISABLED');
    expect(ADMIN).toBeTruthy();
  });

  it('rejects a bad price or date', async () => {
    const { app } = await seededApp();
    expect((await settings(app, { enabled: true, price: -5 })).status).toBe(422);
    expect((await settings(app, { enabled: true, trial_ends_at: 'soon' })).status).toBe(422);
  });
});
