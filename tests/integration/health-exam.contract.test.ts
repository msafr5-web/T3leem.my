/** Health academy strict mode: unique phone + e-mail, official exams of one sector, e-mailed code per exam, daily cap. */
import request from 'supertest';
import { TENANT_A, adminToken, buildApp, learnerToken } from './helpers/test-app';
import type { buildOtpFakes } from './helpers/owner-fakes';
import type { buildHealthFakes } from './helpers/health-fakes';

type Otp = ReturnType<typeof buildOtpFakes>;
type Health = ReturnType<typeof buildHealthFakes> & { clock: { now: Date } };
const otpOf = (app: ReturnType<typeof buildApp>) => app.locals.otp as Otp;
const healthOf = (app: ReturnType<typeof buildApp>) => app.locals.health as Health;

const as = (app: ReturnType<typeof buildApp>, token: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object) => request(app).post(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body),
  put: (p: string, body: object) => request(app).put(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body),
});

/** Two sectors (12 and 3 questions) and strict mode switched on. */
async function strictApp() {
  const app = buildApp();
  const a = as(app, adminToken);
  const food = (await a.post('/admin/health/sectors', { name: 'الأغذية' })).body.data.id as string;
  const salon = (await a.post('/admin/health/sectors', { name: 'الحلاقة' })).body.data.id as string;
  const q = (sector: string, text: string) => a.post('/admin/health/questions', { sector_id: sector, body: text, options: ['أ', 'ب', 'ج', 'د'], correct_index: 1, explanation: `شرح ${text}` });
  for (let i = 1; i <= 12; i++) await q(food, `أغذية ${i}`);
  for (let i = 1; i <= 3; i++) await q(salon, `حلاقة ${i}`);
  await a.put('/admin/health/settings', { enabled: true, strict_mode: true, daily_limit: 5, questions_per_exam: 10 });
  return { app, food, salon };
}

/** One official exam: ask for the code, confirm it, get the questions. */
async function startExam(app: ReturnType<typeof buildApp>, sector: string) {
  const l = as(app, learnerToken);
  const code = await l.post('/me/health/exam/code', { sector_id: sector });
  if (code.status !== 202) return { code, start: code };
  const start = await l.post('/me/health/exam/start', { sector_id: sector, challenge_id: code.body.data.challenge_id, code: otpOf(app).mailer.lastCode });
  return { code, start };
}

