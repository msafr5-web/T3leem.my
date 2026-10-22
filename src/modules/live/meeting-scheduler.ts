import { logger } from '../../shared/services/logger';

export interface MeetingDetails {
  topic: string;
  startsAt: Date;
  durationMinutes: number;
}

export interface ScheduledMeeting {
  externalId: string;
  /** Participant link only. The host link (start_url) is never stored or exposed. */
  joinUrl: string;
}

export class MeetingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingProviderError';
  }
}

/** Port for live-meeting providers (Zoom today; Teams/Meet adapters can implement the same). */
export interface MeetingScheduler {
  readonly available: boolean;
  create(details: MeetingDetails): Promise<ScheduledMeeting>;
  update(externalId: string, details: MeetingDetails): Promise<void>;
  remove(externalId: string): Promise<void>;
}

/** Used when no provider credentials are configured: admins paste meeting links manually. */
export class ManualMeetingScheduler implements MeetingScheduler {
  readonly available = false;
  async create(): Promise<ScheduledMeeting> {
    throw new MeetingProviderError('No meeting provider is configured');
  }
  async update(): Promise<void> {}
  async remove(): Promise<void> {}
}

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

type FetchFn = typeof fetch;

const ZOOM_OAUTH = 'https://zoom.us/oauth/token';
const ZOOM_API = 'https://api.zoom.us/v2';

/**
 * Zoom Server-to-Server OAuth integration (SWET §6: POST /v2/users/me/meetings).
 *
 * The access token is cached until shortly before it expires, so a burst of scheduling calls
 * costs one OAuth round trip. Every call has a timeout so a slow Zoom never hangs a request.
 */
export class ZoomMeetingScheduler implements MeetingScheduler {
  readonly available = true;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: ZoomCredentials,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async create(details: MeetingDetails): Promise<ScheduledMeeting> {
    const res = await this.call('POST', '/users/me/meetings', this.meetingBody(details));
    const body = (await res.json()) as { id?: number | string; join_url?: string };
    if (!body.id || !body.join_url) throw new MeetingProviderError('Zoom returned an incomplete meeting');
    return { externalId: String(body.id), joinUrl: body.join_url };
  }

  async update(externalId: string, details: MeetingDetails): Promise<void> {
    await this.call('PATCH', `/meetings/${encodeURIComponent(externalId)}`, this.meetingBody(details));
  }

  async remove(externalId: string): Promise<void> {
    // 404 = already gone (deleted in Zoom directly): treat as success.
    await this.call('DELETE', `/meetings/${encodeURIComponent(externalId)}`, undefined, [404]);
  }

  private meetingBody({ topic, startsAt, durationMinutes }: MeetingDetails) {
    return {
      topic: topic.slice(0, 200),
      type: 2, // scheduled meeting
      start_time: startsAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      duration: durationMinutes,
      timezone: 'Asia/Riyadh',
      settings: {
        waiting_room: true,
        join_before_host: false,
        mute_upon_entry: true,
        auto_recording: 'cloud', // feeds the recording.completed -> HLS pipeline (SWET §6)
      },
    };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;

    const { accountId, clientId, clientSecret } = this.credentials;
    const res = await this.fetchImpl(`${ZOOM_OAUTH}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new MeetingProviderError(`Zoom OAuth failed (HTTP ${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new MeetingProviderError('Zoom OAuth returned no token');
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private async call(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<Response> {
    const res = await this.fetchImpl(`${ZOOM_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      logger.warn('Zoom API call failed', { method, path, status: res.status });
      throw new MeetingProviderError(`Zoom API ${method} ${path} failed (HTTP ${res.status})`);
    }
    return res;
  }
}
