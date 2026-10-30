import { randomBytes, randomInt } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import {
  HEALTH_LIMITS,
  buildHealthWorkbook,
  parseHealthSheet,
  type HealthQuestionInput,
  type RowError,
} from './health.excel';
import starter from './health.starter.json';
import type { HealthQuestionRow, HealthRepository, HealthSectorRow, HealthSessionRow, HealthSettings, HealthUserStateRow } from './health.repository';

export const HEALTH_PRACTICE = { minCount: 1, maxCount: 50, defaultCount: 10, pageSize: 20, maxPageSize: 50 } as const;

export type HealthAccess = 'disabled' | 'open' | 'trial' | 'paid' | 'locked';

export interface HealthStatus {
  access: HealthAccess;
  trialEndsAt: Date | null;
  price: number | null;
  sectors: HealthSectorRow[];
  serverNow: Date;
}

export interface QuestionDraft {
  sectorId: string;
  body: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  active: boolean;
}

export interface PracticeQuestion {
  id: string;
  sectorId: string;
  body: string;
  /** Already shuffled for this request. */
  options: string[];
}

export interface AnswerOutcome {
  correct: boolean;
  correctOption: string;
  explanation: string;
}

export interface ImportOutcome {
  created: number;
  updated: number;
  removed: number;
}

interface Deps {
  repository: HealthRepository;
  now?: () => Date;
}

const STAFF = new Set<UserRole>([UserRole.TENANT_ADMIN, UserRole.INSTRUCTOR, UserRole.SUPER_ADMIN]);

