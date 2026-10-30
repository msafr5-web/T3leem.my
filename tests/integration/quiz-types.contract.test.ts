/** Question types beyond multiple choice (checkboxes, short answer, rating), points and "required". */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { QUIZ_COURSE, QUIZ_DAYS, TENANT_A, adminToken, buildApp, learnerToken } from './helpers/test-app';
import type { buildQuizFakes } from './helpers/quiz-fakes';

type Quiz = ReturnType<typeof buildQuizFakes>;
const quizOf = (app: ReturnType<typeof buildApp>) => app.locals.quiz as Quiz;
const base = `/admin/recorded-courses/${QUIZ_COURSE}`;
const [DAY1] = QUIZ_DAYS.map((d) => d.id) as [string, string];

const HEADER = ['Question_ID', 'Question_Text', 'Question_Type', 'Options_List', 'Correct_Answer', 'Difficulty_Level', 'Day', 'Points', 'Required'];

async function workbook(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Q');
  [HEADER, ...rows].forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const admin = (app: ReturnType<typeof buildApp>) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${adminToken}`),
  post: (p: string, body: object) => request(app).post(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${adminToken}`).send(body),
  put: (p: string, body: object) => request(app).put(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${adminToken}`).send(body),
  upload: (p: string, file: Buffer) =>
    request(app).post(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${adminToken}`).set('Content-Type', 'application/octet-stream').send(file),
});
const learner = (app: ReturnType<typeof buildApp>) => ({
  get: (p: string) => request(app).get(`/api/v1/me${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${learnerToken}`),
  post: (p: string, body: object = {}) => request(app).post(`/api/v1/me${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${learnerToken}`).send(body),
});

const ROWS: (string | number)[][] = [
  ['M1', 'اختيار واحد', 'MCQ', 'أ | ب | ج', 'ب', 'Easy', 1, 2, 'Yes'],
  ['C1', 'اختر كل الأعداد الزوجية', 'Checkbox', '2 | 3 | 4 | 5', '2 | 4', 'Medium', 1, 3, 'Yes'],
  ['S1', 'ما اسم الفرع الرئيسي؟', 'Short_Answer', '', 'main', 'Easy', 1, 1, 'No'],
  ['T1', 'اشرح بالتفصيل', 'Paragraph', '', '', 'Hard', 1, 1, ''],
  ['R1', 'قيّم شرح اليوم', 'Rating', '', '', '', 1, 1, 'No'],
];

