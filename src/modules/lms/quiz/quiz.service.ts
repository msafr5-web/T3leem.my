import { randomInt } from 'node:crypto';
import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import { QUIZ_LIMITS, buildQuestionWorkbook, hasOptions, isGraded, parseQuestionSheet, type Difficulty, type QuestionType } from './quiz.excel';
import type {
  AnswerValue,
  AttemptQuestion,
  AttemptSummaryRow,
  ImportOutcome,
  ModuleQuizContext,
  QuizAttemptRow,
  QuizDay,
  QuizQuestionRow,
  QuizRepository,
  QuestionInput,
  QuizSettings,
  QuizWindow,
} from './quiz.repository';

export const QUIZ_SETTING_LIMITS = { durationMinutes: { min: 1, max: 180 }, questionCount: { min: 1, max: 50 } } as const;

/** Network + device clock slack: an answer sent a moment after the deadline still counts. */
const GRACE_MS = 15_000;
const STAFF_ROLES = new Set(['TENANT_ADMIN', 'INSTRUCTOR', 'SUPER_ADMIN']);

export interface QuizBankView {
  settings: QuizSettings;
  days: (QuizDay & { questionCount: number })[];
  sharedCount: number;
  questions: QuizQuestionRow[];
}

export interface QuizResultQuestion {
  id: string;
  body: string;
  type: QuestionType;
  options: string[];
  points: number;
  required: boolean;
  yourAnswer: AnswerValue | null;
  /** MCQ: the right option's text; SHORT / TEXT: the supervisor's model answer (may be empty). */
  correctAnswer: string;
  /** CHECKBOX: the text of every right option. */
  correctOptions: string[];
  /** null for written answers and ratings (not auto-graded). */
  isCorrect: boolean | null;
  /** Points won (graded types only). */
  earned: number | null;
}

export interface QuizResult {
  score: number;
  maxScore: number;
  percent: number | null;
  submittedAt: Date;
  questions: QuizResultQuestion[];
}

export interface QuizStatus {
  /** There are questions for this day (its own, or the course-wide pool). */
  available: boolean;
  durationMinutes: number;
  questionCount: number;
  /** The supervisor's window for this day (null = no limit) and where "now" falls in it. */
  opensAt: Date | null;
  closesAt: Date | null;
  window: 'not_open' | 'open' | 'closed';
  serverNow: Date;
  attempt:
    | null
    | { state: 'in_progress'; expiresAt: Date; questions: Omit<AttemptQuestion, 'correctAnswer' | 'correctOptions'>[] }
    | { state: 'submitted'; result: QuizResult };
}

export interface QuizServiceDeps {
  repository: QuizRepository;
  now?: () => Date;
  /** Injectable for tests; defaults to a CSPRNG so a learner can't predict their draw. */
  random?: (maxExclusive: number) => number;
}

type Who = { id: string; role: string };

/** The auto-submit at zero may fire a moment before the server's deadline; "required" is not enforced then. */
const AUTO_SUBMIT_SLACK_MS = 5_000;

const pointsOf = (q: AttemptQuestion): number => q.points ?? 1;

/** The learner's answer in its stored form, or undefined when nothing valid was given. */
function cleanAnswer(q: AttemptQuestion, given: unknown): AnswerValue | undefined {
  const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < q.options.length;
  switch (q.type) {
    case 'MCQ':
      return isIndex(given) ? given : undefined;
    case 'CHECKBOX': {
      if (!Array.isArray(given)) return undefined;
      const picked = [...new Set(given.filter(isIndex))].sort((a, b) => a - b);
      return picked.length > 0 ? picked : undefined;
    }
    case 'RATING':
      return typeof given === 'number' && Number.isInteger(given) && given >= QUIZ_LIMITS.rating.min && given <= QUIZ_LIMITS.rating.max ? given : undefined;
    case 'SHORT':
    case 'TEXT': {
      if (typeof given !== 'string' || !given.trim()) return undefined;
      return given.trim().slice(0, q.type === 'SHORT' ? QUIZ_LIMITS.maxShortAnswer : QUIZ_LIMITS.maxBodyLength);
    }
  }
}

/** true / false for graded types, null for written answers and ratings. */
function isCorrect(q: AttemptQuestion, answer: AnswerValue | undefined): boolean | null {
  if (q.type === 'MCQ') return typeof answer === 'number' && q.options[answer] === q.correctAnswer;
  if (q.type === 'CHECKBOX') {
    const key = q.correctOptions ?? [];
    if (!Array.isArray(answer)) return false;
    const chosen = answer.map((i) => q.options[i]);
    // All-or-nothing: every right option and no wrong one.
    return key.length > 0 && chosen.length === key.length && key.every((k) => chosen.includes(k));
  }
  return null;
}