describe('registration in the health academy (strict mode)', () => {
  const reg = (app: ReturnType<typeof buildApp>, body: object) => request(app).post('/api/v1/auth/register').set('x-tenant-slug', 'rukn').send(body);
  const policy = (app: ReturnType<typeof buildApp>) => request(app).get('/api/v1/auth/register-policy').set('x-tenant-slug', 'rukn');

  it('asks for a phone number only in strict mode', async () => {
    const app = buildApp();
    expect((await policy(app)).body.data).toEqual({ require_phone: false });
    expect((await reg(app, { full_name: 'Reem Saleh', email: 'reem@new.test' })).status).toBe(201);
    healthOf(app).repository.settings.strictMode = true;
    expect((await policy(app)).body.data).toEqual({ require_phone: true });
    const missing = await reg(app, { full_name: 'Sara Ali', email: 'sara@new.test' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('PHONE_REQUIRED');
  });

  it('refuses a repeated phone number or e-mail, and a phone that is not international', async () => {
    const app = buildApp();
    healthOf(app).repository.settings.strictMode = true;
    const one = { full_name: 'Reem Saleh', email: 'reem@new.test', phone: '+966500000001' };
    expect((await reg(app, one)).status).toBe(201);
    expect((await reg(app, { ...one, full_name: 'Other Person', email: 'other@new.test' })).body.error.code).toBe('PHONE_TAKEN');
    expect((await reg(app, { ...one, full_name: 'Other Person', phone: '+966500000002' })).body.error.code).toBe('EMAIL_TAKEN');
    expect((await reg(app, { ...one, email: 'x@new.test', phone: '0500000003' })).status).toBe(422);
  });
});

describe('strict mode closes the open bank to trainees', () => {
  it('practice, review, answers and favourites answer 403 HEALTH_EXAM_ONLY; staff can still preview', async () => {
    const { app } = await strictApp();
    const l = as(app, learnerToken);
    for (const r of [await l.get('/me/health/questions'), await l.post('/me/health/practice', { count: 3 }), await l.get('/me/health/progress')]) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('HEALTH_EXAM_ONLY');
    }
    expect((await as(app, adminToken).get('/me/health/questions')).status).toBe(200);
    expect((await l.get('/me/health')).body.data).toMatchObject({ strict_mode: true, daily_limit: 5, questions_per_exam: 10 });
  });

  it('official exams are off while strict mode is off', async () => {
    const app = buildApp();
    const r = await as(app, learnerToken).get('/me/health/exam/status');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('HEALTH_EXAMS_OFF');
  });
});

describe('official exam', () => {
  it('needs the e-mailed code, then draws 10 random questions of that sector only, without the answers', async () => {
    const { app, food, salon } = await strictApp();
    const { code, start } = await startExam(app, food);
    expect(code.status).toBe(202);
    const mail = otpOf(app).mailer.sent.at(-1)!;
    expect(mail.to).toBe('learner@rukn.test');
    expect(mail.subject).toContain('تأكيد الاختبار');
    expect(start.status).toBe(201);
    const qs = start.body.data.questions as { body: string; options: string[] }[];
    expect(qs).toHaveLength(10);
    expect(new Set(qs.map((q) => q.body)).size).toBe(10);
    expect(qs.every((q) => q.body.startsWith('أغذية'))).toBe(true);
    expect(JSON.stringify(start.body)).not.toContain('correct');
    expect(JSON.stringify(start.body)).not.toContain('شرح');

    // a smaller sector gives all its questions
    const small = await startExam(app, salon);
    expect(small.start.body.data.questions).toHaveLength(3);
  });

  it('a wrong code, a login code, or somebody else code does not start an exam', async () => {
    const { app, food } = await strictApp();
    const l = as(app, learnerToken);
    const code = (await l.post('/me/health/exam/code', { sector_id: food })).body.data.challenge_id as string;
    const real = otpOf(app).mailer.lastCode;
    const wrong = real === '000000' ? '111111' : '000000';
    expect((await l.post('/me/health/exam/start', { sector_id: food, challenge_id: code, code: wrong })).body.error.code).toBe('OTP_INVALID');

    // the exam code cannot sign anybody in
    const signIn = await request(app).post('/api/v1/auth/otp/verify').set('x-tenant-slug', 'rukn').send({ challenge_id: code, code: real });
    expect(signIn.body.error.code).toBe('OTP_INVALID');

    // a sign-in code cannot start an exam
    const login = await request(app).post('/api/v1/auth/otp/request').set('x-tenant-slug', 'rukn').send({ email: 'learner@rukn.test' });
    const loginCode = otpOf(app).mailer.lastCode;
    expect((await l.post('/me/health/exam/start', { sector_id: food, challenge_id: login.body.data.challenge_id, code: loginCode })).body.error.code).toBe('OTP_INVALID');

    // the real code still works once, and only once
    expect((await l.post('/me/health/exam/start', { sector_id: food, challenge_id: code, code: real })).status).toBe(201);
    expect((await l.post('/me/health/exam/start', { sector_id: food, challenge_id: code, code: real })).body.error.code).toBe('OTP_INVALID');
  });

  it('grades on the server, records the attempt once, and shows the right answers afterwards', async () => {
    const { app, food } = await strictApp();
    const l = as(app, learnerToken);
    const { start } = await startExam(app, food);
    const exam = start.body.data as { id: string; questions: { id: string; options: string[] }[] };

    const inProgress = await l.get(`/me/health/exam/${exam.id}`);
    expect(inProgress.body.data.state).toBe('in_progress');
    expect(JSON.stringify(inProgress.body)).not.toContain('correct');

    // 'ب' is the right option of every seeded question: answer 7 right, 2 wrong, leave 1 blank
    const answers: Record<string, string> = {};
    exam.questions.slice(0, 7).forEach((q) => (answers[q.id] = 'ب'));
    exam.questions.slice(7, 9).forEach((q) => (answers[q.id] = 'أ'));
    const res = await l.post(`/me/health/exam/${exam.id}/submit`, { answers });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ score: 7, total: 10, percent: 70 });
    expect(res.body.data.questions[0]).toMatchObject({ correct_option: 'ب', correct: true });
    expect(res.body.data.questions[9]).toMatchObject({ your_answer: null, correct: false });

    expect((await l.post(`/me/health/exam/${exam.id}/submit`, { answers })).body.error.code).toBe('EXAM_ALREADY_SUBMITTED');
    expect((await l.get(`/me/health/exam/${exam.id}`)).body.data.state).toBe('submitted');

    const status = (await l.get('/me/health/exam/status')).body.data;
    expect(status.quota).toMatchObject({ limit: 5, used: 1, remaining: 4, next_allowed_at: null });
    expect(status.history[0]).toMatchObject({ id: exam.id, score: 7, total: 10 });
  });

  it('ignores answers that are not among the options, and exams of other users are invisible', async () => {
    const { app, food } = await strictApp();
    const { start } = await startExam(app, food);
    const exam = start.body.data as { id: string; questions: { id: string }[] };
    const res = await as(app, learnerToken).post(`/me/health/exam/${exam.id}/submit`, { answers: { [exam.questions[0]!.id]: 'ليس خياراً' } });
    expect(res.body.data.score).toBe(0);
    const other = await as(app, adminToken).get(`/me/health/exam/${exam.id}`);
    expect(other.status).toBe(404);
  });

  it('only questions of active sectors can be drawn; unknown sector is 404', async () => {
    const { app } = await strictApp();
    const r = await as(app, learnerToken).post('/me/health/exam/code', { sector_id: 'c1000000-0000-4000-8000-0000000000ff' });
    expect(r.status).toBe(404);
  });
});

