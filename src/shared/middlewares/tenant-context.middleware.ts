import type { NextFunction, Request, Response } from 'express';
import type { TenantPrismaClient } from '../../config/database';
import type { ResolvedTenant } from '../types/express';
import { HttpError } from '../utils/http-error';

export interface TenantResolver {
  findById(id: string): Promise<ResolvedTenant | null>;
  findBySlug(slug: string): Promise<ResolvedTenant | null>;
  findByHost(hostname: string): Promise<ResolvedTenant | null>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Resolves the tenant for every /api request and binds an RLS-scoped DB client to it.
 *
 * Resolution order: `x-tenant-id` header -> `x-tenant-slug` header (used by the web frontend's
 * path-based routes, e.g. /rukn) -> custom domain / `<slug>.BASE_DOMAIN` subdomain.
 *
 * Note on the PRD reference: running `SET LOCAL` here, in middleware, cannot work — SET LOCAL
 * only lives until the end of the current transaction, and the middleware's statement is its
 * own implicit transaction on whichever pooled connection it happened to get. The tenant is
 * therefore applied per query/transaction inside `req.db` (see config/database.ts).
 *
 * The header alone is not trusted for authorization: `authenticate` additionally requires the
 * JWT's tenant claim to equal `req.tenantId`, so a user cannot switch tenants by editing it.
 */
export const createTenantContextMiddleware =
  (resolver: TenantResolver, scopeDb: (tenantId: string) => TenantPrismaClient) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const headerTenantId = req.get('x-tenant-id');
    const headerTenantSlug = req.get('x-tenant-slug');

    let tenant: ResolvedTenant | null;
    if (headerTenantId !== undefined) {
      if (!UUID_RE.test(headerTenantId)) {
        throw HttpError.badRequest('INVALID_TENANT_ID', 'x-tenant-id must be a UUID');
      }
      tenant = await resolver.findById(headerTenantId);
    } else if (headerTenantSlug !== undefined) {
      if (!SLUG_RE.test(headerTenantSlug)) {
        throw HttpError.badRequest('INVALID_TENANT_SLUG', 'x-tenant-slug must be a lowercase slug');
      }
      tenant = await resolver.findBySlug(headerTenantSlug);
    } else {
      tenant = await resolver.findByHost(req.hostname);
    }

    if (!tenant) {
      throw new HttpError(400, 'TENANT_CONTEXT_MISSING', 'Tenant context (x-tenant-id header or tenant domain) is required');
    }
    if (tenant.status !== 'ACTIVE') {
      throw new HttpError(403, 'TENANT_INACTIVE', 'This academy is not active');
    }
    if (tenant.subscriptionEndsAt && new Date(tenant.subscriptionEndsAt).getTime() < Date.now()) {
      throw new HttpError(403, 'SUBSCRIPTION_EXPIRED', 'This academy subscription has ended');
    }

    req.tenantId = tenant.id;
    req.tenant = tenant;
    req.db = scopeDb(tenant.id);
    res.setHeader('x-tenant-id', tenant.id);
    next();
  };
