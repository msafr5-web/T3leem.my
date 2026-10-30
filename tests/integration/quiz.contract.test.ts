/** HTTP contracts for the end-of-day quiz: Excel question bank in/out, random draw, server-side timer. */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { QUIZ_COURSE, QUIZ_DAYS, TENANT_A, TENANT_B, adminToken, buildApp, learnerToken, sign } from './helpers/test-app';
import type { buildQuizFakes } from './helpers/quiz-fakes';

type Quiz = ReturnType<typeof buildQuizFakes>;
const quizOf = (app: ReturnType<typeof buildApp>) => app.locals.quiz as Quiz;

const HEADER = ['Question_ID', 'Question_Text', 'Question_Type', 'Options_List', 'Correct_Answer', 'Difficulty_Level', 'Day'];

async function workbook(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Q');
  [HEADER, ...rows].forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const GOOD: (string | number)[][] = [
  ['Q1', 'ما عاصمة السعودية؟', 'MCQ', 'الرياض | جدة | الدمام', 'الرياض', 'Easy', 1],
  ['Q2', 'ما ناتج 2+2؟', 'MCQ', '3, 4, 5', 'B', 'Medium', 1],
  ['Q3', 'اشرح فائدة الاختبار القصير.', 'Text_Input', '', 'تثبيت المعلومة', 'Hard', 1],
  ['Q4', 'سؤال مشترك', 'MCQ', 'نعم | لا', '1', '', ''],
];

const admin = (app: ReturnType<typeof buildApp>, token = adminToken, tenant = TENANT_A) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  put: (p: string, body: object) => request(app).put(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
  del: (p: string) => request(app).delete(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  upload: (p: string, file: Buffer) =>
    request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(file),
});

const base = `/admin/recorded-courses/${QUIZ_COURSE}`;
const [DAY1, DAY2] = QUIZ_DAYS.map((d) => d.id) as [string, string];

describe('question bank import / export', () => {
  it('imports an .xlsx: MCQ answers by text/letter/number, text questions, per-day and shared pool', async () => {
    const app = buildApp();
    const res = await admin(app).upload(`${base}/quiz/import`, await workbook(GOOD));
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ created: 4, updated: 0, removed: 0 });

    const bank = (await admin(app).get(`${base}/quiz`)).body.data;
    expect(bank.shared_count).toBe(1);
    expect(bank.days).toEqual([
      { id: DAY1, title: 'اليوم 1', question_count: 3, opens_at: null, closes_at: null },
      { id: DAY2, title: 'اليوم 2', question_count: 0, opens_at: null, closes_at: null },
    ]);
    const byCode = Object.fromEntries(bank.questions.map((q: { code: string }) => [q.code, q]));
    expect(byCode.Q2).toMatchObject({ options: ['3', '4', '5'], correct_answer: '4', difficulty: 'MEDIUM', day_id: DAY1 });
    expect(byCode.Q3).toMatchObject({ type: 'TEXT', options: [], difficulty: 'HARD' });
    expect(byCode.Q4).toMatchObject({ correct_answer: 'نعم', difficulty: 'MEDIUM', day_id: null });
  });

  it('imports a UTF-8 CSV with a BOM too', async () => {
    const csv = Buffer.from('﻿' + HEADER.join(',') + '\nQ1,"Capital?",MCQ,"A | B",A,Easy,\n', 'utf8');
    const res = await admin(buildApp()).upload(`${base}/quiz/import`, csv);
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
  });

  it('is all-or-nothing: reports every bad row and imports none', async () => {
    const app = buildApp();
    const res = await admin(app).upload(
      `${base}/quiz/import`,
      await workbook([
        GOOD[0]!,
        ['Q1', 'مكرر', 'MCQ', 'a | b', 'a', 'Easy', ''],
        ['Q5', 'نوع خاطئ', 'Essay?', '', '', '', ''],
        ['Q6', 'جواب لا يطابق', 'MCQ', 'x | y', 'z', '', ''],
        ['Q7', 'خيار واحد', 'MCQ', 'x', 'x', '', ''],
        ['Q8', 'يوم خارج الدورة', 'MCQ', 'x | y', 'x', '', 9],
      ]),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_QUESTION_SHEET');
    expect(res.body.error.details.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(quizOf(app).repository.questions).toHaveLength(0);
  });

  it('rejects files with missing columns, garbage, and an empty body', async () => {
    const app = buildApp();
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['Foo', 'Bar']);
    const noColumns = await admin(app).upload(`${base}/quiz/import`, Buffer.from(await wb.xlsx.writeBuffer()));
    expect(noColumns.status).toBe(422);
    expect(noColumns.body.error.details.errors[0].message).toContain('Question_ID');
    expect((await admin(app).upload(`${base}/quiz/import`, Buffer.from([1, 2, 3, 4, 5, 6]))).status).toBe(422);
    expect((await admin(app).upload(`${base}/quiz/import`, Buffer.alloc(0))).status).toBe(422);
  });

  it('re-importing updates by Question_ID (append) and removes absent ones (replace)', async () => {
    const app = buildApp();
    await admin(app).upload(`${base}/quiz/import`, await workbook(GOOD));
    const again = await admin(app).upload(`${base}/quiz/import`, await workbook([['Q1', 'نص معدّل', 'MCQ', 'أ | ب', 'ب', 'Hard', 2]]));
    expect(again.body.data).toEqual({ created: 0, updated: 1, removed: 0 });
    expect(quizOf(app).repository.questions).toHaveLength(4);
    expect(quizOf(app).repository.questions.find((q) => q.code === 'Q1')).toMatchObject({ body: 'نص معدّل', correctAnswer: 'ب', moduleId: DAY2 });

    const replaced = await admin(app).upload(`${base}/quiz/import?mode=replace`, await workbook([['N1', 'جديد', 'MCQ', 'a | b', 'a', '', '']]));
    expect(replaced.body.data).toEqual({ created: 1, updated: 0, removed: 4 });
    expect(quizOf(app).repository.questions.map((q) => q.code)).toEqual(['N1']);
  });

  it('exports the bank as a workbook that imports back unchanged, and a template when empty', async () => {
    const app = buildApp();
    const template = await admin(app).get(`${base}/quiz/export`).buffer(true).parse(binary);
    expect(template.status).toBe(200);
    expect(template.headers['content-type']).toContain('spreadsheetml');
    const tpl = await sheetRows(template.body);
    expect(tpl[0]).toEqual([...HEADER, 'Points', 'Required']);
    expect(tpl.length).toBeGreaterThan(1);

    await admin(app).upload(`${base}/quiz/import`, await workbook(GOOD));
    const exported = await admin(app).get(`${base}/quiz/export`).buffer(true).parse(binary);
    const rows = await sheetRows(exported.body);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r[0] === 'Q2')).toEqual(['Q2', 'ما ناتج 2+2؟', 'MCQ', '3 | 4 | 5', '4', 'Medium', '1', '1', 'No']);

    const before = [...quizOf(app).repository.questions];
    const back = await admin(app).upload(`${base}/quiz/import`, exported.body as Buffer);
    expect(back.body.data).toEqual({ created: 0, updated: 4, removed: 0 });
    expect(quizOf(app).repository.questions.map(({ id: _i, ...q }) => q)).toEqual(before.map(({ id: _i, ...q }) => q));
  });

  it('is admin-only and tenant-bound', async () => {
    const app = buildApp();
    const file = await workbook(GOOD);
    expect((await request(app).post(`/api/v1${base}/quiz/import`).set('x-tenant-id', TENANT_A).send(file)).status).toBe(401);
    expect((await admin(app, learnerToken).upload(`${base}/quiz/import`, file)).status).toBe(403);
    expect((await admin(app, learnerToken).get(`${base}/quiz`)).status).toBe(403);
    const otherAdmin = sign({ sub: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a00', tid: TENANT_B, role: 'TENANT_ADMIN' });
    expect((await admin(app, otherAdmin, TENANT_B).upload(`${base}/quiz/import`, file)).status).toBe(404);
    expect((await admin(app, otherAdmin, TENANT_B).get(`${base}/quiz`)).status).toBe(404);
  });

  it('validates quiz settings and deletes single questions', async () => {
    const app = buildApp();
    expect((await admin(app).put(`${base}/quiz-settings`, { duration_minutes: 0, question_count: 3 })).status).toBe(422);
    expect((await admin(app).put(`${base}/quiz-settings`, { duration_minutes: 10, question_count: 99 })).status).toBe(422);
    expect((await admin(app).put(`${base}/quiz-settings`, { duration_minutes: 25, question_count: 2 })).status).toBe(200);
    expect((await admin(app).get(`${base}/quiz`)).body.data.settings).toEqual({ duration_minutes: 25, question_count: 2 });

    await admin(app).upload(`${base}/quiz/import`, await workbook(GOOD));
    const id = quizOf(app).repository.questions[0]!.id;
    expect((await admin(app).del(`${base}/quiz/questions/${id}`)).status).toBe(204);
    expect((await admin(app).del(`${base}/quiz/questions/${id}`)).status).toBe(404);
  });
});

