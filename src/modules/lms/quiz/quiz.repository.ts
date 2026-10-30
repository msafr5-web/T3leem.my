import { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import type { Actor } from '../../provider/provider.types';
import type { Difficulty, ParsedQuestion, QuestionType } from './quiz.excel';

export interface QuizSettings {
  durationMinutes: number;
  questionCount: number;
}

export interface QuizQuestionRow {
  id: string;
  code: string;
  body: string;
  type: QuestionType;
  options: string[];
  /** MCQ: the right option's text. SHORT / TEXT: the model answer. */
  correctAnswer: string;
  /** CHECKBOX: the text of every right option. */
  correctOptions: string[];
  points: number;
  required: boolean;
  difficulty: Difficulty;
  /** null = shared course pool. */
  moduleId: string | null;
}

/** A learner's answer: MCQ = option index, CHECKBOX = option indexes, RATING = 1-5, SHORT/TEXT = the text. */
export type AnswerValue = string | number | number[];

/** A question frozen into an attempt (options already shuffled for this learner). */
export interface AttemptQuestion {
  id: string;
  body: string;
  type: QuestionType;
  options: string[];
  correctAnswer: string;
  /** Attempts started before points / required existed lack these: read them with `?? default`. */
  correctOptions?: string[];
  points?: number;
  required?: boolean;
}

export interface QuizAttemptRow {
  id: string;
  courseId: string;
  moduleId: string;
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  questions: AttemptQuestion[];
  answers: Record<string, AnswerValue>;
  score: number | null;
  maxScore: number | null;
}

export interface AttemptSummaryRow {
  id: string;
  learnerName: string;
  learnerEmail: string;
  dayTitle: string;
  startedAt: Date;
  submittedAt: Date | null;
  score: number | null;
  maxScore: number | null;
  textAnswers: { question: string; answer: string }[];
}

export interface QuizDay {
  id: string;
  title: string;
  /** When the day's quiz opens / closes (null = no limit). */
  opensAt: Date | null;
  closesAt: Date | null;
}

export interface QuizWindow {
  moduleId: string;
  opensAt: Date | null;
  closesAt: Date | null;
}

/** A question typed in by the supervisor (same shape the Excel import produces). */
export interface QuestionInput {
  moduleId: string | null;
  body: string;
  type: QuestionType;
  options: string[];
  correctAnswer: string;
  correctOptions: string[];
  points: number;
  required: boolean;
  difficulty: Difficulty;
}

export interface ImportOutcome {
  created: number;
  updated: number;
  removed: number;
}

/** What a learner needs to know about a day to take its quiz. */
export interface ModuleQuizContext {
  courseId: string;
  moduleTitle: string;
  settings: QuizSettings;
  opensAt: Date | null;
  closesAt: Date | null;
}

export interface QuizRepository {
  /** Days of the course in order; null = no such course in this academy. */
  courseDays(tenantId: string, courseId: string): Promise<QuizDay[] | null>;
  getSettings(tenantId: string, courseId: string): Promise<QuizSettings | null>;
  setSettings(tenantId: string, actor: Actor, courseId: string, settings: QuizSettings): Promise<boolean>;
  /** Sets each day's quiz window. 'unknown_day' = a module that is not a day of this course. */
  setWindows(tenantId: string, actor: Actor, courseId: string, windows: QuizWindow[]): Promise<'ok' | 'not_found' | 'unknown_day'>;
  listQuestions(tenantId: string, courseId: string): Promise<QuizQuestionRow[]>;
  /** Upserts by Question_ID; 'replace' also removes every question that is not in the file. */
  importQuestions(tenantId: string, actor: Actor, courseId: string, rows: (ParsedQuestion & { moduleId: string | null })[], mode: 'append' | 'replace'): Promise<ImportOutcome | null>;
  /** Adds one question with a ready-made unique code. 'duplicate' = that code was taken meanwhile. */
  createQuestion(tenantId: string, actor: Actor, courseId: string, code: string, input: QuestionInput): Promise<{ kind: 'ok'; id: string } | { kind: 'not_found' } | { kind: 'duplicate' }>;
  /** Rewrites a question (its code stays). false = no such question in this course. */
  updateQuestion(tenantId: string, actor: Actor, courseId: string, questionId: string, input: QuestionInput): Promise<boolean>;
  deleteQuestion(tenantId: string, actor: Actor, courseId: string, questionId: string): Promise<boolean>;
  results(tenantId: string, courseId: string): Promise<AttemptSummaryRow[]>;

  /** Learner side. null = the learner is not enrolled in (or there is no) course for this day. */
  moduleContext(tenantId: string, userId: string, moduleId: string): Promise<ModuleQuizContext | null>;
  /** Same lookup for academy staff (no enrollment needed). */
  staffModuleContext(tenantId: string, moduleId: string): Promise<ModuleQuizContext | null>;
  /** The day's own questions, or the shared pool when the day has none. */
  poolFor(tenantId: string, courseId: string, moduleId: string): Promise<QuizQuestionRow[]>;
  findAttempt(tenantId: string, userId: string, moduleId: string): Promise<QuizAttemptRow | null>;
  /** Creates the attempt; if a concurrent request already did, returns that one (one attempt per day). */
  createAttempt(
    tenantId: string,
    input: { courseId: string; moduleId: string; userId: string; expiresAt: Date; questions: AttemptQuestion[] },
  ): Promise<QuizAttemptRow>;
  /** Stores the answers and score once; false when it was already submitted. */
  submitAttempt(tenantId: string, attemptId: string, input: { answers: Record<string, AnswerValue>; score: number; maxScore: number; at: Date }): Promise<boolean>;
}

const displayName = (u: { fullName: string | null; email: string }) => u.fullName ?? u.email.split('@')[0] ?? u.email;

const toRow = (q: { id: string; code: string; body: string; type: QuestionType; options: Prisma.JsonValue; correctAnswer: string; correctOptions: Prisma.JsonValue; points: number; required: boolean; difficulty: Difficulty; moduleId: string | null }): QuizQuestionRow => ({
  id: q.id,
  code: q.code,
  body: q.body,
  type: q.type,
  options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string') : [],
  correctAnswer: q.correctAnswer,
  correctOptions: Array.isArray(q.correctOptions) ? q.correctOptions.filter((o): o is string => typeof o === 'string') : [],
  points: q.points,
  required: q.required,
  difficulty: q.difficulty,
  moduleId: q.moduleId,
});

const toAttempt = (a: {
  id: string; courseId: string; moduleId: string; startedAt: Date; expiresAt: Date; submittedAt: Date | null;
  questions: Prisma.JsonValue; answers: Prisma.JsonValue; score: number | null; maxScore: number | null;
}): QuizAttemptRow => ({
  id: a.id,
  courseId: a.courseId,
  moduleId: a.moduleId,
  startedAt: a.startedAt,
  expiresAt: a.expiresAt,
  submittedAt: a.submittedAt,
  questions: a.questions as unknown as AttemptQuestion[],
  answers: (a.answers ?? {}) as Record<string, AnswerValue>,
  score: a.score,
  maxScore: a.maxScore,
});

const audit = (tx: Prisma.TransactionClient, tenantId: string, actor: Actor, action: string, courseId: string, metadata: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType: 'course', entityId: courseId, metadata, ipAddress: actor.ip } });