describe('importing the new types, points and required', () => {
  it('reads every type with its points and required flag', async () => {
    const app = buildApp();
    const res = await admin(app).upload(`${base}/quiz/import`, await workbook(ROWS));
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(5);
    const by = Object.fromEntries((await admin(app).get(`${base}/quiz`)).body.data.questions.map((q: { code: string }) => [q.code, q]));
    expect(by.M1).toMatchObject({ type: 'MCQ', correct_answer: 'ب', points: 2, required: true, correct_options: [] });
    expect(by.C1).toMatchObject({ type: 'CHECKBOX', options: ['2', '3', '4', '5'], correct_options: ['2', '4'], correct_answer: '', points: 3, required: true });
    expect(by.S1).toMatchObject({ type: 'SHORT', correct_answer: 'main', required: false });
    expect(by.T1).toMatchObject({ type: 'TEXT', correct_answer: '', points: 1, required: false });
    expect(by.R1).toMatchObject({ type: 'RATING', options: [], correct_answer: '' });
  });

  it('defaults points to 1 and required to No when the columns are absent (older sheets)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Q');
    ws.addRow(HEADER.slice(0, 7));
    ws.addRow(['Q1', 'سؤال قديم', 'MCQ', 'a | b', 'a', 'Easy', '']);
    const app = buildApp();
    const res = await admin(app).upload(`${base}/quiz/import`, Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.status).toBe(201);
    expect(quizOf(app).repository.questions[0]).toMatchObject({ points: 1, required: false });
  });

  it('accepts checkbox answers by letter or number, and one answer whose text has a comma', async () => {
    const app = buildApp();
    const res = await admin(app).upload(
      `${base}/quiz/import`,
      await workbook([
        ['C1', 'حروف', 'Checkbox', 'a | b | c', 'A | C', '', '', '', ''],
        ['C2', 'أرقام', 'Checkbox', 'a | b | c', '2 | 3', '', '', '', ''],
        ['C3', 'فاصلة داخل الخيار', 'Checkbox', 'نعم، بالتأكيد | لا', 'نعم، بالتأكيد', '', '', '', ''],
      ]),
    );
    expect(res.status).toBe(201);
    const q = quizOf(app).repository.questions;
    expect(q.map((x) => x.correctOptions)).toEqual([['a', 'c'], ['b', 'c'], ['نعم، بالتأكيد']]);
  });

  it('reports bad points, required, and checkbox answers per row, importing nothing', async () => {
    const app = buildApp();
    const res = await admin(app).upload(
      `${base}/quiz/import`,
      await workbook([
        ROWS[0]!,
        ['E1', 'درجة صفر', 'MCQ', 'a | b', 'a', '', '', 0, ''],
        ['E2', 'درجة عشرية', 'MCQ', 'a | b', 'a', '', '', 1.5, ''],
        ['E3', 'درجة كبيرة', 'MCQ', 'a | b', 'a', '', '', 101, ''],
        ['E4', 'مطلوب غريب', 'MCQ', 'a | b', 'a', '', '', 1, 'maybe'],
        ['E5', 'إجابة ليست خياراً', 'Checkbox', 'a | b | c', 'a | z', '', '', 1, ''],
        ['E6', 'بلا إجابة', 'Checkbox', 'a | b | c', '', '', '', 1, ''],
      ]),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.details.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(quizOf(app).repository.questions).toHaveLength(0);
  });

  it('exports the new types and imports them back unchanged; the template shows all five', async () => {
    const app = buildApp();
    await admin(app).upload(`${base}/quiz/import`, await workbook(ROWS));
    const before = quizOf(app).repository.questions.map(({ id: _i, ...q }) => q);
    const file = await new Promise<Buffer>((resolve, reject) => {
      request(app)
        .get(`/api/v1${base}/quiz/export`)
        .set('x-tenant-id', TENANT_A)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse(((res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        }) as never)
        .end((err, res) => (err ? reject(err) : resolve(res.body as Buffer)));
    });
    const back = await admin(app).upload(`${base}/quiz/import`, file);
    expect(back.body.data).toEqual({ created: 0, updated: 5, removed: 0 });
    expect(quizOf(app).repository.questions.map(({ id: _i, ...q }) => q)).toEqual(before);

    const fresh = buildApp();
    const tpl = await new Promise<Buffer>((resolve, reject) => {
      request(fresh)
        .get(`/api/v1${base}/quiz/export?template=1`)
        .set('x-tenant-id', TENANT_A)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse(((res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        }) as never)
        .end((err, res) => (err ? reject(err) : resolve(res.body as Buffer)));
    });
    expect((await admin(fresh).upload(`${base}/quiz/import`, tpl)).status).toBe(201);
    expect(new Set(quizOf(fresh).repository.questions.map((q) => q.type))).toEqual(new Set(['MCQ', 'CHECKBOX', 'SHORT', 'TEXT', 'RATING']));
  });
});

