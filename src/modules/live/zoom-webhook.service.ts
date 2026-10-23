import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../../shared/services/logger';
import { HttpError } from '../../shared/utils/http-error';

export interface ParticipantJoined {
  key: string;
  name: string;
  email: string | null;
  joinedAt: Date;
}

export interface ZoomWebhookRepository {
  /** meeting_registry lookup (not under RLS: the webhook has no tenant). */
  findMeeting(externalMeetingId: string): Promise<{ tenantId: string; classroomId: string } | null>;
  recordAttendance(tenantId: string, classroomId: string, participant: ParticipantJoined): Promise<void>;
}

export interface RecordingImportJob {
  kind: 'import-recording';
  tenantId: string;
  classroomId: string;
  downloadUrl: string;
  downloadToken: string | null;
  topic: string;
}

export interface ZoomWebhookDeps {
  secretToken: string | undefined;
  repository: ZoomWebhookRepository;
  enqueueRecording: (job: RecordingImportJob) => Promise<void>;
  now?: () => number;
}

const MAX_SKEW_SECONDS = 300;

interface ZoomEvent {
  event?: string;
  download_token?: string;
  payload?: {
    plainToken?: string;
    object?: {
      id?: number | string;
      topic?: string;
      participant?: { user_name?: string; email?: string; participant_user_id?: string; user_id?: string; id?: string; join_time?: string };
      recording_files?: { file_type?: string; status?: string; download_url?: string; recording_type?: string }[];
    };
  };
}

/**
 * Zoom webhooks (SWET §6): participant_joined -> attendance, recording.completed -> protected
 * HLS lesson. Every request is authenticated with Zoom's HMAC-SHA256 signature over
 * "v0:{timestamp}:{raw body}" and rejected if older than 5 minutes (replay protection).
 */
export class ZoomWebhookService {
  private readonly now: () => number;

  constructor(private readonly deps: ZoomWebhookDeps) {
    this.now = deps.now ?? Date.now;
  }

  verifySignature(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined): void {
    const secret = this.deps.secretToken;
    if (!secret) throw new HttpError(503, 'WEBHOOK_NOT_CONFIGURED', 'Zoom webhooks are not configured');
    if (!timestamp || !signature) throw HttpError.unauthorized('Missing Zoom signature');
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(this.now() / 1000 - ts) > MAX_SKEW_SECONDS) throw HttpError.unauthorized('Stale Zoom webhook');

    const expected = Buffer.from(`v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody.toString('utf8')}`).digest('hex')}`);
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw HttpError.unauthorized('Invalid Zoom signature');
  }

  /** Returns the JSON body to send back (only url_validation needs one). */
  async handle(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined): Promise<Record<string, string>> {
    let event: ZoomEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as ZoomEvent;
    } catch {
      throw HttpError.badRequest('INVALID_JSON', 'Webhook body is not JSON');
    }

    // Zoom's endpoint ownership check: echo the token and its HMAC with our secret.
    if (event.event === 'endpoint.url_validation') {
      const secret = this.deps.secretToken;
      if (!secret) throw new HttpError(503, 'WEBHOOK_NOT_CONFIGURED', 'Zoom webhooks are not configured');
      const plainToken = event.payload?.plainToken ?? '';
      return { plainToken, encryptedToken: createHmac('sha256', secret).update(plainToken).digest('hex') };
    }

    this.verifySignature(rawBody, timestamp, signature);
    const meetingId = event.payload?.object?.id;
    if (meetingId === undefined) return {};
    const meeting = await this.deps.repository.findMeeting(String(meetingId));
    if (!meeting) {
      logger.info('Zoom webhook for an unknown meeting ignored', { event: event.event });
      return {};
    }

    if (event.event === 'meeting.participant_joined') {
      const p = event.payload?.object?.participant ?? {};
      const email = p.email?.trim().toLowerCase() || null;
      const key = email ?? p.participant_user_id ?? p.user_id ?? p.id;
      if (!key) return {};
      await this.deps.repository.recordAttendance(meeting.tenantId, meeting.classroomId, {
        key,
        name: (p.user_name ?? 'مشارك').slice(0, 120),
        email,
        joinedAt: p.join_time ? new Date(p.join_time) : new Date(this.now()),
      });
    }

    if (event.event === 'recording.completed') {
      const mp4 = event.payload?.object?.recording_files?.find((f) => f.file_type === 'MP4' && f.status !== 'processing' && f.download_url);
      if (mp4?.download_url) {
        await this.deps.enqueueRecording({
          kind: 'import-recording',
          tenantId: meeting.tenantId,
          classroomId: meeting.classroomId,
          downloadUrl: mp4.download_url,
          downloadToken: event.download_token ?? null,
          topic: event.payload?.object?.topic ?? '',
        });
      }
    }
    return {};
  }
}
