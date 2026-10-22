import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from './app';
import { env, jwtPrivateKey, jwtPublicKey } from './config/env';
import { forTenant, prisma } from './config/database';
import { createBullConnection, redis } from './config/redis';
import { AuthController } from './modules/auth/auth.controller';
import { PrismaAuthRepository } from './modules/auth/auth.repository';
import { AuthService } from './modules/auth/auth.service';
import { JwtTokenSigner } from './modules/auth/token-signer';
import { SandboxPaymentGateway } from './modules/billing/gateways/sandbox.gateway';
import { CourseController } from './modules/lms/courses/course.controller';
import { PrismaCourseCatalogRepository } from './modules/lms/courses/course.repository';
import { CourseCatalogService } from './modules/lms/courses/course.service';
import { CheckoutService } from './modules/lms/enrollments/checkout.service';
import { EnrollmentController } from './modules/lms/enrollments/enrollment.controller';
import { PrismaEnrollmentRepository } from './modules/lms/enrollments/enrollment.repository';
import { TenantResolverService } from './modules/tenant/tenant-resolver.service';
import { TenantRepository } from './modules/tenant/tenant.repository';
import { createRateLimiter } from './shared/middlewares/rate-limiter.middleware';
import { logger } from './shared/services/logger';
import { DeferredZatcaQueue, QueueProducer, type ZatcaQueue } from './shared/services/queue.producer';
import { hashPassword, verifyPassword } from './shared/utils/password';

export interface ServerApp {
  app: Express;
  /** Releases pools and connections (graceful shutdown). */
  close(): Promise<void>;
}

/**
 * Composition root: the only place concrete infrastructure is wired together.
 * Shared by the long-running server (server.ts) and the Vercel function (api/index.ts).
 */
export function createServerApp(): ServerApp {
  const bullConnection = createBullConnection();
  const queueProducer = bullConnection ? new QueueProducer(bullConnection) : null;
  const zatcaQueue: ZatcaQueue = queueProducer ?? new DeferredZatcaQueue();
  if (!redis) logger.warn('REDIS_URL not set: in-memory rate limits, no tenant cache, ZATCA sync deferred');

  const authService = new AuthService({
    repository: new PrismaAuthRepository(),
    signer: new JwtTokenSigner(jwtPrivateKey, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      ttlSeconds: env.JWT_ACCESS_TTL_SEC,
    }),
    verifyPassword,
    dummyHash: hashPassword(randomBytes(16).toString('hex')),
  });

  const checkoutService = new CheckoutService({
    repository: new PrismaEnrollmentRepository(),
    paymentGateway: new SandboxPaymentGateway(),
    zatcaQueue,
    vatRatePercent: env.VAT_RATE_PERCENT,
  });

  const app = createApp({
    tenantResolver: new TenantResolverService(new TenantRepository(prisma), redis, env.BASE_DOMAIN),
    scopeDb: forTenant,
    rateLimiter: createRateLimiter({ redis, points: env.RATE_LIMIT_POINTS, durationSec: env.RATE_LIMIT_DURATION_SEC }),
    // 10 attempts / 15 min per tenant+IP: slows password guessing to a crawl.
    loginRateLimiter: createRateLimiter({ redis, points: 10, durationSec: 15 * 60, keyPrefix: 'rl:login' }),
    jwt: { publicKey: jwtPublicKey, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
    corsOrigins: env.CORS_ORIGINS,
    authController: new AuthController(authService),
    courseController: new CourseController(new CourseCatalogService(new PrismaCourseCatalogRepository(), env.VAT_RATE_PERCENT)),
    enrollmentController: new EnrollmentController(checkoutService),
  });

  return {
    app,
    async close() {
      await Promise.allSettled([queueProducer?.close(), prisma.$disconnect(), redis?.quit(), bullConnection?.quit()]);
    },
  };
}
