import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, me, type MyCourse, type MyLesson } from '@/lib/api';
import { completeLessonAction } from '@/lib/actions';
import { formatNumber, lessonTypeLabel } from '@/lib/format';
import { getSession } from '@/lib/session';
import { HlsPlayer } from './hls-player';

export const metadata: Metadata = { title: 'التعلم' };

const minutes = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} د` : '');

export default async function LearnCourse({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; courseId: string }>;
  searchParams: Promise<{ lesson?: string }>;
}) {
  const [{ tenant: slug, courseId }, { lesson: lessonParam }] = await Promise.all([params, searchParams]);
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/learn/${courseId}`)}`);

  let course: MyCourse;
  try {
    course = await me.course(slug, session.token, courseId);
  } catch (err) {
    // Not enrolled (or no such course): send them to the course page to buy it.
    if (err instanceof ApiError && (err.status === 403 || err.status === 422)) redirect(`/${slug}/courses/${courseId}`);
    throw err;
  }

  const lessons = course.modules.flatMap((m) => m.lessons);
  const current: MyLesson | undefined = lessons.find((l) => l.id === lessonParam) ?? lessons.find((l) => !l.completed) ?? lessons[0];
  const index = current ? lessons.indexOf(current) : -1;
  const nextLesson = index >= 0 ? lessons[index + 1] : undefined;

  // Fresh signed playback URL for this page view (expires in ~2h).
  let playbackSrc: string | null = null;
  if (current?.content_type === 'VIDEO' && current.video_ready) {
    const p = await me.playback(slug, session.token, current.id).catch(() => null);
    if (p) playbackSrc = `/${slug}${p.playlist_path}`;
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <Link href={`/${slug}/my`} className="small">
            → دوراتي
          </Link>
          <h1 style={{ fontSize: 28 }}>{course.course_title}</h1>
        </div>
        <div style={{ minWidth: 220 }} className="stack">
          <div className="progress" role="progressbar" aria-valuenow={Math.round(course.progress)} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة الإنجاز">
            <span style={{ width: `${Math.min(100, course.progress)}%` }} />
          </div>
          <span className="small num">{formatNumber(course.progress)}٪ مكتمل</span>
        </div>
      </div>

      {course.certificate_code && (
        <div className="notice ok" role="status">
          <strong>أحسنت! أكملت الدورة.</strong> شهادتك جاهزة:{' '}
          <Link href={`/verify/${course.certificate_code}`}>عرض الشهادة وطباعتها</Link> · رمز التحقق <span className="ltr">{course.certificate_code}</span>
        </div>
      )}

      <div className="two-col learn">
        <section className="stack" aria-label="الدرس الحالي">
          {!current ? (
            <div className="card empty">لم يُنشر محتوى هذه الدورة بعد.</div>
          ) : (
            <>
              <div className="badges">
                <span className="chip">{lessonTypeLabel[current.content_type]}</span>
                {current.completed && <span className="badge ok">مكتمل</span>}
              </div>
              <h2>{current.title}</h2>

              {current.content_type === 'VIDEO' &&
                (playbackSrc ? (
                  <HlsPlayer src={playbackSrc} title={current.title} />
                ) : (
                  <div className="card empty">الفيديو قيد المعالجة. عُد بعد قليل.</div>
                ))}
              {current.content_type === 'PDF' && current.media_url && (
                <div className="card stack">
                  <p>ملف الدرس متاح للقراءة.</p>
                  <a href={current.media_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                    فتح الملف
                  </a>
                </div>
              )}
              {current.content_type === 'ZOOM' && (
                <div className="card stack">
                  <p>هذا الدرس جلسة مباشرة. ستجد موعدها ورابط الانضمام في صفحة دوراتي.</p>
                  <Link href={`/${slug}/my`} className="btn btn-ghost">
                    جلساتي المباشرة
                  </Link>
                </div>
              )}

              <div className="row-actions">
                {!current.completed && (
                  <form action={completeLessonAction.bind(null, slug, courseId, current.id)}>
                    <button type="submit" className="btn btn-primary">
                      أكملت هذا الدرس
                    </button>
                  </form>
                )}
                {nextLesson && (
                  <Link href={`/${slug}/learn/${courseId}?lesson=${nextLesson.id}`} className="btn btn-ghost">
                    الدرس التالي ←
                  </Link>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="card stack" aria-label="محتوى الدورة">
          {course.modules.map((m) => (
            <div key={m.id} className="stack" style={{ gap: 6 }}>
              <h3 style={{ fontSize: 15 }}>{m.title}</h3>
              <ol className="lesson-list">
                {m.lessons.map((l) => (
                  <li key={l.id} aria-current={l.id === current?.id ? 'true' : undefined}>
                    <Link href={`/${slug}/learn/${courseId}?lesson=${l.id}`}>
                      <span aria-hidden="true">{l.completed ? '✓' : '○'}</span>
                      <span>{l.title}</span>
                      <span className="small muted">{l.content_type === 'VIDEO' ? minutes(l.duration_seconds) : lessonTypeLabel[l.content_type]}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
