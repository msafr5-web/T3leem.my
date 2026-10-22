import { createApp } from './app';
import { env, jwtPublicKey } from './config/env';
import { forTenant, prisma } from './config/database';
import { createBullConnection, redis } from './config/redis';
import { SandboxPaymentGateway } from './modules/billing/gateways/sandbox.gateway';
import { CheckoutService } from './modules/lms/enrollments/checkout.service';
import { EnrollmentController } from './modules/lms/enrollments/enrollment.controller';
import { PrismaEnrollmentRepository } from './modules/lms/enrollments/enrollment.repository';
import { TenantResolverService } from './modules/tenant/tenant-resolver.service';
import { TenantRepository } from './modules/tenant/tenant.repository';
import { createRateLimiter } from './shared/middlewares/rate-limiter.middleware';
import { logger } from './shared/services/logger';
import { QueueProducer } from './shared/services/queue.producer';

/** Composition root: the only place concrete infrastructure is wired together. */
async function main(): Promise<void> {
  const bullConnection = createBullConnection();
  const queueProducer = new QueueProducer(bullConnection);

  const checkoutService = new CheckoutService({
    repository: new PrismaEnrollmentRepository(),
    paymentGateway: new SandboxPaymentGateway(),
    zatcaQueue: queueProducer,
    vatRatePercent: env.VAT_RATE_PERCENT,
  });

  const app = createApp({
    tenantResolver: new TenantResolverService(new TenantRepository(prisma), redis, env.BASE_DOMAIN),
    scopeDb: forTenant,
    rateLimiter: createRateLimiter({ redis, points: env.RATE_LIMIT_POINTS, durationSec: env.RATE_LIMIT_DURATION_SEC }),
    jwt: { publicKey: jwtPublicKey, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
    corsOrigins: env.CORS_ORIGINS,
    enrollmentController: new EnrollmentController(checkoutService),
  });

  await prisma.$connect();
  const server = app.listen(env.PORT, () => logger.info('t3leem API listening', { port: env.PORT, env: env.NODE_ENV }));

  // Graceful shutdown for zero-downtime K8s rollouts: stop accepting, drain, then close pools.
  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await Promise.allSettled([queueProducer.close(), prisma.$disconnect(), redis.quit(), bullConnection.quit()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error('Fatal startup error', { err });
  process.exit(1);
});
