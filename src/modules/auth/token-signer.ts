import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';

export interface AccessTokenSubject {
  userId: string;
  tenantId: string;
  role: UserRole;
}

export interface TokenSigner {
  /** Undefined when no private key is configured on this deployment. */
  readonly available: boolean;
  readonly ttlSeconds: number;
  sign(subject: AccessTokenSubject): string;
}

/**
 * RS256 access tokens. Claims mirror what `authenticate` verifies: sub, tid, role.
 * Short-lived by design; refresh tokens (Redis-backed) come with the full auth module.
 */
export class JwtTokenSigner implements TokenSigner {
  constructor(
    private readonly privateKey: string | undefined,
    private readonly opts: { issuer: string; audience: string; ttlSeconds: number },
  ) {}

  get available(): boolean {
    return this.privateKey !== undefined;
  }

  get ttlSeconds(): number {
    return this.opts.ttlSeconds;
  }

  sign({ userId, tenantId, role }: AccessTokenSubject): string {
    if (!this.privateKey) throw new Error('JWT signing key is not configured');
    return jwt.sign({ tid: tenantId, role }, this.privateKey, {
      algorithm: 'RS256',
      subject: userId,
      issuer: this.opts.issuer,
      audience: this.opts.audience,
      expiresIn: this.opts.ttlSeconds,
    });
  }
}