describe('creating the new types in the form', () => {
  const draft = { day_id: DAY1, body: 'سؤال', difficulty: 'MEDIUM' };

  it('creates each type with points and required', async () => {
    const app = buildApp();
    const make = (b: object) => admin(app).post(`${base}/quiz/questions`, { ...draft, ...b });
    expect((await make({ type: 'CHECKBOX', options: ['a', 'b', 'c'], correct_options: ['a', 'C'], points: 4, required: true })).status).toBe(201);
    expect((await make({ type: 'SHORT', correct_answer: ' main ' })).status).toBe(201);
    expect((await make({ type: 'RATING' })).status).toBe(201);
    const q = quizOf(app).repository.questions;
    expect(q[0]).toMatchObject({ type: 'CHECKBOX', correctOptions: ['a', 'c'], points: 4, required: true });
    expect(q[1]).toMatchObject({ type: 'SHORT', correctAnswer: 'main', points: 1, required: false });
    expect(q[2]).toMatchObject({ type: 'RATING', options: [], correctAnswer: '' });
  });

  it('rejects checkbox questions with no / unknown correct options, and out-of-range points', async () => {
    const app = buildApp();
    const code = async (b: object) => (await admin(app).post(`${base}/quiz/questions`, { ...draft, ...b })).body.error?.code;
    expect(await code({ type: 'CHECKBOX', options: ['a', 'b'], correct_options: [] })).toBe('INVALID_QUESTION');
    expect(await code({ type: 'CHECKBOX', options: ['a', 'b'], correct_options: ['z'] })).toBe('INVALID_QUESTION');
    expect(await code({ type: 'MCQ', options: ['a', 'b'], correct_answer: 'a', points: 0 })).toBe('VALIDATION_FAILED');
    expect(await code({ type: 'MCQ', options: ['a', 'b'], correct_answer: 'a', points: 101 })).toBe('VALIDATION_FAILED');
    expect(await code({ type: 'SLIDER' })).toBe('VALIDATION_FAILED');
    expect(quizOf(app).repository.questions).toHaveLength(0);
  });
});

