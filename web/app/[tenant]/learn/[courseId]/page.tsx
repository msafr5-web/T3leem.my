import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, me, type DiscussionThread, type MyCourse, type MyLesson } from '@/lib/api';
import { completeLessonAction, postDiscussionAction } from '@/lib/actions';
import { dayOpensAt, formatDateTime, formatNumber, lessonTypeLabel } from '@/lib/format';
import { getSession } from '@/lib/session';
import { DiscussionBoard } from '../../../discussion-board';
import { HlsPlayer } from './hls-player';
import { YoutubeSegmentPlayer } from './youtube-segment-player';

export const metadata: Metadata = { title: 'التعلم' };

const minutes = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} د` : '');

/**
 * Recorded (YouTube) courses release one day at a time. With a start date, day N opens on its
 * date at the lecture time (learners who fall behind can still catch up on opened days);
 * without one, a day opens once every lecture of the previous day is complete.
 * Returns the ids of the days that are still locked.
 */
function lockedDays(course: MyCourse, now: number): Set<string> {
  const locked = new Set<string>();
  if (!course.youtube_video_id) return locked;
  const startsAt = course.source?.starts_at;
  course.modules.forEach((m, i) => {
    if (startsAt) {
      if (dayOpensAt(startsAt, i).getTime() > now) locked.add(m.id);
      return;
    }
    const prev = course.modules[i - 1];
    if (prev && (locked.has(prev.id) || prev.lessons.some((l) => !l.completed))) locked.add(m.id);
  });
  return locked;
}

export default async function LearnCourse({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; courseId: string }>;
  searchParams: Promise<{ lesson?: string; autoplay?: string }>;
}) {
  const [{ tenant: slug, courseId }, { lesson: lessonParam, autoplay }] = await Promise.all([params, searchParams]);
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

  const now = Date.now();
  const locked = lockedDays(course, now);
  const startsAt = course.source?.starts_at ?? null;
  const dayDate = (moduleId: string) => {
    const i = course.modules.findIndex((m) => m.id === moduleId);
    return startsAt && i >= 0 ? formatDateTime(dayOpensAt(startsAt, i).toISOString()) : null;
  };
  const moduleOf = new Map(course.modules.flatMap((m) => m.lessons.map((l) => [l.id, m] as const)));
  const lessons = course.modules.flatMap((m) => m.lessons);
  const open = lessons.filter((l) => !locked.has(moduleOf.get(l.id)?.id ?? ''));
  const resumeLesson = open.find((l) => !l.completed);
  const current: MyLesson | undefined = lessons.find((l) => l.id === lessonParam) ?? resumeLesson ?? open[0] ?? lessons[0];
  const index = current ? lessons.indexOf(current) : -1;
  const nextLesson = index >= 0 ? lessons[index + 1] : undefined;
  const currentModule = current ? moduleOf.get(current.id) : undefined;
  const currentLocked = currentModule ? locked.has(currentModule.id) : false;
  const isRecorded = course.youtube_video_id !== null;
  const lessonHref = (id: string) => `/${slug}/learn/${courseId}?lesson=${id}`;

  // The day's discussion board (recorded courses): a failure here must not break the lesson.
  let threads: DiscussionThread[] = [];
  if (isRecorded && currentModule && !currentLocked) {
    threads = await me.discussion(slug, session.token, currentModule.id).catch(() => []);
  }

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
          {course.source && (course.source.channel_name || startsAt) && (
            <p className="small muted">
              {course.source.channel_name && (
                <>
                  المصدر: قناة{' '}
                  {course.source.channel_url ? (
                    <a href={course.source.channel_url} target="_blank" rel="noopener noreferrer">
                      {course.source.channel_name}
                    </a>
                  ) : (
                    course.source.channel_name
                  )}{' '}
                  على YouTube
                </>
              )}
              {course.source.channel_name && startsAt && ' · '}
              {startsAt && <>المحاضرة اليومية تبدأ {formatDateTime(startsAt)}</>}
            </p>
          )}
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

              {currentLocked && (
                <div className="card empty">
                  {currentModule && dayDate(currentModule.id) ? `يُفتح هذا اليوم ${dayDate(currentModule.id)}.` : 'هذا اليوم يُفتح بعد إكمال أجزاء اليوم السابق.'}{' '}
                  {resumeLesson && <Link href={lessonHref(resumeLesson.id)}>تابع من حيث توقفت</Link>}
                </div>
              )}
              {!currentLocked && current.content_type === 'YOUTUBE' && course.youtube_video_id && current.start_second !== null && current.end_second !== null && (
                <YoutubeSegmentPlayer
                  key={current.id}
                  lessonId={current.id}
                  videoId={course.youtube_video_id}
                  title={current.title}
                  start={current.start_second}
                  end={current.end_second}
                  completed={current.completed}
                  autoplay={autoplay === '1'}
                  breakMinutes={course.schedule?.break_minutes ?? 5}
                  discussionMinutes={course.schedule?.discussion_minutes ?? 15}
                  next={nextLesson ? { href: lessonHref(nextLesson.id), sameDay: moduleOf.get(nextLesson.id)?.id === currentModule?.id } : null}
                  onComplete={completeLessonAction.bind(null, slug, courseId, current.id)}
                />
              )}
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
                {/* YouTube lectures complete themselves once watched; no self-reported button. */}
                {!current.completed && current.content_type !== 'YOUTUBE' && (
                  <form action={completeLessonAction.bind(null, slug, courseId, current.id)}>
                    <button type="submit" className="btn btn-primary">
                      أكملت هذا الدرس
                    </button>
                  </form>
                )}
                {nextLesson && !(current.content_type === 'YOUTUBE' && !current.completed) && (
                  <Link href={lessonHref(nextLesson.id)} className="btn btn-ghost">
                    الدرس التالي ←
                  </Link>
                )}
              </div>
              {isRecorded && currentModule && !currentLocked && (
                <DiscussionBoard
                  title={`نقاش ${currentModule.title}`}
                  intro={`بعد إنهاء أجزاء اليوم خصص نحو ${course.schedule?.discussion_minutes ?? 15} دقيقة للنقاش: اسأل المدرب أو شارك زملاءك فكرة.`}
                  threads={threads}
                  ask={postDiscussionAction.bind(null, slug, courseId, currentModule.id, null)}
                  replyTo={(postId) => postDiscussionAction.bind(null, slug, courseId, currentModule.id, postId)}
                />
              )}
            </>
          )}
        </section>

        <aside className="card stack" aria-label="محتوى الدورة">
          {course.modules.map((m) => (
            <div key={m.id} className="stack" style={{ gap: 6 }}>
              <h3 style={{ fontSize: 15 }}>
                {m.title}
                {dayDate(m.id) && <span className="small muted"> · {dayDate(m.id)}</span>}
                {locked.has(m.id) && <span className="small muted"> · مقفل</span>}
              </h3>
              <ol className="lesson-list">
                {m.lessons.map((l, i) => (
                  <li key={l.id} aria-current={l.id === current?.id ? 'true' : undefined}>
                    <Link href={lessonHref(l.id)}>
                      <span aria-hidden="true">{l.completed ? '✓' : locked.has(m.id) ? '•' : '○'}</span>
                      <span>{l.title}</span>
                      <span className="small muted">
                        {l.content_type === 'VIDEO' || l.content_type === 'YOUTUBE' ? minutes(l.duration_seconds) : lessonTypeLabel[l.content_type]}
                      </span>
                    </Link>
                    {isRecorded && course.schedule && (
                      <div className="schedule-gap small muted">
                        {i < m.lessons.length - 1 ? `استراحة ${course.schedule.break_minutes} د` : `نقاش ${course.schedule.discussion_minutes} د`}
                      </div>
                    )}
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
