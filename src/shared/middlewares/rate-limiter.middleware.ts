import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { HttpError } from '../utils/http-error';

export interface RateLimitOptions {
  redis: Redis | null;
  points: number;
  durationSec: number;
  keyPrefix?: string;
}

/**
 * Per-tenant, per-IP limiter backed by Redis so limits hold across all API replicas.
 * If Redis is unreachable, the in-memory insurance limiter keeps a (per-instance) cap
 * instead of failing open. Without Redis configured at all, the memory limiter is used directly.
 */
export function createRateLimiter({ redis, points, durationSec, keyPrefix = 'rl:api' }: RateLimitOptions) {
  const memory = new RateLimiterMemory({ keyPrefix, points, duration: durationSec });
  const limiter = redis
    ? new RateLimiterRedis({ storeClient: redis, keyPrefix, points, duration: durationSec, insuranceLimiter: memory })
    : memory;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `${req.tenantId ?? 'no-tenant'}:${req.ip ?? 'unknown'}`;
    try {
      const result = await limiter.consume(key);
      res.setHeader('RateLimit-Remaining', String(result.remainingPoints));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        res.setHeader('Retry-After', String(Math.ceil(err.msBeforeNext / 1000)));
        throw new HttpError(429, 'RATE_LIMITED', 'Too many requests');
      }
      throw err;
    }
  };
}
