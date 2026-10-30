import type { AdminQuizQuestion } from '@/lib/api';

/**
 * Pure model of the quiz form builder: question shape, validation and the payload sent to the
 * server. No React and no I/O, so the same rules can be exercised in isolation. The limits and
 * checks mirror `QuizService.validated` in the API (the API remains the authority; this is for
 * instant feedback while the supervisor types).
 */

export const LIMITS = { body: 2000, option: 300, minOptions: 2, maxOptions: 6 } as const;

export type QuestionType = 'MCQ' | 'TEXT';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface BuilderQuestion {
  /** Stable client-side key (an id from the server only exists once the question is saved). */
  key: string;
  id: string | null;
  /** The course day this question belongs to; null = shared pool used by days without questions. */
  dayId: string | null;
  type: QuestionType;
  body: string;
  /** Option texts as typed, including empty rows (MCQ). */
  options: string[];
  /** Index into `options` of the correct answer (MCQ). */
  correct: number;
  modelAnswer: string;
  difficulty: Difficulty;
}

/** One question as the save action receives it. */
export interface PayloadQuestion {
  key: string;
  id: string | null;
  day_id: string | null;
  type: QuestionType;
  body: string;
  difficulty: Difficulty;
  options: string[];
  correct_answer: string;
}

export interface SavePayload {
  upserts: PayloadQuestion[];
  deletes: string[];
}

let counter = 0;
export const newKey = (): string => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

export function blankQuestion(dayId: string | null): BuilderQuestion {
  return { key: newKey(), id: null, dayId, type: 'MCQ', body: '', options: ['', ''], correct: 0, modelAnswer: '', difficulty: 'MEDIUM' };
}

export function fromServer(q: AdminQuizQuestion): BuilderQuestion {
  const options = q.type === 'MCQ' ? [...q.options] : ['', ''];
  return {
    key: q.id,
    id: q.id,
    dayId: q.day_id,
    type: q.type,
    body: q.body,
    options,
    correct: q.type === 'MCQ' ? Math.max(0, q.options.indexOf(q.correct_answer)) : 0,
    modelAnswer: q.type === 'TEXT' ? q.correct_answer : '',
    difficulty: q.difficulty,
  };
}

/** A copy that is a brand-new question (no server id), placed right after the original by the caller. */
export const duplicateOf = (q: BuilderQuestion): BuilderQuestion => ({ ...q, key: newKey(), id: null, options: [...q.options] });

/** Arabic message for the first problem found, or null when the question can be saved. */
export function validateQuestion(q: BuilderQuestion): string | null {
  const body = q.body.trim();
  if (!body) return 'اكتب نص السؤال.';
  if (body.length > LIMITS.body) return `نص السؤال أطول من ${LIMITS.body} حرفاً.`;

  if (q.type === 'TEXT') {
    return q.modelAnswer.trim().length > LIMITS.body ? 'الإجابة النموذجية طويلة جداً.' : null;
  }

  const typed = q.options.map((o) => o.trim());
  const filled = typed.filter(Boolean);
  if (filled.length < LIMITS.minOptions) return 'أضف خيارين على الأقل.';
  if (filled.some((o) => o.length > LIMITS.option)) return `أحد الخيارات أطول من ${LIMITS.option} حرفاً.`;
  if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) return 'الخيارات يجب ألا تتكرر.';
  if (!typed[q.correct]) return 'حدّد الإجابة الصحيحة بالضغط على الدائرة بجانبها.';
  return null;
}

/** What the API gets: empty option rows dropped, the correct answer sent as its text. */
export function toPayload(q: BuilderQuestion): PayloadQuestion {
  const base = { key: q.key, id: q.id, day_id: q.dayId, type: q.type, body: q.body.trim(), difficulty: q.difficulty };
  if (q.type === 'TEXT') return { ...base, options: [], correct_answer: q.modelAnswer.trim() };
  const options = q.options.map((o) => o.trim()).filter(Boolean);
  return { ...base, options, correct_answer: (q.options[q.correct] ?? '').trim() };
}

/** Comparable snapshot of everything the server stores, used to find what changed since the last save. */
export function fingerprint(q: BuilderQuestion): string {
  const p = toPayload(q);
  return JSON.stringify([p.day_id, p.type, p.body, p.difficulty, p.options, p.correct_answer]);
}

/** Only new or edited questions are sent; untouched ones are not re-saved. */
export function buildPayload(questions: BuilderQuestion[], saved: ReadonlyMap<string, string>, deletedIds: readonly string[]): SavePayload {
  return {
    upserts: questions.filter((q) => saved.get(q.key) !== fingerprint(q)).map(toPayload),
    deletes: [...deletedIds],
  };
}
