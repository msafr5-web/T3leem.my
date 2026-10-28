'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatNumber } from '@/lib/format';
import { readYoutubeDuration, youtubeIdFromUrl } from '../../../youtube-api';

type Status = 'idle' | 'reading' | 'ok' | 'failed';

/**
 * The video-link input of the course form. As soon as a link is pasted, this browser asks
 * YouTube's player for the video's length and shows the total minutes; the length travels with
 * the form (manual_duration_seconds) and is only used when the server itself can't read it.
 * If it can't be read here either, the supervisor types the minutes.
 */
export function YoutubeUrlField({ label = 'رابط فيديو الدورة على YouTube' }: { label?: string }) {
  const [url, setUrl] = useState('');
  const [seconds, setSeconds] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const videoId = useMemo(() => youtubeIdFromUrl(url), [url]);

  useEffect(() => {
    setSeconds(null);
    if (!videoId) {
      setStatus('idle');
      return undefined;
    }
    setStatus('reading');
    let cancelled = false;
    // Debounce: the link arrives character by character when typed.
    const timer = setTimeout(async () => {
      const d = await readYoutubeDuration(videoId);
      if (cancelled) return;
      setSeconds(d);
      setStatus(d ? 'ok' : 'failed');
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [videoId]);

  const minutes = seconds ? Math.round(seconds / 60) : '';

  return (
    <>
      <label htmlFor="youtube_url" className="full">
        {label}
        <input
          id="youtube_url"
          name="youtube_url"
          type="url"
          dir="ltr"
          maxLength={500}
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <input type="hidden" name="manual_duration_seconds" value={seconds ?? ''} />
      {status === 'reading' && (
        <p className="full notice sandbox small" role="status">
          جارٍ قراءة مدة الفيديو من YouTube…
        </p>
      )}
      {status === 'ok' && seconds && (
        <p className="full notice ok small" role="status">
          مدة الفيديو الكلية: <strong>{formatNumber(minutes as number)} دقيقة</strong> ({formatNumber(Math.round((seconds / 3600) * 10) / 10)} ساعة). ستُقسَّم حسب الإعدادات أدناه.
        </p>
      )}
      {(status === 'ok' || status === 'failed') && (
        <label htmlFor="video_minutes">
          مدة الفيديو <span className="hint">{status === 'ok' ? '(دقائق، قُرئت تلقائياً ويمكنك تصحيحها)' : '(دقائق: تعذّرت قراءتها تلقائياً، أدخلها يدوياً)'}</span>
          <input
            id="video_minutes"
            type="number"
            min={1}
            max={720}
            value={minutes}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSeconds(Number.isFinite(n) && n >= 1 ? Math.round(n) * 60 : null);
            }}
          />
        </label>
      )}
    </>
  );
}