describe('daily cap', () => {
  it('five exams in 24 hours, then nothing until 24 hours after the last attempt (and no e-mail while locked)', async () => {
    const { app, food } = await strictApp();
    const h = healthOf(app);
    h.clock.now = new Date('2026-11-02T08:00:00Z');
    for (let i = 0; i < 5; i++) {
      h.clock.now = new Date(h.clock.now.getTime() + 60 * 60_000); // one exam an hour
      expect((await startExam(app, food)).start.status).toBe(201);
    }
    const last = h.clock.now; // 13:00
    const mails = otpOf(app).mailer.sent.length;

    h.clock.now = new Date(last.getTime() + 60 * 60_000);
    const blocked = await startExam(app, food);
    expect(blocked.code.status).toBe(429);
    expect(blocked.code.body.error.code).toBe('EXAM_LIMIT_REACHED');
    expect(blocked.code.body.error.details.next_allowed_at).toBe(new Date(last.getTime() + 24 * 3_600_000).toISOString());
    expect(otpOf(app).mailer.sent).toHaveLength(mails);

    const status = (await as(app, learnerToken).get('/me/health/exam/status')).body.data.quota;
    expect(status).toMatchObject({ limit: 5, used: 5, remaining: 0, next_allowed_at: new Date(last.getTime() + 24 * 3_600_000).toISOString() });

    // one minute before the lift: still locked; at the lift: open again
    h.clock.now = new Date(last.getTime() + 24 * 3_600_000 - 60_000);
    expect((await startExam(app, food)).code.status).toBe(429);
    h.clock.now = new Date(last.getTime() + 24 * 3_600_000 + 1000);
    expect((await startExam(app, food)).start.status).toBe(201);
  });

  it('abandoning an exam does not give the attempt back, and the cap and size are settings', async () => {
    const { app, food } = await strictApp();
    await as(app, adminToken).put('/admin/health/settings', { enabled: true, strict_mode: true, daily_limit: 2, questions_per_exam: 4 });
    const first = await startExam(app, food);
    expect(first.start.body.data.questions).toHaveLength(4);
    await startExam(app, food); // never submitted
    expect((await startExam(app, food)).code.status).toBe(429);
  });

  it('validates the settings', async () => {
    const { app } = await strictApp();
    const a = as(app, adminToken);
    expect((await a.put('/admin/health/settings', { enabled: true, daily_limit: 0 })).status).toBe(422);
    expect((await a.put('/admin/health/settings', { enabled: true, questions_per_exam: 500 })).status).toBe(422);
    expect((await a.get('/admin/health')).body.data.settings).toMatchObject({ strict_mode: true, daily_limit: 5, questions_per_exam: 10 });
  });
});