describe('taking a quiz with the new types', () => {
  const seeded = async () => {
    const app = buildApp();
    await admin(app).upload(`${base}/quiz/import`, await workbook(ROWS));
    await admin(app).put(`${base}/quiz-settings`, { duration_minutes: 10, question_count: 10 });
    return app;
  };
  type Q = { id: string; body: string; type: string; options: string[]; points: number; required: boolean };
  const started = async (app: ReturnType<typeof buildApp>) => {
    const qs = (await learner(app).post(`/modules/${DAY1}/quiz/start`)).body.data.attempt.questions as Q[];
    const find = (text: string) => qs.find((q) => q.body.includes(text))!;
    return { qs, mcq: find('اختيار واحد'), box: find('الأعداد الزوجية'), short: find('الفرع'), para: find('بالتفصيل'), rating: find('قيّم') };
  };
  const idx = (q: Q, text: string) => q.options.indexOf(text);

  it('shows points and required to the learner, never the answer key', async () => {
    const app = await seeded();
    const { qs, mcq, box } = await started(app);
    expect(qs).toHaveLength(5);
    expect(mcq).toMatchObject({ points: 2, required: true });
    expect(box).toMatchObject({ points: 3, required: true });
    expect(JSON.stringify(qs)).not.toMatch(/correct_/);
  });

  it('scores by points: a fully right checkbox earns all its points, partly right earns none', async () => {
    const app = await seeded();
    const { mcq, box, short, para, rating } = await started(app);
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, {
      answers: {
        [mcq.id]: idx(mcq, 'ب'),
        [box.id]: [idx(box, '4'), idx(box, '2')], // order does not matter
        [short.id]: '  main  ',
        [para.id]: 'شرح طويل',
        [rating.id]: 4,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ score: 5, max_score: 5, percent: 100 });
    const byId = Object.fromEntries(res.body.data.questions.map((q: { id: string }) => [q.id, q]));
    expect(byId[mcq.id]).toMatchObject({ is_correct: true, earned: 2, points: 2 });
    expect(byId[box.id]).toMatchObject({ is_correct: true, earned: 3, correct_options: ['2', '4'] });
    expect(byId[short.id]).toMatchObject({ your_answer: 'main', is_correct: null, earned: null, correct_answer: 'main' });
    expect(byId[rating.id]).toMatchObject({ your_answer: 4, is_correct: null });
  });

  it.each([
    ['only one of two right options', (q: Q) => [idx(q, '2')]],
    ['all right options plus a wrong one', (q: Q) => [idx(q, '2'), idx(q, '4'), idx(q, '5')]],
    ['a wrong option', (q: Q) => [idx(q, '3')]],
  ])('a checkbox answer of %s earns 0', async (_label, answer) => {
    const app = await seeded();
    const { mcq, box } = await started(app);
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: { [mcq.id]: idx(mcq, 'ب'), [box.id]: answer(box) } });
    expect(res.body.data).toMatchObject({ score: 2, max_score: 5 });
    expect(res.body.data.questions.find((q: { id: string }) => q.id === box.id)).toMatchObject({ is_correct: false, earned: 0 });
  });

  it('drops out-of-range ratings, duplicate or invalid checkbox indexes, and over-long short answers', async () => {
    const app = await seeded();
    const { mcq, box, short, rating } = await started(app);
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, {
      answers: { [mcq.id]: idx(mcq, 'ب'), [box.id]: [idx(box, '2'), idx(box, '2'), idx(box, '4'), 99, -1, 'x'], [short.id]: 'س'.repeat(500), [rating.id]: 9 },
    });
    expect(res.body.data.score).toBe(5); // duplicates / junk ignored, [2,4] remains
    const byId = Object.fromEntries(res.body.data.questions.map((q: { id: string }) => [q.id, q]));
    expect(byId[short.id].your_answer).toHaveLength(300);
    expect(byId[rating.id].your_answer).toBeNull();
  });

  it('refuses an early submit while a required question is unanswered, naming it', async () => {
    const app = await seeded();
    const { mcq, box, para } = await started(app);
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: { [mcq.id]: idx(mcq, 'ب'), [para.id]: 'x' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUIZ_REQUIRED_MISSING');
    expect(res.body.error.details.missing).toEqual([box.id]);
    // The attempt is still open: answering now works.
    const ok = await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: { [mcq.id]: idx(mcq, 'ب'), [box.id]: [idx(box, '2'), idx(box, '4')] } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.score).toBe(5);
  });

  it('an empty checkbox or blank text does not count as answered', async () => {
    const app = await seeded();
    const { mcq, box } = await started(app);
    const send = (answer: unknown) => learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: { [mcq.id]: idx(mcq, 'ب'), [box.id]: answer } });
    expect((await send([])).body.error.code).toBe('QUIZ_REQUIRED_MISSING');
    expect((await send(idx(box, '2'))).body.error.code).toBe('QUIZ_REQUIRED_MISSING'); // a bare number is not a list
    expect((await send(['x', 99])).body.error.code).toBe('QUIZ_REQUIRED_MISSING');
  });

  it('accepts the browser auto-submit at the deadline even with required questions missing', async () => {
    const app = await seeded();
    const quiz = quizOf(app);
    await started(app);
    quiz.clock.now = new Date('2026-11-01T10:09:57Z'); // 3 s before the 10-minute deadline
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: {} });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ score: 0, max_score: 5 });
  });

  it('keeps counting 1 point per choice question for attempts frozen before points existed', async () => {
    const app = await seeded();
    const { mcq } = await started(app);
    const attempt = quizOf(app).repository.attempts[0]!;
    // Simulate an old attempt: strip the new fields from the frozen questions.
    attempt.questions = attempt.questions.map(({ points: _p, required: _r, correctOptions: _c, ...old }) => old);
    const res = await learner(app).post(`/modules/${DAY1}/quiz/submit`, { answers: { [mcq.id]: idx(mcq, 'ب') } });
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(1);
    expect(res.body.data.max_score).toBe(2); // MCQ + CHECKBOX, 1 point each (the checkbox key is lost: never right)
  });
});
