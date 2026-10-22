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
