import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser, ResolvedTenant } from '../types/express';
import { HttpError } from '../utils/http-error';

export interface JwtVerifyOptions {
  publicKey: string;
  issuer: string;
  audience: string;
}

interface AccessTokenClaims {
  sub: string;
  tid: string;
  role: UserRole;
}

const ROLES = new Set<string>(Object.values(UserRole));

function isAccessTokenClaims(payload: unknown): payload is AccessTokenClaims {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.sub === 'string' && typeof p.tid === 'string' && typeof p.role === 'string' && ROLES.has(p.role);
}

/**
 * Verifies an RS256 access token. Must run after the tenant context middleware.
 *
 * `algorithms: ['RS256']` is pinned so a token signed with HS256 using the public key as the
 * HMAC secret (classic alg-confusion attack) is rejected.
 */
export const authenticate =
  ({ publicKey, issuer, audience }: JwtVerifyOptions) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw HttpError.unauthorized();

    let payload: unknown;
    try {
      payload = jwt.verify(header.slice('Bearer '.length), publicKey, { algorithms: ['RS256'], issuer, audience });
    } catch {
      throw HttpError.unauthorized('Invalid or expired access token');
    }
    if (!isAccessTokenClaims(payload)) throw HttpError.unauthorized('Malformed access token');

    // Cross-tenant guard: a token minted for academy A is useless against academy B,
    // even if the caller rewrites x-tenant-id. SUPER_ADMIN is not exempt here on purpose —
    // platform operations go through a separate, non-tenant router.
    if (payload.tid !== req.tenantId) throw HttpError.forbidden('Token does not belong to this tenant');

    req.user = { id: payload.sub, tenantId: payload.tid, role: payload.role };
    next();
  };

export const requireRoles =
  (...allowed: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw HttpError.unauthorized();
    if (!allowed.includes(req.user.role)) throw HttpError.forbidden();
    next();
  };

/** Narrows the optional request fields once the guards above have run. */
export function requireAuthContext(req: Request): { tenantId: string; tenant: ResolvedTenant; user: AuthenticatedUser } {
  if (!req.tenantId || !req.tenant || !req.user) {
    throw new Error('requireAuthContext called on a route without tenant + auth middleware');
  }
  return { tenantId: req.tenantId, tenant: req.tenant, user: req.user };
}

/** The module must be switched on for this academy (the platform owner decides which ones). */
export const requireFeature =
  (feature: string) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const f = req.tenant?.features;
    const on = typeof f === 'object' && f !== null && !Array.isArray(f) && (f as Record<string, unknown>)[feature] === true;
    if (!on) throw new HttpError(403, 'FEATURE_DISABLED', 'This feature is not enabled for this academy');
    next();
  };
