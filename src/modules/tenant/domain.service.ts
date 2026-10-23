import { randomBytes } from 'node:crypto';
import { HttpError } from '../../shared/utils/http-error';
import type { Actor } from '../provider/provider.types';

export interface DomainRecord {
  domain: string | null;
  token: string | null;
  verifiedAt: Date | null;
}

export interface DomainRepository {
  getDomain(tenantId: string): Promise<DomainRecord | null>;
  /** Throws a P2002 unique violation if another academy already holds the domain. */
  setDomain(tenantId: string, actor: Actor, domain: string | null, token: string | null): Promise<void>;
  markDomainVerified(tenantId: string, actor: Actor): Promise<void>;
  findSlugByVerifiedDomain(domain: string): Promise<string | null>;
}

export interface DomainStatus {
  domain: string | null;
  verified: boolean;
  txtName: string | null;
  txtValue: string | null;
  cnameTarget: string;
}

const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

/**
 * PRD §6 "custom domain" for white-label academies. Ownership is proven with a DNS TXT record
 * before the domain routes anywhere; otherwise a provider could point *someone else's* domain
 * at their academy. Until verified, the domain is stored but ignored by tenant resolution.
 */
export class DomainService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly baseDomain: string,
    private readonly resolveTxt: (name: string) => Promise<string[][]>,
    private readonly onChange: (tenantId: string, oldDomain: string | null) => Promise<void>,
  ) {}

  private challengeName = (domain: string) => `_t3leem-challenge.${domain}`;
  private challengeValue = (token: string) => `t3leem-verify=${token}`;

  async status(tenantId: string): Promise<DomainStatus> {
    const rec = await this.repository.getDomain(tenantId);
    if (!rec) throw HttpError.notFound('TENANT_NOT_FOUND', 'Academy not found');
    return {
      domain: rec.domain,
      verified: rec.verifiedAt !== null,
      txtName: rec.domain ? this.challengeName(rec.domain) : null,
      txtValue: rec.token ? this.challengeValue(rec.token) : null,
      cnameTarget: `cname.${this.baseDomain}`,
    };
  }

  async set(tenantId: string, actor: Actor, raw: string): Promise<DomainStatus> {
    const domain = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!HOSTNAME_RE.test(domain)) throw HttpError.unprocessable('INVALID_DOMAIN', 'Enter a domain like academy.com.sa');
    const base = this.baseDomain.toLowerCase();
    if (domain === base || domain.endsWith(`.${base}`)) {
      throw HttpError.unprocessable('PLATFORM_DOMAIN', 'Platform subdomains are assigned automatically; enter your own domain');
    }
    const current = await this.repository.getDomain(tenantId);
    try {
      await this.repository.setDomain(tenantId, actor, domain, randomBytes(16).toString('hex'));
    } catch (err) {
      if (isUniqueViolation(err)) throw HttpError.conflict('DOMAIN_TAKEN', 'This domain is already connected to another academy');
      throw err;
    }
    await this.onChange(tenantId, current?.domain ?? null);
    return this.status(tenantId);
  }

  async remove(tenantId: string, actor: Actor): Promise<void> {
    const current = await this.repository.getDomain(tenantId);
    await this.repository.setDomain(tenantId, actor, null, null);
    await this.onChange(tenantId, current?.domain ?? null);
  }

  async verify(tenantId: string, actor: Actor): Promise<DomainStatus> {
    const rec = await this.repository.getDomain(tenantId);
    if (!rec?.domain || !rec.token) throw HttpError.unprocessable('NO_DOMAIN', 'Add a domain first');
    let records: string[][] = [];
    try {
      records = await this.resolveTxt(this.challengeName(rec.domain));
    } catch {
      records = [];
    }
    // TXT records may be split into chunks; join each record's chunks before comparing.
    const found = records.some((chunks) => chunks.join('') === this.challengeValue(rec.token as string));
    if (!found) throw HttpError.unprocessable('DNS_RECORD_NOT_FOUND', 'The TXT record was not found yet. DNS changes can take up to an hour.');
    await this.repository.markDomainVerified(tenantId, actor);
    await this.onChange(tenantId, rec.domain);
    return this.status(tenantId);
  }

  /** For the web edge: host -> academy slug, verified domains only. */
  async slugForHost(host: string): Promise<string> {
    const slug = await this.repository.findSlugByVerifiedDomain(host.trim().toLowerCase());
    if (!slug) throw HttpError.notFound('DOMAIN_NOT_FOUND', 'Unknown domain');
    return slug;
  }
}
