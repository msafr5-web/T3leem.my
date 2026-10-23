import type { Redis } from 'ioredis';
import type { TenantResolver } from '../../shared/middlewares/tenant-context.middleware';
import { logger } from '../../shared/services/logger';
import type { ResolvedTenant } from '../../shared/types/express';
import type { TenantRepository } from './tenant.repository';

const CACHE_TTL_SEC = 60;

/**
 * Resolves tenants by id / subdomain / custom domain, with a short Redis read-through cache
 * because this runs on every API request. A suspended tenant takes effect within CACHE_TTL_SEC
 * (call `invalidate` from the admin flow for immediate effect).
 */
export class TenantResolverService implements TenantResolver {
  constructor(
    private readonly repository: TenantRepository,
    private readonly redis: Redis | null,
    private readonly baseDomain: string,
  ) {}

  findById(id: string): Promise<ResolvedTenant | null> {
    return this.cached(`tenant:id:${id}`, () => this.repository.findById(id));
  }

  findBySlug(slug: string): Promise<ResolvedTenant | null> {
    return this.cached(`tenant:slug:${slug.toLowerCase()}`, () => this.repository.findBySlug(slug.toLowerCase()));
  }

  findByHost(hostname: string): Promise<ResolvedTenant | null> {
    const host = hostname.toLowerCase();
    const suffix = `.${this.baseDomain.toLowerCase()}`;

    if (host.endsWith(suffix)) {
      const slug = host.slice(0, -suffix.length);
      // Only a single label is a tenant slug (rukn.t3leem.my, not a.b.t3leem.my).
      if (!slug || slug.includes('.')) return Promise.resolve(null);
      return this.findBySlug(slug);
    }
    return this.cached(`tenant:domain:${host}`, () => this.repository.findByCustomDomain(host));
  }

  async invalidate(tenant: Pick<ResolvedTenant, 'id' | 'slug'>, customDomain?: string | null): Promise<void> {
    const keys = [`tenant:id:${tenant.id}`, `tenant:slug:${tenant.slug}`];
    if (customDomain) keys.push(`tenant:domain:${customDomain.toLowerCase()}`);
    await this.redis?.del(...keys);
  }

  private async cached(key: string, load: () => Promise<ResolvedTenant | null>): Promise<ResolvedTenant | null> {
    if (!this.redis) return load();
    try {
      const hit = await this.redis.get(key);
      if (hit) return JSON.parse(hit) as ResolvedTenant;
    } catch (err) {
      // Cache is an optimization: degrade to the database rather than failing the request.
      logger.warn('Tenant cache read failed', { err, key });
    }

    const tenant = await load();
    if (tenant) {
      this.redis.set(key, JSON.stringify(tenant), 'EX', CACHE_TTL_SEC).catch((err: unknown) => {
        logger.warn('Tenant cache write failed', { err, key });
      });
    }
    return tenant;
  }
}
