'use server';

import { redirect } from 'next/navigation';
import { ApiError, ApiUnavailableError, api, type ExamPaper, type ExamResult, type HealthQuestionPage, type PracticeQuestion } from './api';
import { isValidSlug } from './format';
import { getSession } from './session';

const MESSAGES: Record<string, string> = {
  HEALTH_DISABLED: 'هذا القسم غير متاح حالياً.',
  HEALTH_TRIAL_ENDED: 'انتهت الفترة التجريبية. تواصل مع الأكاديمية لتفعيل اشتراكك.',
  NO_QUESTIONS: 'لا توجد أسئلة لهذا الاختيار بعد.',
  NO_FAVORITES: 'لم تضف أي سؤال إلى المفضلة بعد.',
  QUESTION_NOT_FOUND: 'السؤال لم يعد متاحاً.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
  HEALTH_EXAM_ONLY: 'هذه الأكاديمية تقدّم اختبارات رسمية فقط.',
  HEALTH_EXAMS_OFF: 'الاختبارات الرسمية غير مفعّلة.',
  OTP_INVALID: 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.',
  TOO_MANY_ATTEMPTS: 'محاولات خاطئة كثيرة. اطلب رمزاً جديداً بعد قليل.',
  MAIL_UNAVAILABLE: 'تعذّر إرسال الرمز إلى بريدك الآن. حاول بعد قليل.',
  SECTOR_NOT_FOUND: 'القطاع غير متاح.',
  EXAM_NOT_FOUND: 'الاختبار غير موجود.',
  EXAM_ALREADY_SUBMITTED: 'سبق تسليم هذا الاختبار.',
};

function describe(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? 'حدث خطأ غير متوقع. حاول مرة أخرى.';
  if (err instanceof ApiUnavailableError) return 'تعذّر الاتصال بالخادم. حاول بعد قليل.';
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}

async function token(slug: string): Promise<string> {
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/health`)}`);
  return session.token;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Random questions for a practice run (options already shuffled; the answer is not included). */
export async function startPracticeAction(slug: string, input: { sectorId: string | null; count: number; favoritesOnly: boolean }): Promise<Result<{ questions: PracticeQuestion[] }>> {
  const t = await token(slug);
  try {
    const r = await api<{ questions: PracticeQuestion[] }>(slug, '/me/health/practice', {
      method: 'POST',
      token: t,
      body: { sector_id: input.sectorId, count: input.count, favorites_only: input.favoritesOnly },
    });
    return { ok: true, questions: r.questions };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

/** Grades one answer on the server and returns the right option with its explanation. */
export async function answerAction(slug: string, questionId: string, option: string): Promise<Result<{ correct: boolean; correctOption: string; explanation: string }>> {
  const t = await token(slug);
  try {
    const r = await api<{ correct: boolean; correct_option: string; explanation: string }>(slug, '/me/health/answer', {
      method: 'POST',
      token: t,
      body: { question_id: questionId, option },
    });
    return { ok: true, correct: r.correct, correctOption: r.correct_option, explanation: r.explanation };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export async function setQuestionStateAction(slug: string, questionId: string, patch: { favorite?: boolean; read?: boolean }): Promise<{ error?: string }> {
  const t = await token(slug);
  try {
    await api(slug, `/me/health/questions/${encodeURIComponent(questionId)}/state`, { method: 'PUT', token: t, body: patch });
    return {};
  } catch (err) {
    return { error: describe(err) };
  }
}

export async function recordSessionAction(slug: string, input: { clientSessionId: string; sectorId: string | null; total: number; correct: number }): Promise<{ error?: string }> {
  const t = await token(slug);
  try {
    await api(slug, '/me/health/sessions', {
      method: 'POST',
      token: t,
      body: { client_session_id: input.clientSessionId, sector_id: input.sectorId, total: input.total, correct: input.correct },
    });
    return {};
  } catch (err) {
    return { error: describe(err) };
  }
}

/** One page of the study list (browse mode), loaded on demand by "load more". */
export async function loadQuestionsAction(slug: string, query: { sectorId: string | null; search: string; offset: number }): Promise<Result<{ page: HealthQuestionPage }>> {
  const t = await token(slug);
  const qs = new URLSearchParams({ limit: '20', offset: String(Math.max(0, Math.trunc(query.offset))) });
  if (query.sectorId) qs.set('sector_id', query.sectorId);
  if (query.search.trim()) qs.set('q', query.search.trim().slice(0, 100));
  try {
    return { ok: true, page: await api<HealthQuestionPage>(slug, `/me/health/questions?${qs}`, { token: t }) };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

// ---------------- official exams (strict mode) ----------------

const when = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' });

function examError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'EXAM_LIMIT_REACHED') {
    const next = (err.details as unknown as { next_allowed_at?: string } | undefined)?.next_allowed_at;
    return `وصلت إلى الحد الأقصى للاختبارات اليومية. يُفتح لك الاختبار بعد ${next ? when.format(new Date(next)) : '٢٤ ساعة من آخر محاولة'}.`;
  }
  return describe(err);
}

/** Step 1: checks the daily cap, then e-mails the confirmation code to the account's address. */
export async function requestExamCodeAction(slug: string, sectorId: string): Promise<Result<{ challengeId: string }>> {
  const t = await token(slug);
  try {
    const r = await api<{ challenge_id: string }>(slug, '/me/health/exam/code', { method: 'POST', token: t, body: { sector_id: sectorId } });
    return { ok: true, challengeId: r.challenge_id };
  } catch (err) {
    return { ok: false, error: examError(err) };
  }
}

/** Step 2: the code starts the exam: 10 random questions of the chosen sector. */
export async function startExamAction(slug: string, input: { sectorId: string; challengeId: string; code: string }): Promise<Result<{ exam: ExamPaper }>> {
  const t = await token(slug);
  const code = input.code.replace(/\D/g, '');
  if (code.length !== 6) return { ok: false, error: 'اكتب الرمز المكوّن من ٦ أرقام.' };
  try {
    const exam = await api<ExamPaper>(slug, '/me/health/exam/start', { method: 'POST', token: t, body: { sector_id: input.sectorId, challenge_id: input.challengeId, code } });
    return { ok: true, exam };
  } catch (err) {
    return { ok: false, error: examError(err) };
  }
}

export async function submitExamAction(slug: string, examId: string, answers: Record<string, string>): Promise<Result<{ result: ExamResult }>> {
  const t = await token(slug);
  try {
    const result = await api<ExamResult>(slug, `/me/health/exam/${encodeURIComponent(examId)}/submit`, { method: 'POST', token: t, body: { answers } });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: examError(err) };
  }
}
