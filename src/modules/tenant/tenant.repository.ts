import type { Prisma, PrismaClient } from '@prisma/client';
import { withTenantTransaction } from '../../config/database';
import type { ResolvedTenant } from '../../shared/types/express';
import type { Actor } from '../provider/provider.types';
import type { BrandingProfile, BrandingRepository, LogoMime } from './branding.service';
import type { RegistrationInput, RegistrationRepository } from './registration.service';

const tenantSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  legalName: true,
  vatNumber: true,
  brandSettings: true,
  logoUpdatedAt: true,
} as const;

const str = (settings: Prisma.JsonValue, key: string): string | null => {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;
  const v = (settings as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
};

/**
 * The tenant registry (`tenants` is not under RLS by design: it's read before a tenant
 * context exists). Writes that should be audited run inside the tenant's RLS transaction so
 * the audit_logs row is tenant-scoped like every other audit entry.
 */
export class TenantRepository implements BrandingRepository, RegistrationRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<ResolvedTenant | null> {
    return this.db.tenant.findUnique({ where: { id }, select: tenantSelect });
  }

  findBySlug(slug: string): Promise<ResolvedTenant | null> {
    return this.db.tenant.findUnique({ where: { slug }, select: tenantSelect });
  }

  findByCustomDomain(domain: string): Promise<ResolvedTenant | null> {
    return this.db.tenant.findUnique({ where: { customDomain: domain }, select: tenantSelect });
  }

  /** Public provider directory: active academies only, public fields only. */
  listActive(): Promise<{ slug: string; name: string; brandSettings: ResolvedTenant['brandSettings']; logoUpdatedAt: Date | null }[]> {
    return this.db.tenant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { slug: true, name: true, brandSettings: true, logoUpdatedAt: true },
    });
  }

  // ----- branding -----

  async getBranding(tenantId: string): Promise<{ profile: BrandingProfile; brandSettings: Prisma.JsonValue } | null> {
    const t = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, legalName: true, vatNumber: true, brandSettings: true, logoMimeType: true, logoUpdatedAt: true },
    });
    if (!t) return null;
    return {
      brandSettings: t.brandSettings,
      profile: {
        name: t.name,
        slug: t.slug,
        tagline: str(t.brandSettings, 'tagline'),
        about: str(t.brandSettings, 'about'),
        city: str(t.brandSettings, 'city'),
        primaryColor: str(t.brandSettings, 'primaryColor'),
        legalName: t.legalName,
        vatNumber: t.vatNumber,
        hasLogo: t.logoMimeType !== null,
        logoUpdatedAt: t.logoUpdatedAt,
      },
    };
  }

  updateBranding(
    tenantId: string,
    actor: Actor,
    data: { name?: string; legalName?: string | null; vatNumber?: string | null; brandSettings: Prisma.InputJsonValue },
  ): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data });
      await tx.auditLog.create({
        data: { tenantId, actorId: actor.userId, actorRole: actor.role, action: 'branding.updated', entityType: 'tenant', entityId: tenantId, metadata: { fields: Object.keys(data) }, ipAddress: actor.ip },
      });
    });
  }

  setLogo(tenantId: string, actor: Actor, logo: { bytes: Buffer; mime: LogoMime } | null): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        // new Uint8Array(): Prisma's Bytes type wants an ArrayBuffer-backed view, not a pooled Buffer.
        data: logo
          ? { logo: new Uint8Array(logo.bytes), logoMimeType: logo.mime, logoUpdatedAt: new Date() }
          : { logo: null, logoMimeType: null, logoUpdatedAt: null },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.userId,
          actorRole: actor.role,
          action: logo ? 'branding.logo_uploaded' : 'branding.logo_removed',
          entityType: 'tenant',
          entityId: tenantId,
          metadata: logo ? { bytes: logo.bytes.length, mime: logo.mime } : {},
          ipAddress: actor.ip,
        },
      });
    });
  }

  async getLogo(tenantId: string): Promise<{ bytes: Buffer; mime: string; updatedAt: Date } | null> {
    const t = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { logo: true, logoMimeType: true, logoUpdatedAt: true } });
    if (!t?.logo || !t.logoMimeType || !t.logoUpdatedAt) return null;
    return { bytes: Buffer.from(t.logo), mime: t.logoMimeType, updatedAt: t.logoUpdatedAt };
  }

  // ----- registration -----

  async slugTaken(slug: string): Promise<boolean> {
    return (await this.db.tenant.count({ where: { slug } })) > 0;
  }

  async register(input: Omit<RegistrationInput, 'password'> & { passwordHash: string }): Promise<{ tenantId: string }> {
    return this.db.$transaction(async (tx) => {
      const plan = await tx.saasPlan.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
      const tenant = await tx.tenant.create({
        data: {
          name: input.academyName,
          slug: input.slug,
          status: 'ACTIVE',
          planId: plan?.id ?? null,
          brandSettings: input.city ? { locale: 'ar', city: input.city } : { locale: 'ar' },
        },
        select: { id: true },
      });
      // The admin user and audit row are tenant-owned: write them under the new tenant's RLS context.
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, TRUE)`;
      const admin = await tx.user.create({
        data: { tenantId: tenant.id, email: input.adminEmail, fullName: input.adminName, passwordHash: input.passwordHash, role: 'TENANT_ADMIN' },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, actorId: admin.id, actorRole: 'TENANT_ADMIN', action: 'tenant.registered', entityType: 'tenant', entityId: tenant.id, metadata: { slug: input.slug } },
      });
      return { tenantId: tenant.id };
    });
  }
}
