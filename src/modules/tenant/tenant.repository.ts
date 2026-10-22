import type { PrismaClient } from '@prisma/client';
import type { ResolvedTenant } from '../../shared/types/express';

const tenantSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  legalName: true,
  vatNumber: true,
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
}
