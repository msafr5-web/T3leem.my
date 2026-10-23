'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

const TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];

/**
 * Uploads a lesson video with a progress bar. XHR (not fetch) because fetch can't report
 * upload progress. The file streams through the same-origin route handler to the API, which
 * verifies it's a real video and queues the encrypted-HLS transcode.
 */
export function VideoUpload({ slug, lessonId, maxMb }: { slug: string; lessonId: string; maxMb: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function upload(file: File) {
    setMessage(null);
    if (!TYPES.includes(file.type)) return setMessage({ kind: 'error', text: 'اختر ملف فيديو MP4 أو MOV أو WebM أو MKV.' });
    if (file.size > maxMb * 1024 * 1024) return setMessage({ kind: 'error', text: `الحد الأقصى لحجم الفيديو ${maxMb} ميجابايت.` });

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/${slug}/admin-upload/${lessonId}`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status === 202) {
        setMessage({ kind: 'ok', text: 'تم الرفع. جارٍ تجهيز الفيديو المحمي، وسيظهر للمتدربين عند اكتماله.' });
        router.refresh();
      } else {
        let text = 'تعذّر رفع الفيديو.';
        try {
          const body = JSON.parse(xhr.responseText) as { error?: { code?: string } | string };
          const code = typeof body.error === 'object' ? body.error?.code : undefined;
          if (code === 'UNSUPPORTED_VIDEO') text = 'الملف ليس فيديو صالحاً.';
          else if (code === 'VIDEO_TOO_LARGE' || xhr.status === 413) text = `حجم الفيديو أكبر من الحد المسموح (${maxMb} ميجابايت).`;
          else if (typeof body.error === 'string') text = body.error;
        } catch {
          /* keep default */
        }
        setMessage({ kind: 'error', text });
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setMessage({ kind: 'error', text: 'انقطع الاتصال أثناء الرفع.' });
    };
    xhr.send(file);
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(',')}
        aria-label="ملف الفيديو"
        disabled={progress !== null}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = '';
        }}
      />
      {progress !== null && (
        <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="تقدم الرفع">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {message && <p className={`notice ${message.kind === 'ok' ? 'ok' : 'error'} small`}>{message.text}</p>}
    </div>
  );
}
