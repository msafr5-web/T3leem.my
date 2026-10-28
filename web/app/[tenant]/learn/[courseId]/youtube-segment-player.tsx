'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { formatTimestamp } from '@/lib/format';

// Minimal typings for the parts of the YouTube IFrame API we use.
interface YTPlayer {
  getCurrentTime(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface YTNamespace {
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
function loadYouTubeApi(): Promise<YTNamespace> {
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

const storageKey = (lessonId: string) => `t3leem:yt:${lessonId}`;
const readResume = (lessonId: string): number => {
  try {
    return Number(window.localStorage.getItem(storageKey(lessonId))) || 0;
  } catch {
    return 0;
  }
};
const writeResume = (lessonId: string, seconds: number) => {
  try {
    window.localStorage.setItem(storageKey(lessonId), String(Math.floor(seconds)));
  } catch {
    /* private mode / blocked storage: resume is a convenience only */
  }
};

/** A lecture counts as watched at 90 % (allows for the last seconds being skipped by the end marker). */
const COMPLETE_RATIO = 0.9;
/** Seeking more than this past the furthest point watched is treated as skipping. */
const SKIP_TOLERANCE = 3;

type Phase = 'video' | 'break' | 'discussion' | 'finished';

export interface YoutubeSegmentPlayerProps {
  lessonId: string;
  videoId: string;
  title: string;
  start: number;
  end: number;
  completed: boolean;
  autoplay: boolean;
  breakMinutes: number;
  discussionMinutes: number;
  /** The next lecture: same day → break first; next day → discussion first. */
  next: { href: string; sameDay: boolean } | null;
  onComplete: () => Promise<void>;
}

/**
 * Plays one lecture: a time range [start, end) of the course's YouTube video, through
 * youtube-nocookie (no tracking cookies until the learner presses play — PDPL-friendly).
 * Sequence: lecture → break countdown (skippable) → next lecture, or → the day's discussion.
 * Unwatched parts can't be skipped until the lecture is complete, so "watched" means watched.
 */
export function YoutubeSegmentPlayer(props: YoutubeSegmentPlayerProps) {
  const { lessonId, videoId, title, start, end, completed, autoplay, breakMinutes, discussionMinutes, next, onComplete } = props;
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const furthest = useRef(start);
  const phaseRef = useRef<Phase>('video');
  const completedRef = useRef(completed);
  const [phase, setPhase] = useState<Phase>('video');
  const [watched, setWatched] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(breakMinutes * 60);
  const [, startTransition] = useTransition();
  const length = Math.max(1, end - start);

  completedRef.current = completed;

  const finish = useCallback(() => {
    if (phaseRef.current !== 'video') return;
    player.current?.pauseVideo();
    const ratio = (furthest.current - start) / length;
    if (!completedRef.current && ratio >= COMPLETE_RATIO) {
      completedRef.current = true;
      startTransition(async () => {
        await onComplete();
        router.refresh();
      });
    }
    const nextPhase: Phase = next?.sameDay ? (breakMinutes > 0 ? 'break' : 'finished') : 'discussion';
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
    if (nextPhase === 'finished' && next) router.push(`${next.href}&autoplay=1`);
  }, [start, length, onComplete, router, next, breakMinutes]);
  // The poll loop and player events outlive renders: always call the latest finish().
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Player lifecycle + the watch-progress loop.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const resume = readResume(lessonId);
    furthest.current = completed ? end : Math.min(Math.max(start, resume), end);
    setWatched(Math.round(((furthest.current - start) / length) * 100));

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host.current) return;
        const mount = document.createElement('div');
        host.current.replaceChildren(mount);
        player.current = new YT.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { start, end, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, hl: 'ar', autoplay: autoplay ? 1 : 0 },
          events: {
            onReady: () => {
              // Pick up where the learner left off (unless they were at the very start or end).
              if (!completed && resume > start + 5 && resume < end - 5) player.current?.seekTo(resume, true);
            },
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.ENDED) finishRef.current();
            },
            onError: () => setError('تعذّر تشغيل الفيديو من YouTube. حدّث الصفحة أو حاول لاحقاً.'),
          },
        });

        timer = setInterval(() => {
          const p = player.current;
          if (!p || phaseRef.current !== 'video' || typeof p.getCurrentTime !== 'function') return;
          const t = p.getCurrentTime();
          if (t < start - 1) {
            p.seekTo(start, true);
            return;
          }
          if (!completedRef.current && t > furthest.current + SKIP_TOLERANCE) {
            p.seekTo(furthest.current, true);
            setNotice('لا يمكن تخطي أجزاء لم تشاهدها بعد. يمكنك الرجوع لأي جزء شاهدته.');
            return;
          }
          if (t > furthest.current) {
            furthest.current = Math.min(t, end);
            writeResume(lessonId, furthest.current);
            setWatched(Math.round(((furthest.current - start) / length) * 100));
          }
          // Fallback for the end marker (ENDED doesn't always fire exactly at `end`).
          if (t >= end - 0.3) finishRef.current();
        }, 500);
      })
      .catch(() => setError('تعذّر تحميل مشغل YouTube. تحقق من اتصالك ثم حدّث الصفحة.'));

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      player.current?.destroy();
      player.current = null;
    };
    // The player is rebuilt only when the lecture itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, videoId, start, end]);

  // Break countdown → next lecture.
  useEffect(() => {
    if (phase !== 'break' || !next) return;
    setSecondsLeft(breakMinutes * 60);
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          router.push(`${next.href}&autoplay=1`);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, next, breakMinutes, router]);

  const replay = () => {
    phaseRef.current = 'video';
    setPhase('video');
    player.current?.seekTo(start, true);
    player.current?.playVideo();
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="yt-stage" hidden={phase !== 'video'}>
        <div ref={host} className="yt-frame" aria-label={title} />
      </div>

      {phase === 'video' && (
        <div className="segment-meta">
          <div className="progress" role="progressbar" aria-valuenow={watched} aria-valuemin={0} aria-valuemax={100} aria-label="ما شاهدته من هذا الجزء">
            <span style={{ width: `${Math.min(100, watched)}%` }} />
          </div>
          <span className="small muted">
            <span className="ltr">
              {formatTimestamp(start)} – {formatTimestamp(end)}
            </span>{' '}
            · شاهدت {watched}٪{completed ? ' · مكتمل' : ''}
          </span>
        </div>
      )}
      {phase === 'video' && notice && (
        <p className="notice sandbox small" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {phase === 'break' && next && (
        <section className="card break-card" aria-live="polite">
          <h3>استراحة قصيرة</h3>
          <p className="muted">خذ نفساً وحرّك جسمك قليلاً. الجزء التالي يبدأ تلقائياً بعد:</p>
          <div className="countdown ltr" role="timer">
            {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}
          </div>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <Link href={`${next.href}&autoplay=1`} className="btn btn-primary">
              تخطي الاستراحة وابدأ الجزء التالي
            </Link>
            <button type="button" className="btn btn-ghost" onClick={replay}>
              إعادة مشاهدة هذا الجزء
            </button>
          </div>
        </section>
      )}

      {phase === 'discussion' && (
        <section className="card break-card" aria-live="polite">
          <h3>انتهى محتوى اليوم. حان وقت النقاش</h3>
          <p className="muted">
            خصص نحو {discussionMinutes} دقيقة لمراجعة ما تعلمته: اطرح سؤالك أو شارك فكرة في نقاش اليوم، وسيرد عليك المدرب.
          </p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <a href="#discussion" className="btn btn-primary">
              الانتقال إلى نقاش اليوم
            </a>
            {next && (
              <Link href={next.href} className="btn btn-ghost">
                اليوم التالي ←
              </Link>
            )}
            <button type="button" className="btn btn-ghost" onClick={replay}>
              إعادة مشاهدة هذا الجزء
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
