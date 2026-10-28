import { randomUUID } from 'node:crypto';
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
} from '../../../src/modules/lms/quiz/quiz.repository';
import { QuizService } from '../../../src/modules/lms/quiz/quiz.service';

export interface QuizFakeOptions {
  tenantA: string;
  courseId: string;
  days: QuizDay[];
  /** Users that hold an ACTIVE enrollment in the course. */
  enrolled: string[];
}

/** In-memory QuizRepository for ONE course, mirroring the SQL semantics that matter (unique code, one attempt per day). */
export class InMemoryQuizRepository implements QuizRepository {
  settings: QuizSettings = { durationMinutes: 10, questionCount: 3 };
  questions: QuizQuestionRow[] = [];
  attempts: (QuizAttemptRow & { userId: string })[] = [];

  constructor(private readonly o: QuizFakeOptions) {}

  private mine(tenantId: string, courseId: string) {
    return tenantId === this.o.tenantA && courseId === this.o.courseId;
  }

  async courseDays(tenantId: string, courseId: string) {
    return this.mine(tenantId, courseId) ? this.o.days : null;
  }
  async getSettings(tenantId: string, courseId: string) {
    return this.mine(tenantId, courseId) ? this.settings : null;
  }
  async setSettings(tenantId: string, _a: unknown, courseId: string, settings: QuizSettings) {
    if (!this.mine(tenantId, courseId)) return false;
    this.settings = settings;
    return true;
  }
  async listQuestions(tenantId: string, courseId: string) {
    return this.mine(tenantId, courseId) ? this.questions : [];
  }
  async importQuestions(
    tenantId: string,
    _a: unknown,
    courseId: string,
    rows: { code: string; body: string; type: 'MCQ' | 'TEXT'; options: string[]; correctAnswer: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; moduleId: string | null }[],
    mode: 'append' | 'replace',
  ): Promise<ImportOutcome | null> {
    if (!this.mine(tenantId, courseId)) return null;
    let created = 0;
    let updated = 0;
    const keep = new Set<string>();
    for (const r of rows) {
      const found = this.questions.find((q) => q.code.toLowerCase() === r.code.toLowerCase());
      if (found) {
        Object.assign(found, r);
        keep.add(found.id);
        updated++;
      } else {
        const id = randomUUID();
        this.questions.push({ id, ...r });
        keep.add(id);
        created++;
      }
    }
    let removed = 0;
    if (mode === 'replace') {
      const before = this.questions.length;
      this.questions = this.questions.filter((q) => keep.has(q.id));
      removed = before - this.questions.length;
    }
    return { created, updated, removed };
  }
  async deleteQuestion(tenantId: string, _a: unknown, courseId: string, id: string) {
    if (!this.mine(tenantId, courseId)) return false;
    const before = this.questions.length;
    this.questions = this.questions.filter((q) => q.id !== id);
    return this.questions.length < before;
  }
  async results(): Promise<AttemptSummaryRow[]> {
    return this.attempts.map((a) => ({
      id: a.id,
      learnerName: a.userId,
      learnerEmail: `${a.userId}@x.test`,
      dayTitle: this.o.days.find((d) => d.id === a.moduleId)?.title ?? '',
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      score: a.score,
      maxScore: a.maxScore,
      textAnswers: [],
    }));
  }

  private ctx(tenantId: string, moduleId: string): ModuleQuizContext | null {
    const day = this.o.days.find((d) => d.id === moduleId);
    return tenantId === this.o.tenantA && day ? { courseId: this.o.courseId, moduleTitle: day.title, settings: this.settings } : null;
  }
  async moduleContext(tenantId: string, userId: string, moduleId: string) {
    return this.o.enrolled.includes(userId) ? this.ctx(tenantId, moduleId) : null;
  }
  async staffModuleContext(tenantId: string, moduleId: string) {
    return this.ctx(tenantId, moduleId);
  }
  async poolFor(_t: string, _c: string, moduleId: string) {
    const own = this.questions.filter((q) => q.moduleId === moduleId);
    return own.length > 0 ? own : this.questions.filter((q) => q.moduleId === null);
  }
  async findAttempt(_t: string, userId: string, moduleId: string) {
    return this.attempts.find((a) => a.userId === userId && a.moduleId === moduleId) ?? null;
  }
  async createAttempt(_t: string, input: { courseId: string; moduleId: string; userId: string; expiresAt: Date; questions: AttemptQuestion[] }) {
    const existing = await this.findAttempt('', input.userId, input.moduleId);
    if (existing) return existing;
    const row = { id: randomUUID(), ...input, startedAt: new Date(), submittedAt: null, answers: {}, score: null, maxScore: null };
    this.attempts.push(row);
    return row;
  }
  async submitAttempt(_t: string, attemptId: string, input: { answers: Record<string, string | number>; score: number; maxScore: number; at: Date }) {
    const a = this.attempts.find((x) => x.id === attemptId);
    if (!a || a.submittedAt) return false;
    Object.assign(a, { answers: input.answers, score: input.score, maxScore: input.maxScore, submittedAt: input.at });
    return true;
  }
}

/** A service wired to the fake, with a clock the test controls and a deterministic shuffle. */
export function buildQuizFakes(o: QuizFakeOptions) {
  const repository = new InMemoryQuizRepository(o);
  const clock = { now: new Date('2026-11-01T10:00:00Z') };
  const service = new QuizService({ repository, now: () => clock.now, random: () => 0 });
  return { repository, service, clock };
}
