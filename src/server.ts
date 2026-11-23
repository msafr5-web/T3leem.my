import { createServerApp } from './bootstrap';
import { env } from './config/env';
import { prisma } from './config/database';
import { logger } from './shared/services/logger';

/** Long-running process entry (local dev, Docker/K8s). Vercel uses api/index.ts instead. */
async function main(): Promise<void> {
  const { app, close, attendanceSweeper } = createServerApp();

  await prisma.$connect();
  const server = app.listen(env.PORT, () =>
    logger.info('t3leem API listening', { port: env.PORT, env: env.NODE_ENV, appEnv: env.APP_ENV }),
  );

  // Attendance: every minute warn about late trainees and settle finished sessions. Idempotent, so a second instance is harmless.
  // Turn off with ATTENDANCE_SWEEP=off (e.g. on a host that runs the sweep elsewhere).
  if (process.env.ATTENDANCE_SWEEP !== 'off') {
    let sweeping = false;
    const sweep = async (): Promise<void> => {
      if (sweeping) return;
      sweeping = true;
      try {
        await attendanceSweeper.runOnce();
      } catch (err) {
        logger.warn('Attendance sweep failed', { err: err instanceof Error ? err.message : err });
      } finally {
        sweeping = false;
      }
    };
    setInterval(() => void sweep(), 60_000).unref();
    setTimeout(() => void sweep(), 10_000).unref();
  }

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
