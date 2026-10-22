import type { PrismaClient } from '@prisma/client';
import type { ResolvedTenant } from '../../shared/types/express';

const tenantSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  legalName: true,
  vatNumber: true,
  brandSettings: true,
} as const;

/** Reads the tenant registry with the base client: `tenants` is not under RLS by design. */
export class TenantRepository {
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
  listActive(): Promise<{ slug: string; name: string; brandSettings: ResolvedTenant['brandSettings'] }[]> {
    return this.db.tenant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { slug: true, name: true, brandSettings: true },
    });
  }
}
