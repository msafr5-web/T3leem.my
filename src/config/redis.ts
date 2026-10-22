import { Redis } from 'ioredis';
import { logger } from '../shared/services/logger';
import { env } from './env';

/**
 * ioredis emits an 'error' event on every failed reconnect attempt; without a listener Node
 * prints an "Unhandled error event" per attempt. Log the first failure and the recovery only.
 */
function withConnectionLogging(client: Redis, name: string): Redis {
  let down = false;
  client.on('error', (err: Error & { code?: string }) => {
    // ECONNREFUSED arrives as an AggregateError with an empty message; the code is the useful part.
    if (!down) logger.warn(`Redis (${name}) unavailable, degrading`, { err: err.code ?? err.message });
    down = true;
  });
  client.on('ready', () => {
    if (down) logger.info(`Redis (${name}) reconnected`);
    down = false;
  });
  return client;
}

/**
 * General-purpose client: caching and rate limiting. Offline queue disabled so commands fail
 * fast while Redis is down — the tenant cache falls back to the DB and the rate limiter to memory.
 * `null` when REDIS_URL is unset (allowed outside APP_ENV=production).
 */
export const redis: Redis | null = env.REDIS_URL
  ? withConnectionLogging(new Redis(env.REDIS_URL, { enableOfflineQueue: false }), 'cache')
  : null;

/** BullMQ requires `maxRetriesPerRequest: null` on the connections it uses for blocking commands. */
export const createBullConnection = (): Redis | null =>
  env.REDIS_URL ? withConnectionLogging(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }), 'queue') : null;
