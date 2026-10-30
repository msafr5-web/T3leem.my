import { randomUUID } from 'node:crypto';
import type { HealthQuestionInput } from '../../../src/modules/lms/health/health.excel';
import type {
  HealthQuestionRow,
  HealthRepository,
  HealthSectorRow,
  HealthSessionRow,
  HealthSettings,
  HealthUserStateRow,
  QuestionQuery,
  WriteResult,
} from '../../../src/modules/lms/health/health.repository';
import { HealthService } from '../../../src/modules/lms/health/health.service';

interface Sector {
  id: string;
  slug: string;
  name: string;
  title: string;
  sortOrder: number;
  active: boolean;
}

/** In-memory HealthRepository for ONE tenant, mirroring the SQL rules that matter (unique code, sector delete restricted). */
export class InMemoryHealthRepository implements HealthRepository {
  settings: HealthSettings = { enabled: true, trialEndsAt: null, price: null };
  sectors: Sector[] = [];
  questions: HealthQuestionRow[] = [];
  entitlements = new Map<string, Date>();
  states = new Map<string, HealthUserStateRow>();
  sessionRows: (HealthSessionRow & { userId: string })[] = [];
  /** Emails the grant endpoint knows. */
  knownEmails = new Map<string, string>();

  constructor(private readonly tenantA: string) {}

  private mine(t: string) {
    return t === this.tenantA;
  }

  async getSettings(t: string) {
    return this.mine(t) ? this.settings : { enabled: true, trialEndsAt: null, price: null };
  }
  async saveSettings(_t: string, _a: unknown, s: HealthSettings) {
    this.settings = s;
  }
  async entitlementExpiry(_t: string, userId: string) {
    return this.entitlements.get(userId) ?? null;
  }
  async grantEntitlement(_t: string, _a: unknown, email: string, expiresAt: Date) {
    const id = this.knownEmails.get(email.toLowerCase());
    if (!id) return false;
    this.entitlements.set(id, expiresAt);
    return true;
  }
  async activeEntitlements(_t: string, now: Date) {
    return [...this.entitlements.values()].filter((d) => d > now).length;
  }

