import { Redis } from 'ioredis';
import { env } from './env';

/** General-purpose client: caching and rate limiting. */
export const redis = new Redis(env.REDIS_URL, { enableOfflineQueue: false, lazyConnect: false });

/** BullMQ requires `maxRetriesPerRequest: null` on the connections it uses for blocking commands. */
export const createBullConnection = (): Redis => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
