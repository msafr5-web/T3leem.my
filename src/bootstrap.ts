import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from './app';
import { env, jwtPrivateKey, jwtPublicKey, zoomCredentials } from './config/env';
import { ManualMeetingScheduler, ZoomMeetingScheduler } from './modules/live/meeting-scheduler';
import { BrandingService } from './modules/tenant/branding.service';
import { RegistrationService } from './modules/tenant/registration.service';
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
import { ProviderController } from './modules/provider/provider.controller';
import { PrismaProviderRepository } from './modules/provider/provider.repository';
import { ProviderService } from './modules/provider/provider.service';
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

  const tenantRepository = new TenantRepository(prisma);
  const tenantResolver = new TenantResolverService(tenantRepository, redis, env.BASE_DOMAIN);
  const catalogService = new CourseCatalogService(new PrismaCourseCatalogRepository(), env.VAT_RATE_PERCENT);
  const meetings = zoomCredentials ? new ZoomMeetingScheduler(zoomCredentials) : new ManualMeetingScheduler();
  if (!zoomCredentials) logger.info('Zoom not configured: virtual classroom links are entered manually');
  const providerService = new ProviderService({ repository: new PrismaProviderRepository(), hashPassword, meetings });
  const brandingService = new BrandingService(tenantRepository, async (tenantId) => {
    const tenant = await tenantRepository.findById(tenantId);
    if (tenant) await tenantResolver.invalidate(tenant).catch(() => undefined);
  });

  const app = createApp({
    tenantResolver,
    scopeDb: forTenant,
    rateLimiter: createRateLimiter({ redis, points: env.RATE_LIMIT_POINTS, durationSec: env.RATE_LIMIT_DURATION_SEC }),
    // 10 attempts / 15 min per tenant+IP: slows password guessing to a crawl.
    loginRateLimiter: createRateLimiter({ redis, points: 10, durationSec: 15 * 60, keyPrefix: 'rl:login' }),
    jwt: { publicKey: jwtPublicKey, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
    corsOrigins: env.CORS_ORIGINS,
    authController: new AuthController(authService),
    courseController: new CourseController(catalogService),
    enrollmentController: new EnrollmentController(checkoutService),
    providerController: new ProviderController(providerService, catalogService),
    providerDirectory: tenantRepository,
    brandingService,
    registrationService: new RegistrationService(tenantRepository, hashPassword, env.PROVIDER_SIGNUP_ENABLED),
    // 5 academy sign-ups per IP per hour: stops scripted mass registration.
    signupRateLimiter: createRateLimiter({ redis, points: 5, durationSec: 60 * 60, keyPrefix: 'rl:signup' }),
  });

  return {
    app,
    async close() {
      await Promise.allSettled([queueProducer?.close(), prisma.$disconnect(), redis?.quit(), bullConnection?.quit()]);
    },
  };
}
