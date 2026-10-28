import Link from 'next/link';
import { ApiError, ApiUnavailableError, admin, type SchedulePreview } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createRecordedCourseAction } from '@/lib/admin-actions';
import { formatMinutes, formatNumber } from '@/lib/format';
import { AdminForm } from '../../admin-form';
import { ScheduleTimeline } from '../schedule-timeline';

type Search = {
  url?: string;
  days?: string;
  mode?: string;
  max?: string;
  min?: string;
  pause?: string;
  talk?: string;
  manual?: string;
};

const PREVIEW_ERRORS: Record<string, string> = {
  INVALID_YOUTUBE_URL: 'الرابط ليس رابط فيديو YouTube صحيحاً.',
  YOUTUBE_VIDEO_NOT_FOUND: 'الفيديو غير موجود أو خاص. استخدم فيديو عاماً أو غير مدرج.',
  YOUTUBE_NOT_EMBEDDABLE: 'صاحب الفيديو منع تشغيله خارج YouTube، فلا يمكن بناء دورة عليه.',
  YOUTUBE_DURATION_UNKNOWN: 'تعذّر قراءة مدة الفيديو من YouTube. أدخل المدة بالدقائق في خانة «مدة الفيديو» ثم اعرض الجدولة مجدداً.',
  TOO_MANY_DAYS: 'عدد الأيام أكبر من المناسب: كل يوم يحتاج جزءاً واحداً على الأقل و٥ دقائق فيديو. قلّل الأيام أو طول الجزء.',
  VIDEO_TOO_LONG: 'الفيديوهات الأطول من ١٢ ساعة غير مدعومة.',
  VALIDATION_FAILED: 'تحقق من قيم الإعدادات (الأرقام خارج النطاق المسموح).',
};

