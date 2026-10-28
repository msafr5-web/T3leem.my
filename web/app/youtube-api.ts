/**
 * Browser-only helpers for the YouTube IFrame Player API, shared by the learner's segment
 * player and the dashboard's video-duration probe. Import from client components only.
 */

// Minimal typings for the parts of the IFrame API we use.
export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

export interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void; onError?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the IFrame API once per page, however many players mount. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        apiPromise = null;
        reject(new Error('YouTube API failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/**
 * The 11-character video id of a YouTube link (watch, youtu.be, embed, shorts, live), or null.
 * Convenience for the UI only: the API re-validates every link on the server.
 */
export function youtubeIdFromUrl(input: string): string | null {
  const raw = input.trim();
  if (VIDEO_ID_RE.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
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

/**
 * The video's length in whole seconds as reported by YouTube's own player in this browser, or
 * null (private/blocked video, live stream, offline, timeout). Used because YouTube refuses to
 * show video pages to our server's datacenter address, but serves the signed-in-or-not browser
 * of the person creating the course just fine. A hidden, never-played player is enough.
 */
export async function readYoutubeDuration(videoId: string, timeoutMs = 15000): Promise<number | null> {
  let YT: YTNamespace;
  try {
    YT = await loadYouTubeApi();
  } catch {
    return null;
  }
  return new Promise<number | null>((resolve) => {
    // Off-screen but rendered: a display:none iframe may never load its metadata.
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:113px;overflow:hidden;pointer-events:none';
    const mount = document.createElement('div');
    holder.appendChild(mount);
    document.body.appendChild(holder);

    let player: YTPlayer | null = null;
    let finished = false;
    const finish = (seconds: number | null) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(timer);
      try {
        player?.destroy();
      } catch {
        /* the player may already be gone */
      }
      holder.remove();
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    // getDuration() is 0 until the metadata arrives; ask until it isn't.
    const poll = setInterval(() => {
      const d = typeof player?.getDuration === 'function' ? player.getDuration() : 0;
      if (d > 0) finish(Math.round(d));
    }, 300);

    player = new YT.Player(mount, {
      host: 'https://www.youtube-nocookie.com',
      videoId,
      width: '200',
      height: '113',
      playerVars: { controls: 0, playsinline: 1, rel: 0 },
      events: { onError: () => finish(null) },
    });
  });
}
