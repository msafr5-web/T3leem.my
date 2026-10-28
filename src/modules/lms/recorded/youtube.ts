import { logger } from '../../../shared/services/logger';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/**
 * Extracts the 11-character video id from any common YouTube link form (watch, youtu.be,
 * embed, shorts, live) — parsed with URL against a host allow-list, never a loose regex, so
 * "evil.com/watch?v=…" or "youtube.com.evil.com" are rejected.
 */
export function parseYoutubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (VIDEO_ID_RE.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  let id: string | null | undefined = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = url.pathname.split('/');
    id = first === 'watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(first ?? '') ? second : null;
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

export const youtubeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/** ISO-8601 duration from the Data API ("PT1H2M5S") → seconds. */
export function parseIsoDuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  const total = (d ?? 0) * 86400 + (h ?? 0) * 3600 + (min ?? 0) * 60 + (s ?? 0);
  return total > 0 ? total : null;
}

export interface YoutubeVideoInfo {
  videoId: string;
  title: string;
  channel: string;
  /** null when it couldn't be determined; the admin then enters it manually. */
  durationSeconds: number | null;
}

export type YoutubeLookup =
  | { kind: 'ok'; info: YoutubeVideoInfo }
  | { kind: 'not_found' }
  | { kind: 'not_embeddable' }
  | { kind: 'unavailable' };

export interface YoutubeMetadataSource {
  lookup(videoId: string): Promise<YoutubeLookup>;
}

type Fetch = typeof fetch;

/**
 * Video title/channel/duration. With YOUTUBE_API_KEY it uses the official Data API v3; without
 * one it falls back to oEmbed (title, existence, embeddability) + the public watch page's
 * lengthSeconds. The fallback is best-effort — if YouTube changes its page, duration comes back
 * null and the dashboard asks for it instead of failing.
 */
export class YoutubeMetadataClient implements YoutubeMetadataSource {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: Fetch = fetch,
    private readonly timeoutMs = 8000,
  ) {}

  async lookup(videoId: string): Promise<YoutubeLookup> {
    if (!VIDEO_ID_RE.test(videoId)) return { kind: 'not_found' };
    try {
      return this.apiKey ? await this.viaDataApi(videoId, this.apiKey) : await this.viaOembed(videoId);
    } catch (err) {
      logger.warn('YouTube metadata lookup failed', { videoId, error: err instanceof Error ? err.message : String(err) });
      return { kind: 'unavailable' };
    }
  }

  private get = (url: string) => this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { 'Accept-Language': 'ar,en;q=0.8' } });

  private async viaDataApi(videoId: string, key: string): Promise<YoutubeLookup> {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${encodeURIComponent(key)}`;
    const res = await this.get(url);
    if (!res.ok) return { kind: 'unavailable' };
    const body = (await res.json()) as {
      items?: { snippet?: { title?: string; channelTitle?: string }; contentDetails?: { duration?: string }; status?: { embeddable?: boolean; privacyStatus?: string } }[];
    };
    const item = body.items?.[0];
    if (!item || item.status?.privacyStatus === 'private') return { kind: 'not_found' };
    if (item.status?.embeddable === false) return { kind: 'not_embeddable' };
    return {
      kind: 'ok',
      info: {
        videoId,
        title: item.snippet?.title ?? '',
        channel: item.snippet?.channelTitle ?? '',
        durationSeconds: item.contentDetails?.duration ? parseIsoDuration(item.contentDetails.duration) : null,
      },
    };
  }

  private async viaOembed(videoId: string): Promise<YoutubeLookup> {
    const res = await this.get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(videoId))}`);
    // oEmbed: 401/403 = embedding disabled by the owner; 400/404 = no such (or private) video.
    if (res.status === 401 || res.status === 403) return { kind: 'not_embeddable' };
    if (res.status === 400 || res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'unavailable' };
    const meta = (await res.json()) as { title?: string; author_name?: string };
    return { kind: 'ok', info: { videoId, title: meta.title ?? '', channel: meta.author_name ?? '', durationSeconds: await this.scrapeDuration(videoId) } };
  }

  private async scrapeDuration(videoId: string): Promise<number | null> {
    try {
      const res = await this.get(youtubeWatchUrl(videoId));
      if (!res.ok) return null;
      const m = /"lengthSeconds":"(\d+)"/.exec(await res.text());
      const seconds = m ? Number(m[1]) : NaN;
      return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
    } catch {
      return null;
    }
  }
}