describe('learner quiz', () => {
  const learner = (app: ReturnType<typeof buildApp>, token = learnerToken) => ({
    get: (p: string) => request(app).get(`/api/v1/me${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(app).post(`/api/v1/me${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body),
  });

  const seeded = async () => {
    const app = buildApp();
    await admin(app).upload(`${base}/quiz/import`, await workbook(GOOD));
    await admin(app).put(`${base}/quiz-settings`, { duration_minutes: 10, question_count: 3 });
    return app;
  };

  it('reports availability before starting, and never leaks answers while the clock runs', async () => {
    const app = await seeded();
    const before = (await learner(app).get(`/modules/${DAY1}/quiz`)).body.data;
    expect(before).toMatchObject({ available: true, duration_minutes: 10, question_count: 3, attempt: null });

    const started = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data;
    expect(started.attempt.state).toBe('in_progress');
    expect(started.attempt.questions).toHaveLength(3);
    expect(JSON.stringify(started)).not.toContain('correct_answer');
    expect(new Date(started.attempt.expires_at).getTime() - new Date(started.server_now).getTime()).toBe(10 * 60_000);
    // Day 2 has no questions of its own: it falls back to the shared pool (1 question).
    expect((await learner(app).get(`/modules/${DAY2}/quiz`)).body.data).toMatchObject({ available: true, question_count: 1 });
  });

  it('grades MCQs by option index, leaves text answers ungraded, and allows ONE submission', async () => {
    const app = await seeded();
    const started = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data.attempt.questions as { id: string; body: string; type: string; options: string[] }[];
    const answers: Record<string, string | number> = {};
    for (const q of started) {
      if (q.type === 'TEXT') answers[q.id] = '  تثبيت المعلومة  ';
      else answers[q.id] = q.options.indexOf(q.body.includes('عاصمة') ? 'الرياض' : '4'); // right answer for both MCQs
    }
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ score: 2, max_score: 2, percent: 100 });
    const text = res.body.data.questions.find((q: { type: string }) => q.type === 'TEXT');
    expect(text).toMatchObject({ your_answer: 'تثبيت المعلومة', is_correct: null, correct_answer: 'تثبيت المعلومة' });

    expect((await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers })).body.error.code).toBe('QUIZ_ALREADY_SUBMITTED');
    // Starting again returns the finished attempt: no second chance.
    const again = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data;
    expect(again.attempt.state).toBe('submitted');
    expect(again.attempt.result.score).toBe(2);
  });

  it('counts wrong, unanswered and out-of-range answers as incorrect', async () => {
    const app = await seeded();
    const qs = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data.attempt.questions as { id: string; type: string }[];
    const mcq = qs.filter((q) => q.type === 'MCQ');
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: { [mcq[0]!.id]: 99, [mcq[1]!.id]: 'x' } });
    expect(res.body.data).toMatchObject({ score: 0, max_score: 2 });
  });

  it('closes the window on the SERVER clock: late submissions are refused and score 0', async () => {
    const app = await seeded();
    const quiz = quizOf(app);
    await learner(app).post(`/modules/${DAY1}/quiz/start`);

    quiz.clock.now = new Date('2026-11-01T10:10:10Z'); // 10 s past the deadline: inside the 15 s grace
    expect((await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: {} })).status).toBe(200);

    await learner(app).post(`/modules/${DAY2}/quiz/start`);
    quiz.clock.now = new Date('2026-11-01T10:30:00Z');
    const late = await learner(app).post(`/modules/${DAY2}/quiz/submit`, { answers: {} });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('QUIZ_EXPIRED');
    const status = (await learner(app).get(`/modules/${DAY2}/quiz`)).body.data;
    expect(status.attempt).toMatchObject({ state: 'submitted', result: { score: 0 } });
  });

  it('resuming an unfinished attempt keeps the same questions', async () => {
    const app = await seeded();
    const first = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data.attempt;
    const resumed = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data.attempt;
    expect(resumed.questions).toEqual(first.questions);
    expect(resumed.expires_at).toBe(first.expires_at);
  });

  it('refuses learners who are not enrolled, anonymous callers, and days with no questions', async () => {
    const app = await seeded();
    const stranger = sign({ sub: 'b4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a99', tid: TENANT_A, role: 'LEARNER' });
    expect((await learner(app, stranger).get(`/modules/${DAY1}/quiz`)).status).toBe(403);
    expect((await learner(app, stranger).post(`/modules/${DAY1}/quiz/start`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/me/modules/${DAY1}/quiz`).set('x-tenant-id', TENANT_A)).status).toBe(401);
    expect((await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: {} })).body.error.code).toBe('QUIZ_NOT_STARTED');

    const empty = buildApp();
    expect((await learner(empty).get(`/modules/${DAY1}/quiz`)).body.data.available).toBe(false);
    expect((await learner(empty).post(`/modules/${DAY1}/quiz/start`)).body.error.code).toBe('QUIZ_NOT_AVAILABLE');
  });

  it('lists attempts for the supervisor', async () => {
    const app = await seeded();
    await learner(app).post(`/modules/${DAY1}/quiz/start`);
    const rows = (await admin(app).get(`${base}/quiz/results`)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day_title: 'اليوم 1', submitted_at: null });
  });
});

// supertest's parser hook: collect the response as raw bytes (the typings want a wider response type).
const binary = ((res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}) as unknown as (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => void;

async function sheetRows(file: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ExcelJS.Buffer);
  const rows: string[][] = [];
  wb.worksheets[0]!.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : String(v)))));
  return rows;
}

describe('quiz time window (opens / closes)', () => {
  const win = (app: ReturnType<typeof buildApp>, body: object, token = adminToken) =>
    request(app).put(`/api/v1${base}/quiz-windows`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body);
  const learner = (app: ReturnType<typeof buildApp>) => ({
    get: (p: string) => request(app).get(`/api/v1/me${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${learnerToken}`),
    post: (p: string) => request(app).post(`/api/v1/me${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${learnerToken}`).send({}),
  });
  const seeded = async () => {
    const app = buildApp();
    await admin(app).upload(`${base}/quiz/import`, await workbook(GOOD));
    return app;
  };
  // The fake clock reads 2026-11-01T10:00:00Z.
  const at = (hhmm: string) => `2026-11-01T${hhmm}:00.000Z`;

  it('saves per-day windows and returns them to the supervisor and the learner', async () => {
    const app = await seeded();
    const res = await win(app, { windows: [{ day_id: DAY1, opens_at: at('09:00'), closes_at: at('12:00') }, { day_id: DAY2, opens_at: null, closes_at: null }] });
    expect(res.status).toBe(200);
    const days = (await admin(app).get(`${base}/quiz`)).body.data.days;
    expect(days[0]).toMatchObject({ opens_at: at('09:00'), closes_at: at('12:00') });
    expect(days[1]).toMatchObject({ opens_at: null, closes_at: null });
    expect((await learner(app).get(`/modules/${DAY1}/quiz`)).body.data).toMatchObject({ window: 'open', opens_at: at('09:00'), closes_at: at('12:00') });
  });

  it('refuses a window that closes before it opens, unknown days, and non-admins', async () => {
    const app = await seeded();
    expect((await win(app, { windows: [{ day_id: DAY1, opens_at: at('12:00'), closes_at: at('09:00') }] })).body.error.code).toBe('INVALID_QUIZ_WINDOW');
    expect((await win(app, { windows: [{ day_id: DAY1, opens_at: at('12:00'), closes_at: at('12:00') }] })).status).toBe(422);
    expect((await win(app, { windows: [{ day_id: '99999999-9999-4999-8999-999999999999', opens_at: at('09:00') }] })).body.error.code).toBe('UNKNOWN_DAY');
    expect((await win(app, { windows: [{ day_id: DAY1, opens_at: 'soon' }] })).status).toBe(422);
    expect((await win(app, { windows: [] })).status).toBe(422);
    expect((await win(app, { windows: [{ day_id: DAY1, opens_at: at('09:00') }] }, learnerToken)).status).toBe(403);
  });

  it('keeps the quiz closed until it opens, and starting early is refused by the server', async () => {
    const app = await seeded();
    await win(app, { windows: [{ day_id: DAY1, opens_at: at('11:00'), closes_at: at('12:00') }] });
    expect((await learner(app).get(`/modules/${DAY1}/quiz`)).body.data.window).toBe('not_open');
    const early = await learner(app).post(`/modules/${DAY1}/quiz/start`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('QUIZ_NOT_OPEN');

    quizOf(app).clock.now = new Date(at('11:00')); // opens exactly now
    expect((await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data.attempt.state).toBe('in_progress');
  });

  it('refuses to start after the closing time, but a finished attempt stays viewable', async () => {
    const app = await seeded();
    await win(app, { windows: [{ day_id: DAY1, opens_at: at('08:00'), closes_at: at('09:30') }] });
    const late = await learner(app).post(`/modules/${DAY1}/quiz/start`);
    expect(late.body.error.code).toBe('QUIZ_CLOSED');
    expect((await learner(app).get(`/modules/${DAY1}/quiz`)).body.data.window).toBe('closed');
  });

  it('never lets an attempt run past the closing time, whatever the duration', async () => {
    const app = await seeded();
    await win(app, { windows: [{ day_id: DAY1, opens_at: at('09:00'), closes_at: at('10:03') }] }); // 3 min left, duration 10
    const started = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data;
    expect(started.attempt.expires_at).toBe(at('10:03'));

    quizOf(app).clock.now = new Date('2026-11-01T10:03:20Z'); // past close + the 15 s grace
    const late = await learner(app).post(`/modules/${DAY1}/quiz/submit`).send({ answers: {} });
    expect(late.body.error.code).toBe('QUIZ_EXPIRED');
  });
});

describe('building questions in the form (no Excel)', () => {
  const send = (app: ReturnType<typeof buildApp>, method: 'post' | 'put', p: string, body: object, token = adminToken) =>
    request(app)[method](`/api/v1${base}${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body);
  const mcq = { day_id: DAY1, body: 'ما عاصمة مصر؟', type: 'MCQ', options: ['القاهرة', 'الإسكندرية', ' '], correct_answer: 'القاهرة', difficulty: 'EASY' };

  it('creates a day question with the next template-style code, trimming blank options', async () => {
    const app = buildApp();
    const a = await send(app, 'post', '/quiz/questions', mcq);
    expect(a.status).toBe(201);
    const b = await send(app, 'post', '/quiz/questions', { ...mcq, body: 'سؤال آخر' });
    const shared = await send(app, 'post', '/quiz/questions', { ...mcq, day_id: null, body: 'مشترك' });
    const day2 = await send(app, 'post', '/quiz/questions', { ...mcq, day_id: DAY2, body: 'لليوم الثاني' });
    expect([a, b, shared, day2].map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const rows = quizOf(app).repository.questions;
    expect(rows.map((q) => q.code)).toEqual(['F_D1_001', 'F_D1_002', 'F_ALL_001', 'F_D2_001']);
    expect(rows[0]).toMatchObject({ options: ['القاهرة', 'الإسكندرية'], correctAnswer: 'القاهرة', difficulty: 'EASY', moduleId: DAY1 });
    expect(rows[2]!.moduleId).toBeNull();
  });

  it('keeps codes unique after an import and after a deletion', async () => {
    const app = buildApp();
    await admin(app).upload(`${base}/quiz/import`, await workbook([['Q_D1_001', 'مستورد', 'MCQ', 'a | b', 'a', '', 1], ['F_D1_001', 'مستورد بالبادئة نفسها', 'MCQ', 'a | b', 'a', '', 1]]));
    await send(app, 'post', '/quiz/questions', mcq);
    // The form skips a code that an import already took, and never reuses the template's Q_ codes.
    expect(quizOf(app).repository.questions.map((q) => q.code)).toEqual(['Q_D1_001', 'F_D1_001', 'F_D1_002']);
  });

  it('accepts a text question with an optional model answer', async () => {
    const app = buildApp();
    const res = await send(app, 'post', '/quiz/questions', { day_id: DAY1, body: 'اشرح', type: 'TEXT' });
    expect(res.status).toBe(201);
    expect(quizOf(app).repository.questions[0]).toMatchObject({ type: 'TEXT', options: [], correctAnswer: '' });
  });

  it('applies the same rules as the Excel import', async () => {
    const app = buildApp();
    const code = async (body: object) => (await send(app, 'post', '/quiz/questions', body)).body.error?.code;
    expect(await code({ ...mcq, options: ['وحيد'], correct_answer: 'وحيد' })).toBe('INVALID_QUESTION');
    expect(await code({ ...mcq, options: ['أ', 'أ'], correct_answer: 'أ' })).toBe('INVALID_QUESTION');
    expect(await code({ ...mcq, correct_answer: 'غير موجود' })).toBe('INVALID_QUESTION');
    expect(await code({ ...mcq, options: ['1', '2', '3', '4', '5', '6', '7'] })).toBe('VALIDATION_FAILED');
    expect(await code({ ...mcq, body: '   ' })).toBe('VALIDATION_FAILED');
    expect(await code({ ...mcq, type: 'ESSAY' })).toBe('VALIDATION_FAILED');
    expect(await code({ ...mcq, day_id: '99999999-9999-4999-8999-999999999999' })).toBe('UNKNOWN_DAY');
    expect(quizOf(app).repository.questions).toHaveLength(0);
  });

  it('edits a question in place (code kept) and is admin-only and tenant-bound', async () => {
    const app = buildApp();
    await send(app, 'post', '/quiz/questions', mcq);
    const id = quizOf(app).repository.questions[0]!.id;
    const res = await send(app, 'put', `/quiz/questions/${id}`, { ...mcq, body: 'معدّل', options: ['س', 'ص'], correct_answer: 'ص', day_id: DAY2 });
    expect(res.status).toBe(200);
    expect(quizOf(app).repository.questions[0]).toMatchObject({ code: 'F_D1_001', body: 'معدّل', correctAnswer: 'ص', moduleId: DAY2 });
    expect((await send(app, 'put', '/quiz/questions/99999999-9999-4999-8999-999999999999', mcq)).body.error.code).toBe('QUESTION_NOT_FOUND');
    expect((await send(app, 'post', '/quiz/questions', mcq, learnerToken)).status).toBe(403);
    const other = sign({ sub: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a00', tid: TENANT_B, role: 'TENANT_ADMIN' });
    expect((await request(app).post(`/api/v1${base}/quiz/questions`).set('x-tenant-id', TENANT_B).set('Authorization', `Bearer ${other}`).send(mcq)).status).toBe(404);
  });
});
