/**
 * Background worker process (SWET §4): consumes video jobs from BullMQ so transcoding never runs
 * on the API's event loop. Run alongside the API when REDIS_URL is set:  npm run worker
 */
import { Worker } from 'bullmq';
import { createVideoService } from './bootstrap';
import { env } from './config/env';
import { createBullConnection } from './config/redis';
import { prisma } from './config/database';
import type { VideoJob } from './modules/lms/media/video.service';
import { logger } from './shared/services/logger';
import { QUEUE_NAMES } from './shared/services/queue.producer';

async function main(): Promise<void> {
  const connection = createBullConnection();
  if (!connection) {
    logger.error('REDIS_URL is not set: without Redis, video jobs run inside the API process; no worker needed.');
    process.exit(1);
  }
  const { video, close } = createVideoService();

  const worker = new Worker<VideoJob>(QUEUE_NAMES.VIDEO_TRANSCODE, (job) => video.process(job.data), {
    connection,
    concurrency: 1, // ffmpeg uses every core already
  });
  worker.on('failed', (job, err) => logger.error('Video job failed', { id: job?.id, err: err.message }));
  worker.on('completed', (job) => logger.info('Video job done', { id: job.id, kind: job.data.kind }));
  logger.info('Video worker started', { appEnv: env.APP_ENV });

  const shutdown = async () => {
    await worker.close();
    await Promise.allSettled([close(), prisma.$disconnect(), connection.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.error('Worker failed to start', { err });
  process.exit(1);
});