/** What the supervisor types into the question form (before validation). */
export interface QuestionDraft {
  dayId: string | null;
  body: string;
  type: QuestionType;
  options: string[];
  /** MCQ: the right option's text. SHORT / TEXT: the model answer (optional). */
  correctAnswer: string;
  /** CHECKBOX: the text of every right option. */
  correctOptions: string[];
  points: number;
  required: boolean;
  difficulty: Difficulty;
}

/**
 * End-of-day quiz of a course: the supervisor maintains a question bank (Excel in/out); each
 * enrolled learner gets ONE attempt per day with N random questions drawn from the day's
 * questions (or the course-wide pool), under a deadline the SERVER controls.
 */
export class QuizService {
  private readonly now: () => Date;
  private readonly random: (n: number) => number;

  constructor(private readonly deps: QuizServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? ((n) => randomInt(n));
  }

  // ---- supervisor: bank, settings, Excel --------------------------------------------------

  async bank(tenantId: string, courseId: string): Promise<QuizBankView> {
    const [days, settings, questions] = await Promise.all([
      this.deps.repository.courseDays(tenantId, courseId),
      this.deps.repository.getSettings(tenantId, courseId),
      this.deps.repository.listQuestions(tenantId, courseId),
    ]);
    if (!days || !settings) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return {
      settings,
      days: days.map((d) => ({ ...d, questionCount: questions.filter((q) => q.moduleId === d.id).length })),
      sharedCount: questions.filter((q) => q.moduleId === null).length,
      questions,
    };
  }

  async updateSettings(tenantId: string, actor: Actor, courseId: string, settings: QuizSettings): Promise<void> {
    const { durationMinutes: d, questionCount: c } = QUIZ_SETTING_LIMITS;
    if (!Number.isInteger(settings.durationMinutes) || settings.durationMinutes < d.min || settings.durationMinutes > d.max) {
      throw HttpError.unprocessable('INVALID_QUIZ_SETTINGS', `Quiz duration must be ${d.min}-${d.max} minutes`);
    }
    if (!Number.isInteger(settings.questionCount) || settings.questionCount < c.min || settings.questionCount > c.max) {
      throw HttpError.unprocessable('INVALID_QUIZ_SETTINGS', `Question count must be ${c.min}-${c.max}`);
    }
    if (!(await this.deps.repository.setSettings(tenantId, actor, courseId, settings))) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
  }

  /** Sets when each day's quiz opens and closes. Empty = no limit on that side. */
  async updateWindows(tenantId: string, actor: Actor, courseId: string, windows: QuizWindow[]): Promise<void> {
    for (const w of windows) {
      if (w.opensAt && w.closesAt && w.closesAt.getTime() <= w.opensAt.getTime()) {
        throw HttpError.unprocessable('INVALID_QUIZ_WINDOW', 'The quiz must close after it opens');
      }
    }
    const result = await this.deps.repository.setWindows(tenantId, actor, courseId, windows);
    if (result === 'not_found') throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    if (result === 'unknown_day') throw HttpError.unprocessable('UNKNOWN_DAY', 'One of the days does not belong to this course');
  }

  async importSheet(tenantId: string, actor: Actor, courseId: string, file: Buffer, mode: 'append' | 'replace'): Promise<ImportOutcome> {
    if (file.length > QUIZ_LIMITS.maxFileBytes) throw HttpError.unprocessable('FILE_TOO_LARGE', 'The file is larger than 2 MB');
    const days = await this.deps.repository.courseDays(tenantId, courseId);
    if (!days) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');

    const { questions, errors } = await parseQuestionSheet(file, days.length);
    // All or nothing: a sheet with any bad row imports nothing, so the bank never half-updates.
    if (errors.length > 0) {
      throw HttpError.unprocessable('INVALID_QUESTION_SHEET', 'The question sheet has errors', { errors: errors.slice(0, 50), total_errors: errors.length });
    }

    const rows = questions.map((q) => ({ ...q, moduleId: q.day ? (days[q.day - 1]?.id ?? null) : null }));
    const outcome = await this.deps.repository.importQuestions(tenantId, actor, courseId, rows, mode);
    if (!outcome) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return outcome;
  }