const ATTEMPT_SELECT = { id: true, courseId: true, moduleId: true, startedAt: true, expiresAt: true, submittedAt: true, questions: true, answers: true, score: true, maxScore: true } as const;

export class PrismaQuizRepository implements QuizRepository {
  async courseDays(tenantId: string, courseId: string): Promise<QuizDay[] | null> {
    const c = await forTenant(tenantId).course.findFirst({
      where: { tenantId, id: courseId },
      select: { modules: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, quizOpensAt: true, quizClosesAt: true } } },
    });
    return c ? c.modules.map((m) => ({ id: m.id, title: m.title, opensAt: m.quizOpensAt, closesAt: m.quizClosesAt })) : null;
  }

  async getSettings(tenantId: string, courseId: string): Promise<QuizSettings | null> {
    const c = await forTenant(tenantId).course.findFirst({ where: { tenantId, id: courseId }, select: { quizDurationMinutes: true, quizQuestionCount: true } });
    return c ? { durationMinutes: c.quizDurationMinutes, questionCount: c.quizQuestionCount } : null;
  }

  setSettings(tenantId: string, actor: Actor, courseId: string, settings: QuizSettings): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const found = await tx.course.findFirst({ where: { tenantId, id: courseId }, select: { id: true } });
      if (!found) return false;
      await tx.course.update({ where: { id: courseId }, data: { quizDurationMinutes: settings.durationMinutes, quizQuestionCount: settings.questionCount } });
      await audit(tx, tenantId, actor, 'quiz.settings_changed', courseId, { ...settings });
      return true;
    });
  }

  setWindows(tenantId: string, actor: Actor, courseId: string, windows: QuizWindow[]): Promise<'ok' | 'not_found' | 'unknown_day'> {
    return withTenantTransaction(tenantId, async (tx) => {
      const course = await tx.course.findFirst({ where: { tenantId, id: courseId }, select: { modules: { select: { id: true } } } });
      if (!course) return 'not_found' as const;
      // A module id from another course/academy would pass the FK; only this course's days are accepted.
      const own = new Set(course.modules.map((m) => m.id));
      if (windows.some((w) => !own.has(w.moduleId))) return 'unknown_day' as const;
      for (const w of windows) {
        await tx.module.update({ where: { id: w.moduleId }, data: { quizOpensAt: w.opensAt, quizClosesAt: w.closesAt } });
      }
      await audit(tx, tenantId, actor, 'quiz.windows_changed', courseId, { days: windows.length });
      return 'ok' as const;
    });
  }

  async listQuestions(tenantId: string, courseId: string): Promise<QuizQuestionRow[]> {
    const rows = await forTenant(tenantId).quizQuestion.findMany({ where: { tenantId, courseId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toRow);
  }

  importQuestions(tenantId: string, actor: Actor, courseId: string, rows: (ParsedQuestion & { moduleId: string | null })[], mode: 'append' | 'replace'): Promise<ImportOutcome | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const course = await tx.course.findFirst({ where: { tenantId, id: courseId }, select: { id: true } });
      if (!course) return null;

      const existing = new Map((await tx.quizQuestion.findMany({ where: { tenantId, courseId }, select: { id: true, code: true } })).map((q) => [q.code.toLowerCase(), q.id]));
      let created = 0;
      let updated = 0;
      const keep = new Set<string>();
      for (const [i, q] of rows.entries()) {
        const data = {
          body: q.body,
          type: q.type,
          options: q.options as Prisma.InputJsonValue,
          correctAnswer: q.correctAnswer,
          correctOptions: q.correctOptions as Prisma.InputJsonValue,
          points: q.points,
          required: q.required,
          difficulty: q.difficulty,
          moduleId: q.moduleId,
          sortOrder: i,
        };
        const id = existing.get(q.code.toLowerCase());
        if (id) {
          await tx.quizQuestion.update({ where: { id }, data });
          keep.add(id);
          updated++;
        } else {
          const row = await tx.quizQuestion.create({ data: { tenantId, courseId, code: q.code, ...data }, select: { id: true } });
          keep.add(row.id);
          created++;
        }
      }
      let removed = 0;
      if (mode === 'replace') {
        removed = (await tx.quizQuestion.deleteMany({ where: { tenantId, courseId, id: { notIn: [...keep] } } })).count;
      }
      await audit(tx, tenantId, actor, 'quiz.questions_imported', courseId, { mode, created, updated, removed });
      return { created, updated, removed };
    });
  }

  async createQuestion(tenantId: string, actor: Actor, courseId: string, code: string, input: QuestionInput) {
    try {
      return await withTenantTransaction(tenantId, async (tx) => {
        const course = await tx.course.findFirst({ where: { tenantId, id: courseId }, select: { id: true } });
        if (!course) return { kind: 'not_found' } as const;
        const count = await tx.quizQuestion.count({ where: { tenantId, courseId } });
        const row = await tx.quizQuestion.create({
          data: { tenantId, courseId, code, ...input, options: input.options as Prisma.InputJsonValue, correctOptions: input.correctOptions as Prisma.InputJsonValue, sortOrder: count },
          select: { id: true },
        });
        await audit(tx, tenantId, actor, 'quiz.question_created', courseId, { questionId: row.id, code });
        return { kind: 'ok', id: row.id } as const;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { kind: 'duplicate' } as const;
      throw err;
    }
  }

  updateQuestion(tenantId: string, actor: Actor, courseId: string, questionId: string, input: QuestionInput): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.quizQuestion.updateMany({
        where: { tenantId, courseId, id: questionId },
        data: { ...input, options: input.options as Prisma.InputJsonValue, correctOptions: input.correctOptions as Prisma.InputJsonValue },
      });
      if (count === 0) return false;
      await audit(tx, tenantId, actor, 'quiz.question_updated', courseId, { questionId });
      return true;
    });
  }

  deleteQuestion(tenantId: string, actor: Actor, courseId: string, questionId: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.quizQuestion.deleteMany({ where: { tenantId, courseId, id: questionId } });
      if (count === 0) return false;
      await audit(tx, tenantId, actor, 'quiz.question_deleted', courseId, { questionId });
      return true;
    });
  }

  async results(tenantId: string, courseId: string): Promise<AttemptSummaryRow[]> {
    const rows = await forTenant(tenantId).quizAttempt.findMany({
      where: { tenantId, courseId },
      orderBy: { startedAt: 'desc' },
      take: 500,
      select: { id: true, startedAt: true, submittedAt: true, score: true, maxScore: true, questions: true, answers: true, user: { select: { fullName: true, email: true, role: true } }, module: { select: { title: true } } },
    });
    return rows.map((a) => {
      const answers = (a.answers ?? {}) as Record<string, AnswerValue>;
      const questions = a.questions as unknown as AttemptQuestion[];
      return {
        id: a.id,
        learnerName: displayName(a.user),
        learnerEmail: a.user.email,
        dayTitle: a.module.title,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        score: a.score,
        maxScore: a.maxScore,
        textAnswers: questions.filter((q) => (q.type === 'TEXT' || q.type === 'SHORT') && typeof answers[q.id] === 'string' && String(answers[q.id]).trim()).map((q) => ({ question: q.body, answer: String(answers[q.id]) })),
      };
    });
  }

  private async context(tenantId: string, moduleId: string, enrolledUserId: string | null): Promise<ModuleQuizContext | null> {
    const mod = await forTenant(tenantId).module.findFirst({
      where: {
        tenantId,
        id: moduleId,
        ...(enrolledUserId ? { course: { enrollments: { some: { tenantId, userId: enrolledUserId, status: 'ACTIVE' as const } } } } : {}),
      },
      select: { title: true, courseId: true, quizOpensAt: true, quizClosesAt: true, course: { select: { quizDurationMinutes: true, quizQuestionCount: true } } },
    });
    return mod
      ? {
          courseId: mod.courseId,
          moduleTitle: mod.title,
          settings: { durationMinutes: mod.course.quizDurationMinutes, questionCount: mod.course.quizQuestionCount },
          opensAt: mod.quizOpensAt,
          closesAt: mod.quizClosesAt,
        }
      : null;
  }

  moduleContext(tenantId: string, userId: string, moduleId: string) {
    return this.context(tenantId, moduleId, userId);
  }

  staffModuleContext(tenantId: string, moduleId: string) {
    return this.context(tenantId, moduleId, null);
  }

  async poolFor(tenantId: string, courseId: string, moduleId: string): Promise<QuizQuestionRow[]> {
    const db = forTenant(tenantId);
    const own = await db.quizQuestion.findMany({ where: { tenantId, courseId, moduleId } });
    if (own.length > 0) return own.map(toRow);
    return (await db.quizQuestion.findMany({ where: { tenantId, courseId, moduleId: null } })).map(toRow);
  }

  async findAttempt(tenantId: string, userId: string, moduleId: string): Promise<QuizAttemptRow | null> {
    const a = await forTenant(tenantId).quizAttempt.findFirst({ where: { tenantId, userId, moduleId }, select: ATTEMPT_SELECT });
    return a ? toAttempt(a) : null;
  }

  async createAttempt(tenantId: string, input: { courseId: string; moduleId: string; userId: string; expiresAt: Date; questions: AttemptQuestion[] }): Promise<QuizAttemptRow> {
    try {
      const a = await forTenant(tenantId).quizAttempt.create({
        data: { tenantId, courseId: input.courseId, moduleId: input.moduleId, userId: input.userId, expiresAt: input.expiresAt, questions: input.questions as unknown as Prisma.InputJsonValue },
        select: ATTEMPT_SELECT,
      });
      return toAttempt(a);
    } catch (err) {
      // Double click / two tabs: the unique (user, day) index made the second insert fail; reuse the first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.findAttempt(tenantId, input.userId, input.moduleId);
        if (existing) return existing;
      }
      throw err;
    }
  }

  async submitAttempt(tenantId: string, attemptId: string, input: { answers: Record<string, AnswerValue>; score: number; maxScore: number; at: Date }): Promise<boolean> {
    // The `submittedAt: null` guard makes the first submission win under concurrent requests.
    const { count } = await forTenant(tenantId).quizAttempt.updateMany({
      where: { tenantId, id: attemptId, submittedAt: null },
      data: { answers: input.answers as Prisma.InputJsonValue, score: input.score, maxScore: input.maxScore, submittedAt: input.at },
    });
    return count === 1;
  }
}