/** Unbiased Fisher-Yates with a CSPRNG, so the answer position can't be predicted. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const normalizeRef = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

export class HealthService {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ---------- access ----------

  private accessOf(settings: HealthSettings, entitlementExpiry: Date | null): HealthAccess {
    if (!settings.enabled) return 'disabled';
    if (!settings.price || settings.price <= 0) return 'open';
    const now = this.now();
    if (!settings.trialEndsAt || now < settings.trialEndsAt) return 'trial';
    return entitlementExpiry && entitlementExpiry > now ? 'paid' : 'locked';
  }

  /** What this user may do: staff always may preview, learners follow the trial / fee rules. */
  async status(tenantId: string, user: { id: string; role: UserRole }): Promise<HealthStatus> {
    const [settings, expiry, sectors] = await Promise.all([
      this.deps.repository.getSettings(tenantId),
      this.deps.repository.entitlementExpiry(tenantId, user.id),
      this.deps.repository.listSectors(tenantId, true),
    ]);
    let access = this.accessOf(settings, expiry);
    if (STAFF.has(user.role) && access === 'locked') access = 'paid';
    return { access, trialEndsAt: settings.trialEndsAt, price: settings.price, sectors, serverNow: this.now() };
  }

  private async assertAccess(tenantId: string, user: { id: string; role: UserRole }): Promise<void> {
    const { access } = await this.status(tenantId, user);
    if (access === 'disabled') throw new HttpError(403, 'HEALTH_DISABLED', 'The health certificates section is not available');
    if (access === 'locked') throw HttpError.paymentRequired('HEALTH_TRIAL_ENDED', 'The free trial has ended; subscribe to continue');
  }

  // ---------- learner ----------

  async browse(tenantId: string, user: { id: string; role: UserRole }, q: { sectorId?: string; search?: string; limit?: number; offset?: number }) {
    await this.assertAccess(tenantId, user);
    const limit = Math.min(Math.max(q.limit ?? HEALTH_PRACTICE.pageSize, 1), HEALTH_PRACTICE.maxPageSize);
    return this.deps.repository.listQuestions(tenantId, { sectorId: q.sectorId, search: q.search?.trim() || undefined, onlyActive: true, limit, offset: Math.max(q.offset ?? 0, 0) });
  }

  /** Random questions for a practice run: options shuffled, the right one not revealed. */
  async practice(tenantId: string, user: { id: string; role: UserRole }, input: { sectorId?: string; count: number; favoritesOnly: boolean }): Promise<PracticeQuestion[]> {
    await this.assertAccess(tenantId, user);
    const count = Math.min(Math.max(Math.trunc(input.count) || HEALTH_PRACTICE.defaultCount, HEALTH_PRACTICE.minCount), HEALTH_PRACTICE.maxCount);
    let ids: string[] | undefined;
    if (input.favoritesOnly) {
      ids = (await this.deps.repository.userStates(tenantId, user.id)).filter((s) => s.isFavorite).map((s) => s.questionId);
      if (ids.length === 0) throw HttpError.unprocessable('NO_FAVORITES', 'You have no favourite questions yet');
    }
    const pool = await this.deps.repository.pool(tenantId, { sectorId: input.sectorId, ids });
    if (pool.length === 0) throw HttpError.unprocessable('NO_QUESTIONS', 'There are no questions for this selection');
    return shuffled(pool)
      .slice(0, count)
      .map((q) => ({ id: q.id, sectorId: q.sectorId, body: q.body, options: shuffled(q.options) }));
  }

  /** Grades one answer on the server. Options are compared by text, so the shuffle doesn't matter. */
  async answer(tenantId: string, user: { id: string; role: UserRole }, questionId: string, option: string): Promise<AnswerOutcome> {
    await this.assertAccess(tenantId, user);
    const q = await this.deps.repository.getQuestion(tenantId, questionId, true);
    if (!q) throw HttpError.notFound('QUESTION_NOT_FOUND', 'Question not found');
    const correctOption = q.options[q.correctIndex] ?? '';
    // Answering marks the question as read.
    await this.deps.repository.setState(tenantId, user.id, questionId, { isRead: true });
    return { correct: option === correctOption, correctOption, explanation: q.explanation };
  }

  async setState(tenantId: string, user: { id: string; role: UserRole }, questionId: string, patch: { favorite?: boolean; read?: boolean }): Promise<void> {
    await this.assertAccess(tenantId, user);
    if (!(await this.deps.repository.getQuestion(tenantId, questionId, true))) throw HttpError.notFound('QUESTION_NOT_FOUND', 'Question not found');
    await this.deps.repository.setState(tenantId, user.id, questionId, { isFavorite: patch.favorite, isRead: patch.read });
  }

  async recordSession(tenantId: string, user: { id: string; role: UserRole }, input: { clientSessionId: string; sectorId: string | null; total: number; correct: number }): Promise<void> {
    await this.assertAccess(tenantId, user);
    if (input.correct > input.total) throw HttpError.unprocessable('INVALID_SESSION', 'Correct answers exceed the total');
    await this.deps.repository.recordSession(tenantId, user.id, input);
  }

  async progress(
    tenantId: string,
    user: { id: string; role: UserRole },
  ): Promise<{ states: HealthUserStateRow[]; sessions: HealthSessionRow[]; answered: number; correct: number; sessionCount: number }> {
    await this.assertAccess(tenantId, user);
    const [states, history] = await Promise.all([this.deps.repository.userStates(tenantId, user.id), this.deps.repository.sessions(tenantId, user.id, 30)]);
    return { states, sessions: history.rows, answered: history.answered, correct: history.correct, sessionCount: history.sessions };
  }

  // ---------- admin ----------

  async overview(tenantId: string) {
    const [settings, sectors, entitled] = await Promise.all([
      this.deps.repository.getSettings(tenantId),
      this.deps.repository.listSectors(tenantId, false),
      this.deps.repository.activeEntitlements(tenantId, this.now()),
    ]);
    return { settings, sectors, entitled, serverNow: this.now() };
  }

  async updateSettings(tenantId: string, actor: Actor, settings: HealthSettings): Promise<void> {
    await this.deps.repository.saveSettings(tenantId, actor, settings);
  }

  async grantAccess(tenantId: string, actor: Actor, email: string, days: number): Promise<Date> {
    const expiresAt = new Date(this.now().getTime() + days * 86_400_000);
    if (!(await this.deps.repository.grantEntitlement(tenantId, actor, email, expiresAt))) throw HttpError.notFound('USER_NOT_FOUND', 'No user with this email');
    return expiresAt;
  }

  async createSector(tenantId: string, actor: Actor, input: { name: string; title: string; slug?: string }): Promise<string> {
    const slug = input.slug?.trim() || `s-${randomBytes(4).toString('hex')}`;
    const sortOrder = (await this.deps.repository.listSectors(tenantId, false)).length;
    const r = await this.deps.repository.createSector(tenantId, actor, { slug, name: input.name.trim(), title: input.title.trim(), sortOrder });
    if (r.kind === 'duplicate') throw HttpError.conflict('SECTOR_EXISTS', 'A sector with this code already exists');
    if (r.kind !== 'ok') throw HttpError.notFound('SECTOR_NOT_FOUND', 'Sector not found');
    return r.value;
  }

  async updateSector(tenantId: string, actor: Actor, id: string, input: { name: string; title: string; sortOrder: number; active: boolean }): Promise<void> {
    if (!(await this.deps.repository.updateSector(tenantId, actor, id, { ...input, name: input.name.trim(), title: input.title.trim() }))) throw HttpError.notFound('SECTOR_NOT_FOUND', 'Sector not found');
  }

  async deleteSector(tenantId: string, actor: Actor, id: string): Promise<void> {
    const r = await this.deps.repository.deleteSector(tenantId, actor, id);
    if (r === 'not_found') throw HttpError.notFound('SECTOR_NOT_FOUND', 'Sector not found');
    if (r === 'has_questions') throw HttpError.conflict('SECTOR_NOT_EMPTY', 'Move or delete the sector questions first (or hide the sector)');
  }

  adminQuestions(tenantId: string, q: { sectorId?: string; search?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    return this.deps.repository.listQuestions(tenantId, { sectorId: q.sectorId, search: q.search?.trim() || undefined, onlyActive: false, limit, offset: Math.max(q.offset ?? 0, 0) });
  }

  /** The same rules as the Excel import, applied to one question typed in the form. */
  private validated(draft: QuestionDraft): HealthQuestionInput {
    const body = draft.body.trim();
    const options = draft.options.map((o) => o.trim());
    const fail = (message: string) => HttpError.unprocessable('INVALID_QUESTION', message);
    if (!body) throw fail('Question text is required');
    if (body.length > HEALTH_LIMITS.maxBodyLength) throw fail('Question text is too long');
    if (options.length < HEALTH_LIMITS.options.min || options.length > HEALTH_LIMITS.options.max) throw fail('A question needs 2 to 6 options');
    if (options.some((o) => !o || o.length > HEALTH_LIMITS.maxOptionLength)) throw fail('Options cannot be empty or longer than 300 characters');
    if (new Set(options).size !== options.length) throw fail('Options must be different from each other');
    if (!Number.isInteger(draft.correctIndex) || draft.correctIndex < 0 || draft.correctIndex >= options.length) throw fail('Choose the correct option');
    const explanation = draft.explanation.trim();
    if (explanation.length > HEALTH_LIMITS.maxExplanationLength) throw fail('Explanation is too long');
    return { code: '', body, options, correctIndex: draft.correctIndex, explanation, active: draft.active };
  }

  async createQuestion(tenantId: string, actor: Actor, draft: QuestionDraft): Promise<string> {
    const input = { ...this.validated(draft), code: `HQ-${Date.now().toString(36).toUpperCase()}${randomBytes(1).toString('hex').toUpperCase()}` };
    const r = await this.deps.repository.createQuestion(tenantId, actor, draft.sectorId, input);
    if (r.kind === 'not_found') throw HttpError.notFound('SECTOR_NOT_FOUND', 'Sector not found');
    if (r.kind === 'duplicate') throw HttpError.conflict('QUESTION_EXISTS', 'Try again');
    return r.value;
  }

  async updateQuestion(tenantId: string, actor: Actor, id: string, draft: QuestionDraft & { code?: string }): Promise<void> {
    const current = await this.deps.repository.getQuestion(tenantId, id, false);
    if (!current) throw HttpError.notFound('QUESTION_NOT_FOUND', 'Question not found');
    const input = { ...this.validated(draft), code: draft.code?.trim() || current.code };
    if (input.code.length > HEALTH_LIMITS.maxCodeLength) throw HttpError.unprocessable('INVALID_QUESTION', 'Question code is too long');
    const r = await this.deps.repository.updateQuestion(tenantId, actor, id, draft.sectorId, input);
    if (r.kind === 'not_found') throw HttpError.notFound('QUESTION_NOT_FOUND', 'Question or sector not found');
    if (r.kind === 'duplicate') throw HttpError.conflict('QUESTION_EXISTS', 'Another question already uses this code');
  }

  async deleteQuestion(tenantId: string, actor: Actor, id: string): Promise<void> {
    if (!(await this.deps.repository.deleteQuestion(tenantId, actor, id))) throw HttpError.notFound('QUESTION_NOT_FOUND', 'Question not found');
  }

  async importSheet(tenantId: string, actor: Actor, file: Buffer, mode: 'append' | 'replace'): Promise<ImportOutcome> {
    if (file.length > HEALTH_LIMITS.maxFileBytes) throw HttpError.unprocessable('FILE_TOO_LARGE', 'The file is larger than 3 MB');
    const { questions, errors } = await parseHealthSheet(file);
    const sectors = await this.deps.repository.listSectors(tenantId, false);
    const byRef = new Map<string, string>();
    for (const s of sectors) {
      byRef.set(normalizeRef(s.slug), s.id);
      byRef.set(normalizeRef(s.name), s.id);
    }
    const all: RowError[] = [...errors];
    const rows: (HealthQuestionInput & { sectorId: string })[] = [];
    for (const q of questions) {
      const sectorId = byRef.get(normalizeRef(q.sectorRef));
      if (!sectorId) {
        all.push({ row: q.row, message: `القطاع «${q.sectorRef}» غير موجود. أنشئه من الموقع أولاً أو صحّح الاسم.` });
        continue;
      }
      const { sectorRef: _s, row: _r, ...input } = q;
      rows.push({ ...input, sectorId });
    }
    // All or nothing: one bad row imports nothing, so the bank never half-updates.
    if (all.length > 0) {
      all.sort((a, b) => a.row - b.row);
      throw HttpError.unprocessable('INVALID_QUESTION_SHEET', 'The question sheet has errors', { errors: all.slice(0, 50), total_errors: all.length });
    }
    if (rows.length === 0) throw HttpError.unprocessable('EMPTY_SHEET', 'The sheet has no questions');
    return this.deps.repository.importQuestions(tenantId, actor, rows, mode);
  }

  /**
   * Installs the bundled starter bank (6 sectors, 660 questions). Safe to run again: sectors are
   * matched by code and questions are updated by Question_ID, so edits to other questions survive.
   */
  async installStarter(tenantId: string, actor: Actor): Promise<ImportOutcome & { sectorsCreated: number }> {
    const existing = new Map((await this.deps.repository.listSectors(tenantId, false)).map((s) => [s.slug, s.id]));
    let sectorsCreated = 0;
    for (const [i, s] of starter.sectors.entries()) {
      if (existing.has(s.slug)) continue;
      const r = await this.deps.repository.createSector(tenantId, actor, { slug: s.slug, name: s.name, title: s.title, sortOrder: existing.size + i });
      if (r.kind === 'ok') {
        existing.set(s.slug, r.value);
        sectorsCreated++;
      }
    }
    const rows = starter.questions.map((q) => ({
      sectorId: existing.get(q.sector)!,
      code: q.code,
      body: q.body,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      active: true,
    }));
    return { ...(await this.deps.repository.importQuestions(tenantId, actor, rows, 'append')), sectorsCreated };
  }

  async exportSheet(tenantId: string, template: boolean): Promise<Buffer> {
    const rows = await this.deps.repository.allQuestions(tenantId);
    return buildHealthWorkbook(rows, template || rows.length === 0);
  }
}

export type { HealthQuestionRow };