const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export default async function NewRecordedCourse({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<Search> }) {
  const [{ tenant: slug }, q] = await Promise.all([params, searchParams]);
  const token = await requireAdmin(slug);
  const trainers = await admin.trainers(slug, token);

  // Settings default to the owner-approved schedule: 10–15 min lectures, 5 min breaks, 15 min discussion.
  const settings = {
    days: num(q.days),
    // Supervisor's choice: a break every N minutes (fixed), or equal parts within a range (balanced).
    mode: q.mode === 'balanced' ? 'balanced' : 'fixed',
    max: num(q.max) ?? 15,
    min: num(q.min) ?? 10,
    pause: num(q.pause) ?? 5,
    talk: num(q.talk) ?? 15,
    manual: num(q.manual),
  };

  let preview: SchedulePreview | null = null;
  let error: string | null = null;
  if (q.url) {
    const body: Record<string, string | number> = {
      youtube_url: q.url,
      split_mode: settings.mode,
      max_lecture_minutes: settings.max,
      min_lecture_minutes: settings.min,
      break_minutes: settings.pause,
      discussion_minutes: settings.talk,
    };
    if (settings.days) body.days = settings.days;
    if (settings.manual) body.manual_duration_seconds = settings.manual * 60;
    try {
      preview = await admin.recordedPreview(slug, token, body);
    } catch (err) {
      if (err instanceof ApiError) error = PREVIEW_ERRORS[err.code] ?? 'تعذّر تحليل الفيديو. حاول مرة أخرى.';
      else if (err instanceof ApiUnavailableError) error = 'تعذّر الاتصال بالخادم. حاول بعد قليل.';
      else throw err;
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>دورة مسجلة جديدة</h1>
          <p className="muted small">الخطوة ١: الصق رابط الفيديو واضبط الجدولة. الخطوة ٢: راجع الأيام والأجزاء ثم أنشئ الدورة.</p>
        </div>
        <Link href={`/${slug}/dashboard/recorded`} className="btn btn-ghost">
          رجوع
        </Link>
      </div>

      <section className="card stack" aria-labelledby="step1">
        <h2 id="step1" style={{ fontSize: 18 }}>
          ١. الفيديو والجدولة
        </h2>
        <form method="get" className="form">
          <div className="form-grid">
            <label htmlFor="url" className="full">
              رابط فيديو YouTube
              <input id="url" name="url" type="url" dir="ltr" required defaultValue={q.url ?? ''} placeholder="https://www.youtube.com/watch?v=…" />
            </label>
            <label htmlFor="mode">
              طريقة التقسيم
              <select id="mode" name="mode" defaultValue={settings.mode}>
                <option value="fixed">ثابتة: استراحة كل «طول الجزء» بالضبط</option>
                <option value="balanced">متوازنة: أجزاء متساوية بين الحد الأدنى والأقصى</option>
              </select>
            </label>
            <label htmlFor="max">
              طول الجزء <span className="hint">(دقائق، مثل ٢٥ أو ٣٠. في المتوازنة: الحد الأقصى)</span>
              <input id="max" name="max" type="number" min={3} max={60} required defaultValue={settings.max} />
            </label>
            <label htmlFor="min">
              أدنى طول للجزء <span className="hint">(للطريقة المتوازنة فقط)</span>
              <input id="min" name="min" type="number" min={3} max={60} defaultValue={settings.min} />
            </label>
            <label htmlFor="pause">
              الاستراحة بين الأجزاء <span className="hint">(دقائق)</span>
              <input id="pause" name="pause" type="number" min={0} max={30} defaultValue={settings.pause} />
            </label>
            <label htmlFor="talk">
              النقاش في نهاية اليوم <span className="hint">(دقائق)</span>
              <input id="talk" name="talk" type="number" min={0} max={60} defaultValue={settings.talk} />
            </label>
            <label htmlFor="days">
              عدد الأيام <span className="hint">(اتركه فارغاً للحساب التلقائي: ساعة فيديو يومياً)</span>
              <input id="days" name="days" type="number" min={1} max={60} defaultValue={settings.days ?? ''} />
            </label>
            <label htmlFor="manual">
              مدة الفيديو <span className="hint">(دقائق، فقط إن تعذّر قراءتها تلقائياً)</span>
              <input id="manual" name="manual" type="number" min={1} max={720} defaultValue={settings.manual ?? ''} />
            </label>
          </div>
          <div>
            <button type="submit" className="btn btn-primary">
              {preview ? 'تحديث الجدولة' : 'تحليل الفيديو وعرض الجدولة'}
            </button>
          </div>
        </form>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </section>

      {preview && (
        <>
          <section className="card stack" aria-labelledby="step2">
            <h2 id="step2" style={{ fontSize: 18 }}>
              ٢. الجدولة المقترحة
            </h2>
            <div className="yt-summary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${preview.video.id}/mqdefault.jpg`} alt="" width={160} height={90} loading="lazy" />
              <div className="stack" style={{ gap: 4 }}>
                <strong>{preview.video.title || 'فيديو YouTube'}</strong>
                <span className="small muted">
                  {preview.video.channel && <>القناة: {preview.video.channel} · </>}
                  المدة: {formatMinutes(preview.video.duration_seconds)}
                  {preview.video.duration_source === 'manual' && ' (أُدخلت يدوياً)'}
                </span>
              </div>
            </div>
            <div className="stats">
              <div>
                <strong>{formatNumber(Math.round(preview.video.duration_seconds / 60))}</strong>
                <span>دقيقة إجمالي مدة الفيديو</span>
              </div>
              <div>
                <strong>{formatNumber(preview.plan.days.length)}</strong>
                <span>{preview.plan.days.length === 1 ? 'يوم تدريبي' : 'أيام تدريبية'}</span>
              </div>
              <div>
                <strong>{formatNumber(preview.plan.lecture_count)}</strong>
                <span>جزءاً مرئياً</span>
              </div>
              <div>
                <strong>{formatNumber(preview.plan.training_hours)}</strong>
                <span>ساعة تدريبية (فيديو + نقاش)</span>
              </div>
            </div>
            <ScheduleTimeline
              days={preview.plan.days.map((d) => ({ key: String(d.day), title: preview.plan.days.length > 1 ? `اليوم ${d.day}` : 'اليوم 1', lectures: d.lectures }))}
              breakMinutes={preview.config.break_minutes}
              discussionMinutes={preview.config.discussion_minutes}
            />
            <p className="small muted">
              {preview.config.split_mode === 'fixed' ? `استراحة كل ${preview.config.max_lecture_minutes} دقيقة، والجزء الأخير يأخذ ما تبقى (ما يقل عن ٥ دقائق يُضم للجزء السابق).` : 'الأجزاء متساوية الطول داخل اليوم حتى لا يبقى جزء قصير جداً بعد استراحة.'} الأيام تُفتح للمتدرب يوماً بعد يوم بعد إكمال اليوم السابق.
            </p>
          </section>

          <section className="card stack" aria-labelledby="step3">
            <h2 id="step3" style={{ fontSize: 18 }}>
              ٣. بيانات الدورة
            </h2>
            {trainers.length === 0 ? (
              <p className="notice sandbox">
                أضف مدرباً أولاً من <Link href={`/${slug}/dashboard/trainers`}>صفحة المدربين</Link>.
              </p>
            ) : (
              <AdminForm action={createRecordedCourseAction.bind(null, slug)} submitLabel="إنشاء الدورة المسجلة">
                <input type="hidden" name="youtube_url" value={q.url} />
                <input type="hidden" name="split_mode" value={preview.config.split_mode} />
                <input type="hidden" name="max_lecture_minutes" value={preview.config.max_lecture_minutes} />
                <input type="hidden" name="min_lecture_minutes" value={preview.config.min_lecture_minutes} />
                <input type="hidden" name="break_minutes" value={preview.config.break_minutes} />
                <input type="hidden" name="discussion_minutes" value={preview.config.discussion_minutes} />
                <input type="hidden" name="days" value={preview.plan.days.length} />
                {preview.video.duration_source === 'manual' && <input type="hidden" name="manual_duration_seconds" value={preview.video.duration_seconds} />}
                <div className="form-grid">
                  <label htmlFor="title" className="full">
                    عنوان الدورة
                    <input id="title" name="title" type="text" required minLength={3} maxLength={200} defaultValue={preview.video.title} />
                  </label>
                  <label htmlFor="trainer_id">
                    المدرب
                    <select id="trainer_id" name="trainer_id" required defaultValue={trainers[0]?.id}>
                      {trainers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="price">
                    السعر <span className="hint">(ريال، قبل الضريبة. ٠ = مجانية)</span>
                    <input id="price" name="price" type="number" min={0} step="0.01" defaultValue={0} />
                  </label>
                  <label htmlFor="description" className="full">
                    الوصف
                    <textarea id="description" name="description" rows={3} maxLength={5000} />
                  </label>
                  <label className="full checkbox">
                    <input type="checkbox" name="is_published" />
                    نشر الدورة فوراً (تظهر في صفحة الأكاديمية ويمكن الالتحاق بها)
                  </label>
                </div>
                <p className="notice sandbox small">
                  فيديوهات YouTube عامة ويمكن مشاهدتها خارج المنصة، لذلك يُنصح بها للدورات المجانية والتعريفية. استخدم فقط فيديوهات تملكها أكاديميتك أو لديك ترخيص باستخدامها.
                </p>
              </AdminForm>
            )}
          </section>
        </>
      )}
    </>
  );
}
