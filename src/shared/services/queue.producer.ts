import { Queue, type ConnectionOptions } from 'bullmq';

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

  constructor(connection: ConnectionOptions) {
    this.zatcaSync = new Queue<ZatcaSyncJob>(QUEUE_NAMES.ZATCA_SYNC, { connection });
  }

  async enqueueZatcaSync(job: ZatcaSyncJob): Promise<void> {
    await this.zatcaSync.add('report-invoice', job, {
      // jobId = invoiceId makes enqueueing idempotent: a retry never reports the same invoice twice.
      jobId: job.invoiceId,
      attempts: 8,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1_000,
      removeOnFail: false,
    });
  }

  async close(): Promise<void> {
    await this.zatcaSync.close();
  }
}
