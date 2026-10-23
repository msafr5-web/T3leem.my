'use client';

import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';

/**
 * Plays AES-128 encrypted HLS. hls.js fetches the key and segments using the signed URLs
 * inside the playlist; Safari plays HLS natively. There is no downloadable file anywhere —
 * the browser only ever sees encrypted segments plus a short-lived, per-learner key URL.
 */
export function HlsPlayer({ src, title }: { src: string; title: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    setError(null);

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError('تعذّر تشغيل الفيديو. حدّث الصفحة للحصول على رابط تشغيل جديد.');
      });
      hls.loadSource(src);
      hls.attachMedia(el);
      return () => hls.destroy();
    }
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src; // Safari: native HLS (handles AES-128 too)
      return undefined;
    }
    setError('متصفحك لا يدعم تشغيل هذا الفيديو.');
    return undefined;
  }, [src]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <video
        ref={video}
        controls
        playsInline
        // No download button / picture-in-picture export / remote playback casting of the stream.
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        aria-label={title}
        style={{ width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 10 }}
      />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
