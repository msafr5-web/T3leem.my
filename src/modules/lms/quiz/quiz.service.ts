import { randomInt } from 'node:crypto';
import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import { QUIZ_LIMITS, buildQuestionWorkbook, parseQuestionSheet } from './quiz.excel';
import type {
  AttemptQuestion,
  AttemptSummaryRow,
  ImportOutcome,
  ModuleQuizContext,
  QuizAttemptRow,
  QuizDay,
  QuizQuestionRow,
  QuizRepository,
  QuizSettings,
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
  type: 'MCQ' | 'TEXT';
  options: string[];
  yourAnswer: string | number | null;
  /** MCQ: the right option's text; TEXT: the supervisor's model answer (may be empty). */
  correctAnswer: string;
  /** null for TEXT questions (not auto-graded). */
  isCorrect: boolean | null;
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
  serverNow: Date;
  attempt:
    | null
    | { state: 'in_progress'; expiresAt: Date; questions: Omit<AttemptQuestion, 'correctAnswer'>[] }
    | { state: 'submitted'; result: QuizResult };
}

export interface QuizServiceDeps {
  repository: QuizRepository;
  now?: () => Date;
  /** Injectable for tests; defaults to a CSPRNG so a learner can't predict their draw. */
  random?: (maxExclusive: number) => number;
}

type Who = { id: string; role: string };

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
        difficulty: q.difficulty,
        day: q.moduleId ? (dayNumber.get(q.moduleId) ?? null) : null,
      })),
      template || questions.length === 0,
    );
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
      await this.deps.repository.createAttempt(tenantId, {
        courseId: ctx.courseId,
        moduleId,
        userId: user.id,
        expiresAt: new Date(this.now().getTime() + ctx.settings.durationMinutes * 60_000),
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
    return this.result(await this.finalize(tenantId, user.id, attempt, answers));
  }

  // ---- internals ----------------------------------------------------------------------------

  private expired(a: QuizAttemptRow): boolean {
    return this.now().getTime() > a.expiresAt.getTime() + GRACE_MS;
  }

  /** Fisher-Yates over a copy: `count` questions in random order, each MCQ's options shuffled too. */
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
      .map((q) => ({ id: q.id, body: q.body, type: q.type, options: q.type === 'MCQ' ? shuffle(q.options) : [], correctAnswer: q.correctAnswer }));
  }

  /** Grades MCQs (an answer is the option's index in THIS attempt) and stores the outcome once. */
  private async finalize(tenantId: string, userId: string, attempt: QuizAttemptRow, raw: Record<string, unknown>): Promise<QuizAttemptRow> {
    const clean: Record<string, string | number> = {};
    let score = 0;
    let maxScore = 0;
    for (const q of attempt.questions) {
      const given = raw[q.id];
      if (q.type === 'MCQ') {
        maxScore++;
        if (typeof given === 'number' && Number.isInteger(given) && given >= 0 && given < q.options.length) {
          clean[q.id] = given;
          if (q.options[given] === q.correctAnswer) score++;
        }
      } else if (typeof given === 'string' && given.trim()) {
        clean[q.id] = given.trim().slice(0, QUIZ_LIMITS.maxBodyLength);
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
        return {
          id: q.id,
          body: q.body,
          type: q.type,
          options: q.options,
          yourAnswer: given ?? null,
          correctAnswer: q.correctAnswer,
          isCorrect: q.type === 'MCQ' ? typeof given === 'number' && q.options[given] === q.correctAnswer : null,
        };
      }),
    };
  }

  private view(a: QuizAttemptRow): NonNullable<QuizStatus['attempt']> {
    if (a.submittedAt) return { state: 'submitted', result: this.result(a) };
    // Correct answers never leave the server while the clock is running.
    return { state: 'in_progress', expiresAt: a.expiresAt, questions: a.questions.map(({ correctAnswer: _hidden, ...q }) => q) };
  }
}
