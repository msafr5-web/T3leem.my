import type { Mailer } from '../../shared/services/mailer';
import { HttpError } from '../../shared/utils/http-error';
import type { TenantStatus } from '@prisma/client';

export const FEATURES = ['health', 'recorded'] as const;
export type FeatureKey = (typeof FEATURES)[number];
export type Features = Record<FeatureKey, boolean>;

export interface OwnerTenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  planId: string | null;
  planName: string | null;
  approvedAt: Date | null;
  subscriptionEndsAt: Date | null;
  features: Features;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  createdAt: Date;
}

export interface PlanRow {
  id: string;
  name: string;
  maxStudents: number;
  maxStorageGb: number;
  monthlyPrice: number;
  tenantCount: number;
}

export interface TenantPatch {
  status?: TenantStatus;
  planId?: string | null;
  subscriptionEndsAt?: Date | null;
  features?: Features;
  approvedAt?: Date | null;
}

export interface OwnerRepository {
  listTenants(): Promise<OwnerTenantRow[]>;
  getTenant(id: string): Promise<OwnerTenantRow | null>;
  updateTenant(id: string, patch: TenantPatch): Promise<boolean>;
  planExists(id: string): Promise<boolean>;
  listPlans(): Promise<PlanRow[]>;
  createPlan(input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }): Promise<{ kind: 'ok'; id: string } | { kind: 'duplicate' }>;
  updatePlan(id: string, input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }): Promise<'ok' | 'not_found' | 'duplicate'>;
  deletePlan(id: string): Promise<'ok' | 'not_found' | 'in_use'>;
}

interface Deps {
  repository: OwnerRepository;
  mailer: Mailer;
  /** Public web URL for the links in e-mails. */
  webUrl: string;
  /** Drops the cached tenant so a status / subscription change takes effect at once. */
  invalidate: (tenant: { id: string; slug: string }) => Promise<void>;
  now?: () => Date;
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** The platform owner's decisions about each academy: approval, plan, subscription period and modules. */
export class OwnerService {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  async overview() {
    const tenants = await this.deps.repository.listTenants();
    const now = this.now().getTime();
    return {
      total: tenants.length,
      pending: tenants.filter((t) => t.status === 'PROVISIONING').length,
      active: tenants.filter((t) => t.status === 'ACTIVE' && (!t.subscriptionEndsAt || t.subscriptionEndsAt.getTime() >= now)).length,
      suspended: tenants.filter((t) => t.status === 'SUSPENDED').length,
      expired: tenants.filter((t) => t.status === 'ACTIVE' && t.subscriptionEndsAt && t.subscriptionEndsAt.getTime() < now).length,
      tenants,
    };
  }

  private async load(id: string): Promise<OwnerTenantRow> {
    const t = await this.deps.repository.getTenant(id);
    if (!t) throw HttpError.notFound('TENANT_NOT_FOUND', 'Academy not found');
    return t;
  }

