'use client';

import { useActionState, useEffect, useState } from 'react';
import type { RecordedBatchState } from '@/lib/admin-actions';
import type { AdminTrainer } from '@/lib/api';

type Action = (prev: RecordedBatchState, form: FormData) => Promise<RecordedBatchState>;

const REASON: Record<string, string> = {
  INVALID_YOUTUBE_URL: 'ليس رابط فيديو YouTube صحيحاً.',
  YOUTUBE_VIDEO_NOT_FOUND: 'الفيديو غير موجود أو خاص.',
  YOUTUBE_NOT_EMBEDDABLE: 'صاحب الفيديو منع تشغيله خارج YouTube.',
  YOUTUBE_DURATION_UNKNOWN: 'تعذّر قراءة مدة الفيديو. أنشئ هذه الدورة من شاشة «دورة مسجلة» وأدخل المدة يدوياً.',
  TOO_MANY_DAYS: 'الفيديو قصير جداً للجدولة الافتراضية.',
  VIDEO_TOO_LONG: 'الفيديو أطول من ١٢ ساعة (غير مدعوم).',
  TITLE_REQUIRED: 'عنوان الدورة قصير جداً. اكتب عنواناً بعد الرابط (رابط | العنوان).',
  DUPLICATE_IN_BATCH: 'الرابط مكرر في القائمة.',
  UNEXPECTED: 'حدث خطأ غير متوقع في هذا السطر. أعد المحاولة.',
};

/**
 * Adds several recorded courses to the plan in one go: pick the trainer once, paste one YouTube link per line (optionally
 * "link | title"). Each good line becomes a recorded course added to the plan; a bad line fails alone and stays in the box so
 * it can be fixed and sent again.
 */
export function BatchRecordedForm({ action, trainers }: { action: Action; trainers: AdminTrainer[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState('');
  const outcome = state.outcome;

  // After a batch, keep only the lines that failed (the created ones are done) so the admin fixes just those.
  useEffect(() => {
    if (!outcome) return;
    const failed = new Set(outcome.results.filter((r) => r.status === 'error').map((r) => r.youtube_url));
    setLines((cur) =>
      cur
        .split(/\r?\n/)
        .filter((l) => l.trim() && failed.has(l.split('|')[0]?.trim() ?? ''))
        .join('\n'),
    );
  }, [outcome]);

  if (trainers.length === 0) return <p className="small muted">أضف مدرباً أولاً من صفحة «المدربون» ثم ارجع هنا.</p>;

  return (
    <form action={formAction} className="form">
      <div className="form-grid">
        <label htmlFor="batch-trainer">
          المدرب
          <select id="batch-trainer" name="trainer_id" required defaultValue="">
            <option value="" disabled>
              اختر المدرب
            </option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="batch-price">
          سعر كل دورة (ريال، قبل الضريبة) <span className="hint">٠ = مجانية</span>
          <input id="batch-price" name="price" type="number" min={0} max={1000000} step="0.01" defaultValue={0} dir="ltr" />
        </label>
        <label className="check full" htmlFor="batch-published">
          <input id="batch-published" name="is_published" type="checkbox" />
          نشر الدورات للمتدربين فور إنشائها (وإلا تبقى مسودات)
        </label>
        <label htmlFor="batch-lines" className="full">
          روابط YouTube <span className="hint">(رابط في كل سطر، حتى ٢٠. اختيارياً: ‎رابط | عنوان الدورة‎ وإلا يُؤخذ عنوان الفيديو)</span>
          <textarea
            id="batch-lines"
            name="lines"
            rows={6}
            dir="ltr"
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            placeholder={'https://youtu.be/xxxxxxxxxxx | الحلقة الأولى\nhttps://youtu.be/yyyyyyyyyyy | الحلقة الثانية'}
            required
          />
        </label>
      </div>

      {outcome && (
        <div className={`notice ${outcome.failed > 0 ? 'error' : 'ok'}`} role={outcome.failed > 0 ? 'alert' : 'status'}>
          <strong>
            أُنشئت {outcome.created} دورة
            {outcome.created > 0 ? (outcome.plan_linked ? ' وأُضيفت إلى الخطة' : ' لكن تعذّرت إضافتها إلى الخطة (أضفها من القائمة أعلاه)') : ''}
            {outcome.failed > 0 ? `، وتعذّر ${outcome.failed}. أبقيتُ الأسطر الفاشلة في الصندوق لتصحيحها.` : '.'}
          </strong>
          <ul className="quiz-errors small">
            {outcome.results.map((r, i) => (
              <li key={i}>
                {r.status === 'created' ? (
                  <>✓ {r.title} — {r.days} {r.days === 1 ? 'يوم' : 'أيام'}</>
                ) : (
                  <>
                    ✗ <span className="ltr">{r.youtube_url}</span>: {REASON[r.code ?? ''] ?? 'تعذّر إنشاء الدورة.'}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'جارٍ إنشاء الدورات…' : 'إنشاء الدورات وإضافتها للخطة'}
        </button>
      </div>
    </form>
  );
}
