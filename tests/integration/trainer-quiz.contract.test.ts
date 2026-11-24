/** The trainer's own question bank (recorded courses they teach): HTTP contracts. */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { QUIZ_COURSE, TENANT_A, TENANT_B, adminToken, buildApp, instructorToken, learnerToken, unlinkedInstructorToken } from './helpers/test-app';

type App = ReturnType<typeof buildApp>;
const OTHER_COURSE = 'f1000000-0000-4000-8000-0000000000aa'; // another trainer's course (or none): the same answer
const base = `/trainer/courses/${QUIZ_COURSE}/quiz`;
const as = (app: App, token = instructorToken, tenant = TENANT_A) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object = {}) => request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
  put: (p: string, body: object) => request(app).put(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
  del: (p: string) => request(app).delete(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  upload: (p: string, file: Buffer) => request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(file),
});
const MCQ = { body: 'ما عاصمة السعودية؟', type: 'MCQ', options: ['الرياض', 'جدة'], correct_answer: 'الرياض' };

async function sheet(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Q');
  ws.addRow(['Question_ID', 'Question_Text', 'Question_Type', 'Options_List', 'Correct_Answer', 'Difficulty_Level', 'Day']);
  ws.addRow(['Q1', 'سؤال؟', 'MCQ', 'نعم | لا', 'نعم', 'Easy', 1]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('a trainer builds the question bank of their own recorded course', () => {
  it('adds, edits, lists and deletes questions with the same validation as the admin', async () => {
    const app = buildApp();
    const t = as(app);
    const created = await t.post(`${base}/questions`, MCQ);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const bank = (await t.get(base)).body.data;
    expect(bank.questions).toHaveLength(1);
    expect(bank.questions[0]).toMatchObject({ id, body: MCQ.body, correct_answer: 'الرياض' });

    expect((await t.put(`${base}/questions/${id}`, { ...MCQ, body: 'سؤال معدّل؟' })).status).toBe(200);
    expect((await t.get(base)).body.data.questions[0].body).toBe('سؤال معدّل؟');
    expect((await t.post(`${base}/questions`, { ...MCQ, correct_answer: 'غير موجود' })).status).toBe(422); // same checks as the admin's form
    expect((await t.del(`${base}/questions/${id}`)).status).toBe(204);
    expect((await t.get(base)).body.data.questions).toHaveLength(0);
  });

  it('imports and exports an Excel bank, and gives the template', async () => {
    const app = buildApp();
    const t = as(app);
    const up = await t.upload(`${base}/import`, await sheet());
    expect(up.status).toBe(201);
    expect(up.body.data).toEqual({ created: 1, updated: 0, removed: 0 });
    const out = await t.get(`${base}/export`);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toContain('spreadsheetml');
    expect((await t.get(`${base}/export?template=1`)).status).toBe(200);
    expect((await t.upload(`${base}/import`, Buffer.alloc(0))).status).toBe(422);
  });

  it('the questions the trainer writes are the ones the academy admin sees', async () => {
    const app = buildApp();
    await as(app).post(`${base}/questions`, MCQ);
    const seenByAdmin = await as(app, adminToken).get(`/admin/recorded-courses/${QUIZ_COURSE}/quiz`);
    expect(seenByAdmin.body.data.questions).toHaveLength(1);
  });
});

describe('who may use it', () => {
  it("another trainer's course (or an unknown one) is 404, for every operation, and nothing is read or written", async () => {
    const app = buildApp();
    const other = `/trainer/courses/${OTHER_COURSE}/quiz`;
    const t = as(app);
    for (const r of [await t.get(other), await t.get(`${other}/export`), await t.post(`${other}/questions`, MCQ), await t.upload(`${other}/import`, await sheet()), await t.del(`${other}/questions/${OTHER_COURSE}`)]) {
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('COURSE_NOT_FOUND');
    }
    expect((await as(app, adminToken).get(`/admin/recorded-courses/${QUIZ_COURSE}/quiz`)).body.data.questions).toHaveLength(0);
  });

  it('only a trainer: a learner and the admin get 403, no token gets 401, an account with no trainer profile gets 404', async () => {
    const app = buildApp();
    expect((await as(app, learnerToken).get(base)).status).toBe(403);
    expect((await as(app, adminToken).get(base)).status).toBe(403);
    expect((await request(app).get(`/api/v1${base}`).set('x-tenant-id', TENANT_A)).status).toBe(401);
    expect((await as(app, unlinkedInstructorToken).get(base)).body.error.code).toBe('TRAINER_PROFILE_NOT_FOUND');
  });

  it("a trainer token of one academy does not work in another academy", async () => {
    const res = await as(buildApp(), instructorToken, TENANT_B).get(base);
    expect([401, 403, 404]).toContain(res.status);
  });

  it('does not offer settings, windows or learners’ results (the admin keeps the pacing and the people)', async () => {
    const app = buildApp();
    expect((await as(app).put(`/trainer/courses/${QUIZ_COURSE}/quiz-settings`, { duration_minutes: 10, question_count: 5 })).status).toBe(404);
    expect((await as(app).get(`${base}/results`)).status).toBe(404);
  });
});