  private async notifyApproved(t: OwnerTenantRow, endsAt: Date | null): Promise<void> {
    if (!t.ownerEmail) return;
    const site = `${this.deps.webUrl.replace(/\/$/, '')}/${t.slug}`;
    const until = endsAt ? new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long', timeZone: 'Asia/Riyadh' }).format(endsAt) : 'بلا تاريخ انتهاء';
    const text = [
      `مرحباً ${t.ownerName ?? ''}،`.trim(),
      '',
      `تم اعتماد اشتراك أكاديمية «${t.name}» في منصة T3leem.my.`,
      `• الباقة: ${t.planName ?? 'الأساسية'}`,
      `• الاشتراك حتى: ${until}`,
      `• رابط الموقع: ${site}`,
      `• لوحة التحكم: ${site}/dashboard`,
      '',
      'للدخول اكتب بريدك في صفحة الدخول فيصلك رمز من ٦ أرقام.',
    ].join('\n');
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1b1f1e;max-width:520px"><p>مرحباً ${escapeHtml(t.ownerName ?? '')}،</p><p>تم اعتماد اشتراك أكاديمية <strong>«${escapeHtml(t.name)}»</strong> في منصة T3leem.my.</p><ul><li>الباقة: ${escapeHtml(t.planName ?? 'الأساسية')}</li><li>الاشتراك حتى: ${escapeHtml(until)}</li><li>رابط الموقع: <a href="${escapeHtml(site)}">${escapeHtml(site)}</a></li><li>لوحة التحكم: <a href="${escapeHtml(site)}/dashboard">${escapeHtml(site)}/dashboard</a></li></ul><p>للدخول اكتب بريدك في صفحة الدخول فيصلك رمز من ٦ أرقام.</p></div>`;
    try {
      await this.deps.mailer.send({ to: t.ownerEmail, subject: `تم اعتماد أكاديمية «${t.name}» على T3leem.my`, text, html });
    } catch {
      // The approval is already saved; a failed notification must not undo it (the owner can resend by WhatsApp).
    }
  }

  /** Approves a pending academy: plan, subscription length (months; 0 = no end) and modules. */
  async approve(id: string, input: { planId: string | null; months: number; features: Features }): Promise<OwnerTenantRow> {
    const t = await this.load(id);
    if (input.planId && !(await this.deps.repository.planExists(input.planId))) throw HttpError.unprocessable('UNKNOWN_PLAN', 'Plan not found');
    const now = this.now();
    const endsAt = input.months > 0 ? addMonths(now, input.months) : null;
    await this.deps.repository.updateTenant(id, { status: 'ACTIVE', planId: input.planId, subscriptionEndsAt: endsAt, features: input.features, approvedAt: now });
    await this.deps.invalidate(t);
    const updated = await this.load(id);
    await this.notifyApproved(updated, endsAt);
    return updated;
  }

  /** Any other change: suspend / reactivate, plan, a new end date, or the modules. */
  async update(id: string, patch: TenantPatch): Promise<OwnerTenantRow> {
    const t = await this.load(id);
    if (patch.planId && !(await this.deps.repository.planExists(patch.planId))) throw HttpError.unprocessable('UNKNOWN_PLAN', 'Plan not found');
    await this.deps.repository.updateTenant(id, patch);
    await this.deps.invalidate(t);
    return this.load(id);
  }

  /** Extends the paid period by whole months from the later of now and the current end date. */
  async extend(id: string, months: number): Promise<OwnerTenantRow> {
    const t = await this.load(id);
    const now = this.now();
    const base = t.subscriptionEndsAt && t.subscriptionEndsAt > now ? t.subscriptionEndsAt : now;
    await this.deps.repository.updateTenant(id, { subscriptionEndsAt: addMonths(base, months) });
    await this.deps.invalidate(t);
    return this.load(id);
  }

  listPlans() {
    return this.deps.repository.listPlans();
  }

  async createPlan(input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }): Promise<string> {
    const r = await this.deps.repository.createPlan(input);
    if (r.kind === 'duplicate') throw HttpError.conflict('PLAN_EXISTS', 'A plan with this name already exists');
    return r.id;
  }

  async updatePlan(id: string, input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }): Promise<void> {
    const r = await this.deps.repository.updatePlan(id, input);
    if (r === 'not_found') throw HttpError.notFound('PLAN_NOT_FOUND', 'Plan not found');
    if (r === 'duplicate') throw HttpError.conflict('PLAN_EXISTS', 'A plan with this name already exists');
  }

  async deletePlan(id: string): Promise<void> {
    const r = await this.deps.repository.deletePlan(id);
    if (r === 'not_found') throw HttpError.notFound('PLAN_NOT_FOUND', 'Plan not found');
    if (r === 'in_use') throw HttpError.conflict('PLAN_IN_USE', 'Academies are on this plan; move them first');
  }
}
