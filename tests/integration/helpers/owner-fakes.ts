import { randomUUID } from 'node:crypto';
import { JwtTokenSigner } from '../../../src/modules/auth/token-signer';
import { OtpLoginService, type OtpChallenge, type OtpRepository, type UserLookup } from '../../../src/modules/auth/otp.service';
import { OwnerService, type Features, type OwnerRepository, type OwnerTenantRow, type PlanRow, type TenantPatch } from '../../../src/modules/platform/owner.service';
import { CapturingMailer } from './registration-fakes';

export class InMemoryOtpRepository implements OtpRepository {
  rows = new Map<string, OtpChallenge>();
  created: { tenantId: string | null; email: string; at: Date }[] = [];
  clock: () => Date = () => new Date();

  async create(row: { tenantId: string | null; email: string; userId: string | null; purpose: string; expiresAt: Date }) {
    const id = randomUUID();
    this.rows.set(id, { id, ...row, codeHash: '', attempts: 0, sends: 1, lastSentAt: new Date(0) });
    this.created.push({ tenantId: row.tenantId, email: row.email, at: this.clock() });
    return id;
  }
  async find(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async bumpAttempts(id: string) {
    const r = this.rows.get(id);
    if (r) r.attempts++;
  }
  async setCode(id: string, codeHash: string, expiresAt: Date, isResend: boolean) {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { codeHash, expiresAt, attempts: 0, lastSentAt: this.clock(), sends: r.sends + (isResend ? 1 : 0) });
  }
  async delete(id: string) {
    return this.rows.delete(id);
  }
  async countRecent(tenantId: string | null, email: string, since: Date) {
    return this.created.filter((c) => c.tenantId === tenantId && c.email === email && c.at >= since).length;
  }
  async purgeExpired() {}
}

export class InMemoryOwnerRepository implements OwnerRepository {
  plans: PlanRow[] = [{ id: 'b0000000-0000-4000-8000-000000000001', name: 'الأساسية', maxStudents: 100, maxStorageGb: 10, monthlyPrice: 99, tenantCount: 0 }];
  tenants = new Map<string, OwnerTenantRow>();

  async listTenants() {
    return [...this.tenants.values()];
  }
  async getTenant(id: string) {
    return this.tenants.get(id) ?? null;
  }
  async updateTenant(id: string, patch: TenantPatch) {
    const t = this.tenants.get(id);
    if (!t) return false;
    Object.assign(t, patch);
    if (patch.planId !== undefined) t.planName = this.plans.find((p) => p.id === patch.planId)?.name ?? null;
    return true;
  }
  async planExists(id: string) {
    return this.plans.some((p) => p.id === id);
  }
  async listPlans() {
    return this.plans.map((p) => ({ ...p, tenantCount: [...this.tenants.values()].filter((t) => t.planId === p.id).length }));
  }
  async createPlan(input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }) {
    if (this.plans.some((p) => p.name === input.name)) return { kind: 'duplicate' } as const;
    const plan = { id: randomUUID(), tenantCount: 0, ...input };
    this.plans.push(plan);
    return { kind: 'ok', id: plan.id } as const;
  }
  async updatePlan(id: string, input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }) {
    const p = this.plans.find((x) => x.id === id);
    if (!p) return 'not_found' as const;
    if (this.plans.some((x) => x.name === input.name && x.id !== id)) return 'duplicate' as const;
    Object.assign(p, input);
    return 'ok' as const;
  }
  async deletePlan(id: string) {
    if (!this.plans.some((p) => p.id === id)) return 'not_found' as const;
    if ([...this.tenants.values()].some((t) => t.planId === id)) return 'in_use' as const;
    this.plans = this.plans.filter((p) => p.id !== id);
    return 'ok' as const;
  }
}

export const PENDING_TENANT = 'c1000000-0000-4000-8000-000000000001';
export const ALL_FEATURES: Features = { health: true, recorded: true };

export function buildOtpFakes(opts: { users: UserLookup; signer: JwtTokenSigner; platformAdmins?: string[]; now?: () => Date }) {
  const repository = new InMemoryOtpRepository();
  const mailer = new CapturingMailer();
  const clock = { now: new Date('2026-11-01T10:00:00Z') };
  const now = opts.now ?? (() => clock.now);
  repository.clock = now;
  const service = new OtpLoginService({ repository, users: opts.users, mailer, signer: opts.signer, platformAdmins: opts.platformAdmins ?? ['t3leemy@t3leem.my'], now });
  return { repository, mailer, service, clock };
}

export function buildOwnerFakes(opts: { mailer: CapturingMailer; invalidated?: string[]; now?: () => Date }) {
  const repository = new InMemoryOwnerRepository();
  repository.tenants.set(PENDING_TENANT, {
    id: PENDING_TENANT,
    slug: 'health',
    name: 'أكاديمية الشهادات الصحية',
    status: 'PROVISIONING',
    planId: null,
    planName: null,
    approvedAt: null,
    subscriptionEndsAt: null,
    features: { health: false, recorded: false },
    ownerName: 'عبدالرحمن',
    ownerEmail: 'owner@health.test',
    ownerPhone: '+966500000000',
    createdAt: new Date('2026-10-31T10:00:00Z'),
  });
  const invalidated = opts.invalidated ?? [];
  const clock = { now: new Date('2026-11-01T10:00:00Z') };
  const service = new OwnerService({ repository, mailer: opts.mailer, webUrl: 'https://t3leem.my', invalidate: async (t) => void invalidated.push(t.slug), now: opts.now ?? (() => clock.now) });
  return { repository, service, invalidated, clock };
}