  private sectorRow(s: Sector): HealthSectorRow {
    const own = this.questions.filter((q) => q.sectorId === s.id);
    return { ...s, questionCount: own.filter((q) => q.active).length, totalCount: own.length };
  }
  async listSectors(t: string, onlyActive: boolean) {
    if (!this.mine(t)) return [];
    return this.sectors.filter((s) => !onlyActive || s.active).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => this.sectorRow(s));
  }
  async createSector(_t: string, _a: unknown, input: { slug: string; name: string; title: string; sortOrder: number }): Promise<WriteResult<string>> {
    if (this.sectors.some((s) => s.slug === input.slug)) return { kind: 'duplicate' };
    const s = { id: randomUUID(), active: true, ...input };
    this.sectors.push(s);
    return { kind: 'ok', value: s.id };
  }
  async updateSector(_t: string, _a: unknown, id: string, input: { name: string; title: string; sortOrder: number; active: boolean }) {
    const s = this.sectors.find((x) => x.id === id);
    if (!s) return false;
    Object.assign(s, input);
    return true;
  }
  async deleteSector(_t: string, _a: unknown, id: string) {
    if (!this.sectors.some((s) => s.id === id)) return 'not_found' as const;
    if (this.questions.some((q) => q.sectorId === id)) return 'has_questions' as const;
    this.sectors = this.sectors.filter((s) => s.id !== id);
    return 'ok' as const;
  }

  private visible(q: HealthQuestionRow, onlyActive: boolean) {
    return !onlyActive || (q.active && this.sectors.find((s) => s.id === q.sectorId)?.active === true);
  }
  async listQuestions(_t: string, query: QuestionQuery) {
    const all = this.questions.filter(
      (q) => this.visible(q, query.onlyActive) && (!query.sectorId || q.sectorId === query.sectorId) && (!query.search || q.body.includes(query.search) || q.code.includes(query.search)),
    );
    return { rows: all.slice(query.offset, query.offset + query.limit), total: all.length };
  }
  async allQuestions() {
    return this.questions.map((q) => ({ ...q, sectorName: this.sectors.find((s) => s.id === q.sectorId)!.name }));
  }
  async pool(_t: string, f: { sectorId?: string; ids?: string[] }) {
    return this.questions.filter((q) => this.visible(q, true) && (!f.sectorId || q.sectorId === f.sectorId) && (!f.ids || f.ids.includes(q.id)));
  }
  async getQuestion(_t: string, id: string, onlyActive: boolean) {
    const q = this.questions.find((x) => x.id === id);
    return q && this.visible(q, onlyActive) ? q : null;
  }
  async createQuestion(_t: string, _a: unknown, sectorId: string, input: HealthQuestionInput): Promise<WriteResult<string>> {
    if (!this.sectors.some((s) => s.id === sectorId)) return { kind: 'not_found' };
    if (this.questions.some((q) => q.code === input.code)) return { kind: 'duplicate' };
    const q = { id: randomUUID(), sectorId, sortOrder: this.questions.length, ...input };
    this.questions.push(q);
    return { kind: 'ok', value: q.id };
  }
  async updateQuestion(_t: string, _a: unknown, id: string, sectorId: string, input: HealthQuestionInput): Promise<WriteResult> {
    const q = this.questions.find((x) => x.id === id);
    if (!q || !this.sectors.some((s) => s.id === sectorId)) return { kind: 'not_found' };
    if (this.questions.some((x) => x.code === input.code && x.id !== id)) return { kind: 'duplicate' };
    Object.assign(q, { sectorId, ...input });
    return { kind: 'ok', value: undefined };
  }
  async deleteQuestion(_t: string, _a: unknown, id: string) {
    const before = this.questions.length;
    this.questions = this.questions.filter((q) => q.id !== id);
    return this.questions.length < before;
  }
  async importQuestions(_t: string, _a: unknown, rows: (HealthQuestionInput & { sectorId: string })[], mode: 'append' | 'replace') {
    let removed = 0;
    if (mode === 'replace') {
      removed = this.questions.length;
      this.questions = [];
    }
    let created = 0;
    let updated = 0;
    for (const r of rows) {
      const existing = this.questions.find((q) => q.code === r.code);
      if (existing) {
        Object.assign(existing, r);
        updated++;
      } else {
        this.questions.push({ id: randomUUID(), sortOrder: this.questions.length, ...r });
        created++;
      }
    }
    return { created, updated, removed };
  }

  async userStates(_t: string, userId: string) {
    return [...this.states.entries()].filter(([k]) => k.startsWith(`${userId}:`)).map(([, v]) => v);
  }
  async setState(_t: string, userId: string, questionId: string, patch: { isFavorite?: boolean; isRead?: boolean }) {
    const key = `${userId}:${questionId}`;
    const cur = this.states.get(key) ?? { questionId, isFavorite: false, isRead: false };
    this.states.set(key, { ...cur, ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}), ...(patch.isRead !== undefined ? { isRead: patch.isRead } : {}) });
  }
  async recordSession(_t: string, userId: string, input: { clientSessionId: string; sectorId: string | null; total: number; correct: number }) {
    if (this.sessionRows.some((s) => s.userId === userId && s.clientSessionId === input.clientSessionId)) return;
    this.sessionRows.unshift({ userId, createdAt: new Date(), ...input });
  }
  async sessions(_t: string, userId: string, limit: number) {
    const mine = this.sessionRows.filter((s) => s.userId === userId);
    return { rows: mine.slice(0, limit), answered: mine.reduce((n, s) => n + s.total, 0), correct: mine.reduce((n, s) => n + s.correct, 0), sessions: mine.length };
  }
}

export function buildHealthFakes(o: { tenantA: string; now?: () => Date }) {
  const repository = new InMemoryHealthRepository(o.tenantA);
  const service = new HealthService({ repository, now: o.now });
  return { repository, service };
}