  /** The bank as .xlsx, or the filled-in template when `template` is set or the bank is empty. */
  async exportSheet(tenantId: string, courseId: string, template: boolean): Promise<Buffer> {
    const [days, questions] = await Promise.all([this.deps.repository.courseDays(tenantId, courseId), this.deps.repository.listQuestions(tenantId, courseId)]);
    if (!days) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    const dayNumber = new Map(days.map((d, i) => [d.id, i + 1]));
    return buildQuestionWorkbook(
      questions.map((q) => ({
        code: q.code,
        body: q.body,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        correctOptions: q.correctOptions,
        points: q.points,
        required: q.required,
        difficulty: q.difficulty,
        day: q.moduleId ? (dayNumber.get(q.moduleId) ?? null) : null,
      })),
      template || questions.length === 0,
    );
  }

  /** Same rules as the Excel sheet, applied to one question typed in the form. */
  private async validated(tenantId: string, courseId: string, draft: QuestionDraft): Promise<{ input: QuestionInput; dayNumber: number | null }> {
    const days = await this.deps.repository.courseDays(tenantId, courseId);
    if (!days) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    const dayIndex = draft.dayId ? days.findIndex((d) => d.id === draft.dayId) : -1;
    if (draft.dayId && dayIndex < 0) throw HttpError.unprocessable('UNKNOWN_DAY', 'The day does not belong to this course');

    const L = QUIZ_LIMITS;
    const body = draft.body.trim();
    if (body.length < 1 || body.length > L.maxBodyLength) throw HttpError.unprocessable('INVALID_QUESTION', `Question text must be 1-${L.maxBodyLength} characters`);
    if (!Number.isInteger(draft.points) || draft.points < L.points.min || draft.points > L.points.max) {
      throw HttpError.unprocessable('INVALID_QUESTION', `Points must be a whole number from ${L.points.min} to ${L.points.max}`);
    }
    const base = { moduleId: draft.dayId, body, type: draft.type, difficulty: draft.difficulty, points: draft.points, required: draft.required };
    const dayNumber = dayIndex >= 0 ? dayIndex + 1 : null;

    if (draft.type === 'RATING') return { input: { ...base, options: [], correctAnswer: '', correctOptions: [] }, dayNumber };
    if (draft.type === 'SHORT' || draft.type === 'TEXT') {
      const model = draft.correctAnswer.trim();
      if (model.length > (draft.type === 'SHORT' ? L.maxShortAnswer : L.maxBodyLength)) throw HttpError.unprocessable('INVALID_QUESTION', 'The model answer is too long');
      return { input: { ...base, options: [], correctAnswer: model, correctOptions: [] }, dayNumber };
    }

    const options = draft.options.map((o) => o.trim()).filter(Boolean);
    if (options.length < L.options.min || options.length > L.options.max) {
      throw HttpError.unprocessable('INVALID_QUESTION', `A choice question needs ${L.options.min}-${L.options.max} options`);
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw HttpError.unprocessable('INVALID_QUESTION', 'Options must not repeat');
    if (options.some((o) => o.length > L.maxOptionLength)) throw HttpError.unprocessable('INVALID_QUESTION', `An option is longer than ${L.maxOptionLength} characters`);
    const find = (text: string) => options.find((o) => o.toLowerCase() === text.trim().toLowerCase());

    if (draft.type === 'MCQ') {
      const correct = find(draft.correctAnswer);
      if (!correct) throw HttpError.unprocessable('INVALID_QUESTION', 'Choose which option is correct');
      return { input: { ...base, options, correctAnswer: correct, correctOptions: [] }, dayNumber };
    }
    const picked = draft.correctOptions.map(find);
    if (picked.length === 0 || picked.some((o) => !o)) throw HttpError.unprocessable('INVALID_QUESTION', 'Choose every correct option');
    return { input: { ...base, options, correctAnswer: '', correctOptions: [...new Set(picked as string[])] }, dayNumber };
  }

  async createQuestion(tenantId: string, actor: Actor, courseId: string, draft: QuestionDraft): Promise<string> {
    const { input, dayNumber } = await this.validated(tenantId, courseId, draft);
    // Form-made questions get F_D1_001 / F_ALL_001, a prefix the Excel template does not use, so
    // importing a sheet (which updates questions by Question_ID) cannot overwrite them by accident.
    const taken = new Set((await this.deps.repository.listQuestions(tenantId, courseId)).map((q) => q.code.toLowerCase()));
    const prefix = dayNumber ? `F_D${dayNumber}_` : 'F_ALL_';
    let n = 1;
    while (taken.has(`${prefix}${String(n).padStart(3, '0')}`.toLowerCase())) n++;
    const result = await this.deps.repository.createQuestion(tenantId, actor, courseId, `${prefix}${String(n).padStart(3, '0')}`, input);
    if (result.kind === 'not_found') throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    if (result.kind === 'duplicate') throw HttpError.conflict('QUESTION_CODE_TAKEN', 'Another question was added at the same moment; try again');
    return result.id;
  }

  async updateQuestion(tenantId: string, actor: Actor, courseId: string, questionId: string, draft: QuestionDraft): Promise<void> {
    const { input } = await this.validated(tenantId, courseId, draft);
    if (!(await this.deps.repository.updateQuestion(tenantId, actor, courseId, questionId, input))) throw HttpError.notFound('QUESTION_NOT_FOUND', 'Question not found');
  }

  async deleteQuestion(tenantId: string, actor: Actor, courseId: string, questionId: string): Promise<void> {
    if (!(await this.deps.repository.deleteQuestion(tenantId, actor, courseId, questionId))) throw HttpError.notFound('QUESTION_NOT_FOUND', 'Question not found');
  }

  async results(tenantId: string, courseId: string): Promise<AttemptSummaryRow[]> {
    if (!(await this.deps.repository.courseDays(tenantId, courseId))) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return this.deps.repository.results(tenantId, courseId);
  }

  // ---- learner: take the day's quiz ---------------------------------------------------------

  private async context(tenantId: string, user: Who, moduleId: string): Promise<ModuleQuizContext> {
    const repo = this.deps.repository;
    const ctx = STAFF_ROLES.has(user.role) ? await repo.staffModuleContext(tenantId, moduleId) : await repo.moduleContext(tenantId, user.id, moduleId);
    // Same answer for "no such day" and "not enrolled": don't reveal course structure.
    if (!ctx) throw HttpError.forbidden('Enroll in this course to take its quiz');
    return ctx;
  }

  async status(tenantId: string, user: Who, moduleId: string): Promise<QuizStatus> {
    const ctx = await this.context(tenantId, user, moduleId);
    const pool = await this.deps.repository.poolFor(tenantId, ctx.courseId, moduleId);
    let attempt = await this.deps.repository.findAttempt(tenantId, user.id, moduleId);
    // Walked away and the window closed: settle it now so the result (and score 0) is on record.
    if (attempt && !attempt.submittedAt && this.expired(attempt)) attempt = await this.finalize(tenantId, user.id, attempt, {});
    return {
      available: pool.length > 0,
      durationMinutes: ctx.settings.durationMinutes,
      questionCount: Math.min(ctx.settings.questionCount, pool.length),
      opensAt: ctx.opensAt,
      closesAt: ctx.closesAt,
      window: this.windowState(ctx),
      serverNow: this.now(),
      attempt: attempt ? this.view(attempt) : null,
    };
  }

  /** Starts the single attempt (or resumes it while the clock is still running). */
  async start(tenantId: string, user: Who, moduleId: string): Promise<QuizStatus> {
    const ctx = await this.context(tenantId, user, moduleId);
    const existing = await this.deps.repository.findAttempt(tenantId, user.id, moduleId);
    if (!existing) {
      const pool = await this.deps.repository.poolFor(tenantId, ctx.courseId, moduleId);
      if (pool.length === 0) throw HttpError.conflict('QUIZ_NOT_AVAILABLE', 'No quiz questions for this day');
      // The supervisor's window is enforced here, not in the browser.
      const state = this.windowState(ctx);
      if (state === 'not_open') throw HttpError.conflict('QUIZ_NOT_OPEN', 'The quiz is not open yet');
      if (state === 'closed') throw HttpError.conflict('QUIZ_CLOSED', 'The quiz is closed');
      // Time allowed, but never past the moment the supervisor closes the quiz.
      const byDuration = this.now().getTime() + ctx.settings.durationMinutes * 60_000;
      await this.deps.repository.createAttempt(tenantId, {
        courseId: ctx.courseId,
        moduleId,
        userId: user.id,
        expiresAt: new Date(ctx.closesAt ? Math.min(byDuration, ctx.closesAt.getTime()) : byDuration),
        questions: this.draw(pool, ctx.settings.questionCount),
      });
    }
    return this.status(tenantId, user, moduleId);
  }

  async submit(tenantId: string, user: Who, moduleId: string, answers: Record<string, unknown>): Promise<QuizResult> {
    await this.context(tenantId, user, moduleId);
    const attempt = await this.deps.repository.findAttempt(tenantId, user.id, moduleId);
    if (!attempt) throw HttpError.conflict('QUIZ_NOT_STARTED', 'Start the quiz first');
    if (attempt.submittedAt) throw HttpError.conflict('QUIZ_ALREADY_SUBMITTED', 'This quiz was already submitted');
    if (this.expired(attempt)) {
      // Too late: the window closed on the server. Close the attempt with nothing answered.
      await this.finalize(tenantId, user.id, attempt, {});
      throw HttpError.conflict('QUIZ_EXPIRED', 'The quiz time is over');
    }
    // "Required" questions must be answered before an early submit. Near or after the deadline the
    // browser's auto-submit sends whatever there is, and that must always be accepted.
    if (this.now().getTime() < attempt.expiresAt.getTime() - AUTO_SUBMIT_SLACK_MS) {
      const missing = attempt.questions.filter((q) => q.required && cleanAnswer(q, answers[q.id]) === undefined).map((q) => q.id);
      if (missing.length > 0) throw HttpError.unprocessable('QUIZ_REQUIRED_MISSING', 'Answer the required questions first', { missing });
    }
    return this.result(await this.finalize(tenantId, user.id, attempt, answers));
  }

  // ---- internals ----------------------------------------------------------------------------

  private windowState(ctx: Pick<ModuleQuizContext, 'opensAt' | 'closesAt'>): 'not_open' | 'open' | 'closed' {
    const now = this.now().getTime();
    if (ctx.opensAt && now < ctx.opensAt.getTime()) return 'not_open';
    if (ctx.closesAt && now >= ctx.closesAt.getTime()) return 'closed';
    return 'open';
  }

  private expired(a: QuizAttemptRow): boolean {
    return this.now().getTime() > a.expiresAt.getTime() + GRACE_MS;
  }

  /** Fisher-Yates over a copy: `count` questions in random order, each choice question's options shuffled too. */
  private draw(pool: QuizQuestionRow[], count: number): AttemptQuestion[] {
    const shuffle = <T>(items: T[]): T[] => {
      const a = [...items];
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.random(i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    return shuffle(pool)
      .slice(0, Math.min(count, pool.length))
      .map((q) => ({
        id: q.id,
        body: q.body,
        type: q.type,
        options: hasOptions(q.type) ? shuffle(q.options) : [],
        correctAnswer: q.correctAnswer,
        correctOptions: q.correctOptions,
        points: q.points,
        required: q.required,
      }));
  }

  /** Grades the choice questions by points (an answer is the option's index in THIS attempt) and stores the outcome once. */
  private async finalize(tenantId: string, userId: string, attempt: QuizAttemptRow, raw: Record<string, unknown>): Promise<QuizAttemptRow> {
    const clean: Record<string, AnswerValue> = {};
    let score = 0;
    let maxScore = 0;
    for (const q of attempt.questions) {
      const answer = cleanAnswer(q, raw[q.id]);
      if (answer !== undefined) clean[q.id] = answer;
      if (isGraded(q.type)) {
        maxScore += pointsOf(q);
        if (isCorrect(q, answer)) score += pointsOf(q);
      }
    }
    const at = this.now();
    if (await this.deps.repository.submitAttempt(tenantId, attempt.id, { answers: clean, score, maxScore, at })) {
      return { ...attempt, answers: clean, score, maxScore, submittedAt: at };
    }
    // Lost a race with another request (double submit / auto-submit): the stored one stands.
    const stored = await this.deps.repository.findAttempt(tenantId, userId, attempt.moduleId);
    if (!stored?.submittedAt) throw HttpError.conflict('QUIZ_ALREADY_SUBMITTED', 'This quiz was already submitted');
    return stored;
  }

  private result(a: QuizAttemptRow): QuizResult {
    const maxScore = a.maxScore ?? 0;
    const score = a.score ?? 0;
    return {
      score,
      maxScore,
      percent: maxScore > 0 ? Math.round((score / maxScore) * 100) : null,
      submittedAt: a.submittedAt ?? this.now(),
      questions: a.questions.map((q) => {
        const given = a.answers[q.id];
        const correct = isCorrect(q, given);
        return {
          id: q.id,
          body: q.body,
          type: q.type,
          options: q.options,
          points: pointsOf(q),
          required: q.required ?? false,
          yourAnswer: given ?? null,
          correctAnswer: q.correctAnswer,
          correctOptions: q.correctOptions ?? [],
          isCorrect: correct,
          earned: correct === null ? null : correct ? pointsOf(q) : 0,
        };
      }),
    };
  }

  private view(a: QuizAttemptRow): NonNullable<QuizStatus['attempt']> {
    if (a.submittedAt) return { state: 'submitted', result: this.result(a) };
    // Correct answers never leave the server while the clock is running.
    return { state: 'in_progress', expiresAt: a.expiresAt, questions: a.questions.map((q) => {
        const { correctAnswer: _hidden, correctOptions: _key, ...visible } = q;
        return { ...visible, points: pointsOf(q), required: q.required ?? false };
      }),
    };
  }
}
