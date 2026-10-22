import { createServerApp } from './bootstrap';
import { env } from './config/env';
import { prisma } from './config/database';
import { logger } from './shared/services/logger';

/** Long-running process entry (local dev, Docker/K8s). Vercel uses api/index.ts instead. */
async function main(): Promise<void> {
  const { app, close } = createServerApp();

  await prisma.$connect();
  const server = app.listen(env.PORT, () =>
    logger.info('t3leem API listening', { port: env.PORT, env: env.NODE_ENV, appEnv: env.APP_ENV }),
  );

  // Graceful shutdown for zero-downtime K8s rollouts: stop accepting, drain, then close pools.
  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await close();
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
