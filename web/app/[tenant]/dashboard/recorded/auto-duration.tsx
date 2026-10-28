'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readYoutubeDuration, youtubeIdFromUrl } from '../../../youtube-api';

/**
 * Shown when the server couldn't read a video's length (YouTube refuses to serve video pages
 * to datacenter addresses). Reads it from YouTube's player in this browser instead and reloads
 * the preview with it (?ms=<seconds>), so the supervisor never has to type it.
 */
export function AutoDuration({ videoUrl }: { videoUrl: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const id = youtubeIdFromUrl(videoUrl);
    if (!id) {
      setFailed(true);
      return undefined;
    }
    let cancelled = false;
    readYoutubeDuration(id).then((seconds) => {
      if (cancelled) return;
      if (!seconds) {
        setFailed(true);
        return;
      }
      const next = new URL(window.location.href);
      next.searchParams.set('ms', String(seconds));
      router.replace(`${next.pathname}${next.search}`);
    });
    return () => {
      cancelled = true;
    };
  }, [videoUrl, router]);

  return failed ? (
    <p className="notice error" role="alert">
      تعذّرت قراءة مدة الفيديو تلقائياً. أدخلها بالدقائق في خانة «مدة الفيديو» ثم اعرض الجدولة مجدداً.
    </p>
  ) : (
    <p className="notice sandbox" role="status">
      جارٍ قراءة مدة الفيديو من YouTube عبر متصفحك…
    </p>
  );
}
