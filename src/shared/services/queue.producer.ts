import { Queue, type ConnectionOptions } from 'bullmq';
import { logger } from './logger';

export const QUEUE_NAMES = {
  ZATCA_SYNC: 'zatca-sync-queue',
  CERT_GENERATION: 'cert-generation-queue',
  VIDEO_TRANSCODE: 'video-transcode-queue',
} as const;

export interface ZatcaSyncJob {
  tenantId: string;
  invoiceId: string;
}

/** What request-path code depends on; lets services be tested without Redis. */
export interface ZatcaQueue {
  enqueueZatcaSync(job: ZatcaSyncJob): Promise<void>;
}

/** Minimal shape shared with the video module (kept here to avoid a shared -> module import). */
export interface QueuedVideoJob {
  kind: string;
  tenantId: string;
}

/** Video transcode/import jobs on BullMQ — consumed by the separate worker process (src/worker.ts). */
export class BullVideoQueue<J extends QueuedVideoJob> {
  private readonly queue: Queue<J>;

  constructor(connection: ConnectionOptions) {
    this.queue = new Queue<J>(QUEUE_NAMES.VIDEO_TRANSCODE, { connection });
    this.queue.on('error', (err: Error & { code?: string }) => {
      if (err.code !== 'ECONNREFUSED' && err.name !== 'AggregateError') logger.warn('video queue error', { err: err.message });
    });
  }

  async enqueue(job: J): Promise<void> {
    // Transcoding is CPU-bound and long: few attempts, long backoff; results are idempotent per lesson.
    await this.queue.add(job.kind as never, job as never, { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 500, removeOnFail: false });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * No Redis (local dev): run video jobs in this process, after the HTTP response. One at a time,
 * so a burst of uploads can't run several ffmpeg processes and starve the API.
 */
export class InlineVideoQueue<J extends QueuedVideoJob> {
  private processor: ((job: J) => Promise<void>) | null = null;
  private chain: Promise<void> = Promise.resolve();

  setProcessor(fn: (job: J) => Promise<void>): void {
    this.processor = fn;
  }

  async enqueue(job: J): Promise<void> {
    const run = this.processor;
    if (!run) throw new Error('InlineVideoQueue has no processor');
    this.chain = this.chain.then(() =>
      run(job).catch((err: unknown) => {
        logger.error('Inline video job failed', { kind: job.kind, err: err instanceof Error ? err.message : err });
      }),
    );
  }

  /** For tests and graceful shutdown. */
  idle(): Promise<void> {
    return this.chain;
  }
}

/**
 * Used when REDIS_URL is not configured (local dev / staging trials). The invoice keeps its
 * PENDING_ZATCA status, so nothing is lost: the reconciliation sweep reports it later.
 */
export class DeferredZatcaQueue implements ZatcaQueue {
  async enqueueZatcaSync(job: ZatcaSyncJob): Promise<void> {
    logger.warn('Redis not configured; ZATCA sync deferred (invoice stays PENDING_ZATCA)', { invoiceId: job.invoiceId });
  }
}

/**
 * BullMQ producer. Heavy or slow work (XML signing + ZATCA reporting, PDF certificates,
 * HLS transcoding) is pushed here so the Express event loop never blocks on it.
 */
export class QueueProducer implements ZatcaQueue {
  private readonly zatcaSync: Queue<ZatcaSyncJob>;

  constructor(
    connection: ConnectionOptions,
    private readonly enqueueTimeoutMs = 5_000,
  ) {
    this.zatcaSync = new Queue<ZatcaSyncJob>(QUEUE_NAMES.ZATCA_SYNC, { connection });
    // A listener is mandatory (an unhandled 'error' event would crash the process), but the
    // connection itself already logs outages — so only surface errors that aren't reconnect noise.
    this.zatcaSync.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'ECONNREFUSED' || err.name === 'AggregateError') return;
      logger.warn('zatca-sync queue error', { err: err.message || err.code });
    });
  }

  async enqueueZatcaSync(job: ZatcaSyncJob): Promise<void> {
    const add = this.zatcaSync.add('report-invoice', job, {
      // jobId = invoiceId makes enqueueing idempotent: a retry never reports the same invoice twice.
      jobId: job.invoiceId,
      attempts: 8,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1_000,
      removeOnFail: false,
    });
    // BullMQ connections queue commands while Redis is unreachable, so `add` would wait
    // forever and hang the HTTP request. Bound it; the caller treats a timeout as
    // "leave the invoice PENDING_ZATCA for the reconciliation sweep".
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`enqueue timed out after ${this.enqueueTimeoutMs}ms`)), this.enqueueTimeoutMs);
    });
    try {
      await Promise.race([add, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await this.zatcaSync.close();
  }
}
