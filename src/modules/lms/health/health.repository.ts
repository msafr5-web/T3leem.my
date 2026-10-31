import { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import type { Actor } from '../../provider/provider.types';
import type { HealthQuestionInput } from './health.excel';

export interface HealthSettings {
  enabled: boolean;
  trialEndsAt: Date | null;
  /** Fee in SAR that applies after the trial (null = free). */
  price: number | null;
  /** Strict mode: phone-verified sign-up, official exams only, e-mailed code per exam, daily cap. */
  strictMode: boolean;
  dailyLimit: number;
  questionsPerExam: number;
}

/** A question frozen into an exam: options already shuffled for this attempt. */
export interface ExamQuestion {
  id: string;
  body: string;
  options: string[];
  correctOption: string;
  explanation: string;
}

export interface HealthExamRow {
  id: string;
  sectorId: string | null;
  questions: ExamQuestion[];
  answers: Record<string, string>;
  total: number;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
}

export interface HealthSectorRow {
  id: string;
  slug: string;
  name: string;
  title: string;
  sortOrder: number;
  active: boolean;
  /** Active questions in the sector. */
  questionCount: number;
  /** All questions, hidden ones included (admin only). */
  totalCount: number;
}

export interface HealthQuestionRow extends HealthQuestionInput {
  id: string;
  sectorId: string;
  sortOrder: number;
}

export interface HealthUserStateRow {
  questionId: string;
  isFavorite: boolean;
  isRead: boolean;
}

export interface HealthSessionRow {
  clientSessionId: string;
  sectorId: string | null;
  total: number;
  correct: number;
  createdAt: Date;
}

export interface QuestionQuery {
  sectorId?: string;
  search?: string;
  /** Learners only ever see active questions of active sectors. */
  onlyActive: boolean;
  limit: number;
  offset: number;
}

export type WriteResult<T = void> = { kind: 'ok'; value: T } | { kind: 'not_found' } | { kind: 'duplicate' };

export interface HealthRepository {
  getSettings(tenantId: string): Promise<HealthSettings>;
  saveSettings(tenantId: string, actor: Actor, settings: HealthSettings): Promise<void>;
  entitlementExpiry(tenantId: string, userId: string): Promise<Date | null>;
  grantEntitlement(tenantId: string, actor: Actor, email: string, expiresAt: Date): Promise<boolean>;
  activeEntitlements(tenantId: string, now: Date): Promise<number>;

  listSectors(tenantId: string, onlyActive: boolean): Promise<HealthSectorRow[]>;
  createSector(tenantId: string, actor: Actor, input: { slug: string; name: string; title: string; sortOrder: number }): Promise<WriteResult<string>>;
  updateSector(tenantId: string, actor: Actor, id: string, input: { name: string; title: string; sortOrder: number; active: boolean }): Promise<boolean>;
  deleteSector(tenantId: string, actor: Actor, id: string): Promise<'ok' | 'not_found' | 'has_questions'>;

  listQuestions(tenantId: string, query: QuestionQuery): Promise<{ rows: HealthQuestionRow[]; total: number }>;
  /** Every question (for the Excel export), with the sector name. */
  allQuestions(tenantId: string): Promise<(HealthQuestionRow & { sectorName: string })[]>;
  /** Active questions of active sectors, optionally limited to a sector or a set of ids. */
  pool(tenantId: string, filter: { sectorId?: string; ids?: string[] }): Promise<HealthQuestionRow[]>;
  getQuestion(tenantId: string, id: string, onlyActive: boolean): Promise<HealthQuestionRow | null>;
  createQuestion(tenantId: string, actor: Actor, sectorId: string, input: HealthQuestionInput): Promise<WriteResult<string>>;
  updateQuestion(tenantId: string, actor: Actor, id: string, sectorId: string, input: HealthQuestionInput): Promise<WriteResult>;
  deleteQuestion(tenantId: string, actor: Actor, id: string): Promise<boolean>;
  importQuestions(
    tenantId: string,
    actor: Actor,
    rows: (HealthQuestionInput & { sectorId: string })[],
    mode: 'append' | 'replace',
  ): Promise<{ created: number; updated: number; removed: number }>;

  userStates(tenantId: string, userId: string): Promise<HealthUserStateRow[]>;
  setState(tenantId: string, userId: string, questionId: string, patch: { isFavorite?: boolean; isRead?: boolean }): Promise<void>;
  recordSession(tenantId: string, userId: string, input: { clientSessionId: string; sectorId: string | null; total: number; correct: number }): Promise<void>;
  sessions(tenantId: string, userId: string, limit: number): Promise<{ rows: HealthSessionRow[]; answered: number; correct: number; sessions: number }>;

  /** Start times of this user's exams since `since`, newest first (every started exam counts, finished or not). */
  examStarts(tenantId: string, userId: string, since: Date): Promise<Date[]>;
  createExam(tenantId: string, input: { userId: string; sectorId: string; questions: ExamQuestion[] }): Promise<string>;
  getExam(tenantId: string, userId: string, id: string): Promise<HealthExamRow | null>;
  /** True only for the request that really submitted it (an exam is graded once). */
  submitExam(tenantId: string, userId: string, id: string, input: { answers: Record<string, string>; score: number; at: Date }): Promise<boolean>;
  listExams(tenantId: string, userId: string, limit: number): Promise<HealthExamRow[]>;
}

const toQuestion = (q: { id: string; sectorId: string; code: string; body: string; options: Prisma.JsonValue; correctIndex: number; explanation: string; active: boolean; sortOrder: number }): HealthQuestionRow => ({
  id: q.id,
  sectorId: q.sectorId,
  code: q.code,
  body: q.body,
  options: (q.options as string[]) ?? [],
  correctIndex: q.correctIndex,
  explanation: q.explanation,
  active: q.active,
  sortOrder: q.sortOrder,
});

const toExam = (e: { id: string; sectorId: string | null; questions: Prisma.JsonValue; answers: Prisma.JsonValue; total: number; score: number | null; startedAt: Date; submittedAt: Date | null }): HealthExamRow => ({
  id: e.id,
  sectorId: e.sectorId,
  questions: (e.questions as unknown as ExamQuestion[]) ?? [],
  answers: (e.answers as unknown as Record<string, string>) ?? {},
  total: e.total,
  score: e.score,
  startedAt: e.startedAt,
  submittedAt: e.submittedAt,
});

const audit = (tx: Prisma.TransactionClient, tenantId: string, actor: Actor, action: string, entityId: string, metadata: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType: 'health', entityId, metadata, ipAddress: actor.ip } });

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export class PrismaHealthRepository implements HealthRepository {
  async getSettings(tenantId: string): Promise<HealthSettings> {
    const row = await forTenant(tenantId).healthSetting.findUnique({ where: { tenantId } });
    return row
      ? { enabled: row.enabled, trialEndsAt: row.trialEndsAt, price: row.price === null ? null : Number(row.price), strictMode: row.strictMode, dailyLimit: row.dailyLimit, questionsPerExam: row.questionsPerExam }
      : { enabled: true, trialEndsAt: null, price: null, strictMode: false, dailyLimit: 5, questionsPerExam: 10 };
  }

  saveSettings(tenantId: string, actor: Actor, s: HealthSettings): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      const data = { enabled: s.enabled, trialEndsAt: s.trialEndsAt, price: s.price, strictMode: s.strictMode, dailyLimit: s.dailyLimit, questionsPerExam: s.questionsPerExam };
      await tx.healthSetting.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
      await audit(tx, tenantId, actor, 'health.settings_changed', tenantId, { enabled: s.enabled, trialEndsAt: s.trialEndsAt?.toISOString() ?? null, price: s.price, strictMode: s.strictMode, dailyLimit: s.dailyLimit, questionsPerExam: s.questionsPerExam });
    });
  }

  async entitlementExpiry(tenantId: string, userId: string): Promise<Date | null> {
    const row = await forTenant(tenantId).healthEntitlement.findFirst({ where: { tenantId, userId }, select: { expiresAt: true } });
    return row?.expiresAt ?? null;
  }

  grantEntitlement(tenantId: string, actor: Actor, email: string, expiresAt: Date): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, email: email.toLowerCase() }, select: { id: true } });
      if (!user) return false;
      await tx.healthEntitlement.upsert({ where: { userId: user.id }, create: { tenantId, userId: user.id, expiresAt }, update: { expiresAt } });
      await audit(tx, tenantId, actor, 'health.access_granted', user.id, { expiresAt: expiresAt.toISOString() });
      return true;
    });
  }

  activeEntitlements(tenantId: string, now: Date): Promise<number> {
    return forTenant(tenantId).healthEntitlement.count({ where: { tenantId, expiresAt: { gt: now } } });
  }

  async listSectors(tenantId: string, onlyActive: boolean): Promise<HealthSectorRow[]> {
    const db = forTenant(tenantId);
    const [sectors, active, total] = await Promise.all([
      db.healthSector.findMany({ where: { tenantId, ...(onlyActive ? { active: true } : {}) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      db.healthQuestion.groupBy({ by: ['sectorId'], where: { tenantId, active: true }, _count: { _all: true } }),
      db.healthQuestion.groupBy({ by: ['sectorId'], where: { tenantId }, _count: { _all: true } }),
    ]);
    const activeBy = new Map(active.map((g) => [g.sectorId, g._count._all]));
    const totalBy = new Map(total.map((g) => [g.sectorId, g._count._all]));
    return sectors.map((s) => ({ id: s.id, slug: s.slug, name: s.name, title: s.title, sortOrder: s.sortOrder, active: s.active, questionCount: activeBy.get(s.id) ?? 0, totalCount: totalBy.get(s.id) ?? 0 }));
  }

  createSector(tenantId: string, actor: Actor, input: { slug: string; name: string; title: string; sortOrder: number }): Promise<WriteResult<string>> {
    return withTenantTransaction(tenantId, async (tx) => {
      // Checked up front: a unique violation would abort the whole transaction.
      if ((await tx.healthSector.count({ where: { tenantId, slug: input.slug } })) > 0) return { kind: 'duplicate' } as const;
      const row = await tx.healthSector.create({ data: { tenantId, ...input }, select: { id: true } });
      await audit(tx, tenantId, actor, 'health.sector_created', row.id, { name: input.name });
      return { kind: 'ok', value: row.id } as const;
    });
  }

  async updateSector(tenantId: string, actor: Actor, id: string, input: { name: string; title: string; sortOrder: number; active: boolean }): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.healthSector.updateMany({ where: { tenantId, id }, data: input });
      if (count === 0) return false;
      await audit(tx, tenantId, actor, 'health.sector_updated', id, { name: input.name, active: input.active });
      return true;
    });
  }

  deleteSector(tenantId: string, actor: Actor, id: string): Promise<'ok' | 'not_found' | 'has_questions'> {
    return withTenantTransaction(tenantId, async (tx) => {
      if ((await tx.healthSector.count({ where: { tenantId, id } })) === 0) return 'not_found' as const;
      if ((await tx.healthQuestion.count({ where: { tenantId, sectorId: id } })) > 0) return 'has_questions' as const;
      await tx.healthSector.deleteMany({ where: { tenantId, id } });
      await audit(tx, tenantId, actor, 'health.sector_deleted', id, {});
      return 'ok' as const;
    });
  }

  async listQuestions(tenantId: string, q: QuestionQuery): Promise<{ rows: HealthQuestionRow[]; total: number }> {
    const where: Prisma.HealthQuestionWhereInput = {
      tenantId,
      ...(q.sectorId ? { sectorId: q.sectorId } : {}),
      ...(q.onlyActive ? { active: true, sector: { active: true } } : {}),
      ...(q.search ? { OR: [{ body: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const db = forTenant(tenantId);
    const [rows, total] = await Promise.all([
      db.healthQuestion.findMany({ where, orderBy: [{ sector: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }], skip: q.offset, take: q.limit }),
      db.healthQuestion.count({ where }),
    ]);
    return { rows: rows.map(toQuestion), total };
  }

  async allQuestions(tenantId: string): Promise<(HealthQuestionRow & { sectorName: string })[]> {
    const rows = await forTenant(tenantId).healthQuestion.findMany({
      where: { tenantId },
      orderBy: [{ sector: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }],
      include: { sector: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...toQuestion(r), sectorName: r.sector.name }));
  }

  async pool(tenantId: string, filter: { sectorId?: string; ids?: string[] }): Promise<HealthQuestionRow[]> {
    const rows = await forTenant(tenantId).healthQuestion.findMany({
      where: { tenantId, active: true, sector: { active: true }, ...(filter.sectorId ? { sectorId: filter.sectorId } : {}), ...(filter.ids ? { id: { in: filter.ids } } : {}) },
    });
    return rows.map(toQuestion);
  }

  async getQuestion(tenantId: string, id: string, onlyActive: boolean): Promise<HealthQuestionRow | null> {
    const row = await forTenant(tenantId).healthQuestion.findFirst({ where: { tenantId, id, ...(onlyActive ? { active: true, sector: { active: true } } : {}) } });
    return row ? toQuestion(row) : null;
  }

  createQuestion(tenantId: string, actor: Actor, sectorId: string, input: HealthQuestionInput): Promise<WriteResult<string>> {
    return withTenantTransaction(tenantId, async (tx) => {
      // The FK check bypasses RLS, so confirm the sector belongs to this tenant first.
      if ((await tx.healthSector.count({ where: { tenantId, id: sectorId } })) === 0) return { kind: 'not_found' } as const;
      if ((await tx.healthQuestion.count({ where: { tenantId, code: input.code } })) > 0) return { kind: 'duplicate' } as const;
      const sortOrder = await tx.healthQuestion.count({ where: { tenantId, sectorId } });
      const row = await tx.healthQuestion.create({ data: { tenantId, sectorId, ...input, options: input.options as Prisma.InputJsonValue, sortOrder }, select: { id: true } });
      await audit(tx, tenantId, actor, 'health.question_created', row.id, { code: input.code });
      return { kind: 'ok', value: row.id } as const;
    });
  }

  updateQuestion(tenantId: string, actor: Actor, id: string, sectorId: string, input: HealthQuestionInput): Promise<WriteResult> {
    return withTenantTransaction(tenantId, async (tx) => {
      if ((await tx.healthSector.count({ where: { tenantId, id: sectorId } })) === 0) return { kind: 'not_found' } as const;
      if ((await tx.healthQuestion.count({ where: { tenantId, code: input.code, NOT: { id } } })) > 0) return { kind: 'duplicate' } as const;
      const { count } = await tx.healthQuestion.updateMany({ where: { tenantId, id }, data: { sectorId, ...input, options: input.options as Prisma.InputJsonValue } });
      if (count === 0) return { kind: 'not_found' } as const;
      await audit(tx, tenantId, actor, 'health.question_updated', id, { code: input.code });
      return { kind: 'ok', value: undefined } as const;
    });
  }

  deleteQuestion(tenantId: string, actor: Actor, id: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.healthQuestion.deleteMany({ where: { tenantId, id } });
      if (count === 0) return false;
      await audit(tx, tenantId, actor, 'health.question_deleted', id, {});
      return true;
    });
  }

  importQuestions(
    tenantId: string,
    actor: Actor,
    rows: (HealthQuestionInput & { sectorId: string })[],
    mode: 'append' | 'replace',
  ): Promise<{ created: number; updated: number; removed: number }> {
    return withTenantTransaction(tenantId, async (tx) => {
      let removed = 0;
      if (mode === 'replace') {
        removed = (await tx.healthQuestion.deleteMany({ where: { tenantId } })).count;
      }
      // One statement for the whole sheet: a loop of 660 inserts overruns the 5 s interactive-transaction limit.
      // New rows get the next sort slot of their sector; existing rows keep theirs.
      const next = new Map<string, number>();
      for (const g of await tx.healthQuestion.groupBy({ by: ['sectorId'], where: { tenantId }, _count: { _all: true } })) next.set(g.sectorId, g._count._all);
      const sortOrders = rows.map((r) => {
        const n = next.get(r.sectorId) ?? 0;
        next.set(r.sectorId, n + 1);
        return n;
      });
      const result = await tx.$queryRaw<{ inserted: boolean }[]>`
        INSERT INTO health_questions (id, tenant_id, sector_id, code, body, options, correct_index, explanation, active, sort_order)
        SELECT gen_random_uuid(), ${tenantId}::uuid, t.sector_id, t.code, t.body, t.options::jsonb, t.correct_index, t.explanation, t.active, t.sort_order
        FROM unnest(
          ${rows.map((r) => r.sectorId)}::uuid[], ${rows.map((r) => r.code)}::text[], ${rows.map((r) => r.body)}::text[],
          ${rows.map((r) => JSON.stringify(r.options))}::text[], ${rows.map((r) => r.correctIndex)}::int[],
          ${rows.map((r) => r.explanation)}::text[], ${rows.map((r) => r.active)}::boolean[], ${sortOrders}::int[]
        ) AS t(sector_id, code, body, options, correct_index, explanation, active, sort_order)
        ON CONFLICT (tenant_id, code) DO UPDATE SET
          sector_id = EXCLUDED.sector_id, body = EXCLUDED.body, options = EXCLUDED.options, correct_index = EXCLUDED.correct_index,
          explanation = EXCLUDED.explanation, active = EXCLUDED.active, updated_at = now()
        RETURNING (xmax = 0) AS inserted`;
      const created = result.filter((r) => r.inserted).length;
      const updated = result.length - created;
      await audit(tx, tenantId, actor, 'health.questions_imported', tenantId, { mode, created, updated, removed });
      return { created, updated, removed };
    });
  }

  async userStates(tenantId: string, userId: string): Promise<HealthUserStateRow[]> {
    return forTenant(tenantId).healthUserState.findMany({ where: { tenantId, userId }, select: { questionId: true, isFavorite: true, isRead: true } });
  }

  async setState(tenantId: string, userId: string, questionId: string, patch: { isFavorite?: boolean; isRead?: boolean }): Promise<void> {
    await forTenant(tenantId).healthUserState.upsert({
      where: { userId_questionId: { userId, questionId } },
      create: { tenantId, userId, questionId, isFavorite: patch.isFavorite ?? false, isRead: patch.isRead ?? false },
      update: { ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}), ...(patch.isRead !== undefined ? { isRead: patch.isRead } : {}) },
    });
  }

  async recordSession(tenantId: string, userId: string, input: { clientSessionId: string; sectorId: string | null; total: number; correct: number }): Promise<void> {
    const db = forTenant(tenantId);
    // FK checks bypass RLS: only keep a sector id that belongs to this tenant.
    const sectorId = input.sectorId && (await db.healthSector.count({ where: { tenantId, id: input.sectorId } })) > 0 ? input.sectorId : null;
    try {
      await db.healthSession.create({ data: { tenantId, userId, ...input, sectorId } });
    } catch (err) {
      // The same session sent twice (retry / second tab) counts once.
      if (!isUnique(err)) throw err;
    }
  }

  async sessions(tenantId: string, userId: string, limit: number): Promise<{ rows: HealthSessionRow[]; answered: number; correct: number; sessions: number }> {
    const db = forTenant(tenantId);
    const [rows, sum] = await Promise.all([
      db.healthSession.findMany({ where: { tenantId, userId }, orderBy: { createdAt: 'desc' }, take: limit }),
      db.healthSession.aggregate({ where: { tenantId, userId }, _sum: { total: true, correct: true }, _count: { _all: true } }),
    ]);
    return {
      rows: rows.map((r) => ({ clientSessionId: r.clientSessionId, sectorId: r.sectorId, total: r.total, correct: r.correct, createdAt: r.createdAt })),
      answered: sum._sum.total ?? 0,
      correct: sum._sum.correct ?? 0,
      sessions: sum._count._all,
    };
  }

  async examStarts(tenantId: string, userId: string, since: Date): Promise<Date[]> {
    const rows = await forTenant(tenantId).healthExam.findMany({ where: { tenantId, userId, startedAt: { gte: since } }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
    return rows.map((r) => r.startedAt);
  }

  async createExam(tenantId: string, input: { userId: string; sectorId: string; questions: ExamQuestion[] }): Promise<string> {
    const db = forTenant(tenantId);
    // FK checks bypass RLS: only keep a sector that belongs to this tenant.
    const sectorId = (await db.healthSector.count({ where: { tenantId, id: input.sectorId } })) > 0 ? input.sectorId : null;
    const row = await db.healthExam.create({
      data: { tenantId, userId: input.userId, sectorId, questions: input.questions as unknown as Prisma.InputJsonValue, total: input.questions.length },
      select: { id: true },
    });
    return row.id;
  }

  async getExam(tenantId: string, userId: string, id: string): Promise<HealthExamRow | null> {
    const row = await forTenant(tenantId).healthExam.findFirst({ where: { tenantId, userId, id } });
    return row ? toExam(row) : null;
  }

  async submitExam(tenantId: string, userId: string, id: string, input: { answers: Record<string, string>; score: number; at: Date }): Promise<boolean> {
    // The `submittedAt: null` guard makes the first submission win under concurrent requests.
    const { count } = await forTenant(tenantId).healthExam.updateMany({
      where: { tenantId, userId, id, submittedAt: null },
      data: { answers: input.answers as unknown as Prisma.InputJsonValue, score: input.score, submittedAt: input.at },
    });
    return count === 1;
  }

  async listExams(tenantId: string, userId: string, limit: number): Promise<HealthExamRow[]> {
    const rows = await forTenant(tenantId).healthExam.findMany({ where: { tenantId, userId }, orderBy: { startedAt: 'desc' }, take: limit });
    return rows.map(toExam);
  }
}
