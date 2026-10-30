import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AdminQuiz, type DiscussionThread, type QuizAttemptSummary, type RecordedCourseDetail } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { adminPostDiscussionAction, updateRecordedSourceAction } from '@/lib/admin-actions';
import { dayOpensAt, formatDateTime, formatMinutes, formatNumber } from '@/lib/format';
import { AdminForm } from '../../admin-form';
import { DiscussionBoard } from '../../../../discussion-board';
import { QuizSection } from './quiz-section';
import { ScheduleTimeline } from '../schedule-timeline';
import { SourceFields } from '../source-fields';

export default async function RecordedCourseSchedule({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ created?: string; saved?: string }>;
}) {
  const [{ tenant: slug, id }, { created, saved }] = await Promise.all([params, searchParams]);
  const token = await requireAdmin(slug);

  let course: RecordedCourseDetail;
  try {
    course = await admin.recordedCourse(slug, token, id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  // Every day's board in parallel; one failing board shouldn't hide the others.
  const boards: DiscussionThread[][] = await Promise.all(course.days.map((d) => admin.discussion(slug, token, d.id).catch(() => [])));
  // The quiz part must not take the whole page down if it fails to load.
  const [quiz, quizResults]: [AdminQuiz | null, QuizAttemptSummary[]] = await Promise.all([
    admin.quiz(slug, token, id).catch(() => null),
    admin.quizResults(slug, token, id).catch(() => []),
  ]);
  const breakMinutes = course.config?.break_minutes ?? 5;
  const discussionMinutes = course.config?.discussion_minutes ?? 15;
  const builderHref = '#quiz-form';
  const totalQuestions = quiz?.questions.length ?? 0;
  const coveredDays = quiz?.days.filter((d) => d.question_count > 0).length ?? 0;
  // Before publishing, the next step is the quiz questions; afterwards, publishing stays the main action.
  const quizFirst = !course.is_published && totalQuestions === 0;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>{course.title}</h1>
          <p className="muted small">
            دورة مسجلة · {formatMinutes(course.duration_seconds)} فيديو · {formatNumber(course.days.length)} {course.days.length === 1 ? 'يوم' : 'أيام'} ·{' '}
            {course.training_hours !== null && <>{formatNumber(course.training_hours)} ساعة تدريبية · </>}
            {formatNumber(course.enrollment_count)} متدرب
          </p>
        </div>
        <div className="cta-row">
          <a href={builderHref} className={`btn ${quizFirst ? 'btn-primary' : 'btn-ghost'}`}>
            إعداد أسئلة الاختبار
          </a>
          <Link href={`/${slug}/dashboard/courses/${course.id}`} className={`btn ${quizFirst ? 'btn-ghost' : 'btn-primary'}`}>
            السعر والنشر والترخيص
          </Link>
          {course.is_published && (
            <Link href={`/${slug}/courses/${course.id}`} className="btn btn-ghost">
              صفحة الدورة
            </Link>
          )}
          <a href="#quiz" className="btn btn-ghost">
            استيراد من Excel
          </a>
          <a href={`/${slug}/dashboard/recorded/${course.id}/quiz/export${quiz && quiz.questions.length > 0 ? '' : '?template=1'}`} className="btn btn-ghost" download>
            {quiz && quiz.questions.length > 0 ? 'تصدير الأسئلة' : 'قالب الأسئلة'}
          </a>
          <Link href={`/${slug}/dashboard/recorded`} className="btn btn-ghost">
            رجوع
          </Link>
        </div>
      </div>

      {created && (
        <div className="notice ok" role="status">
          أُنشئت الدورة وقُسّم الفيديو إلى أيام وأجزاء.{' '}
          {course.is_published ? 'الدورة منشورة ويمكن للمتدربين الالتحاق بها.' : 'الدورة مسودة: انشرها من «السعر والنشر والترخيص» عندما تكون جاهزة.'}
        </div>
      )}

      {!course.is_published && (
        <section className="card publish-check stack" aria-labelledby="before-publish">
          <h2 id="before-publish" style={{ fontSize: 18 }}>
            قبل نشر الدورة
          </h2>
          <ul>
            <li>
              <span className="tick" aria-hidden="true">
                ✓
              </span>
              <span>أُنشئت الدورة وقُسّم الفيديو إلى {formatNumber(course.days.length)} {course.days.length === 1 ? 'يوم' : 'أيام'}.</span>
            </li>
            <li>
              <span className={totalQuestions > 0 ? 'tick' : 'todo'} aria-hidden="true">
                {totalQuestions > 0 ? '✓' : '!'}
              </span>
              <span>
                {totalQuestions > 0
                  ? `أسئلة الاختبار: ${formatNumber(totalQuestions)} ${totalQuestions === 1 ? 'سؤال' : 'أسئلة'} تغطي ${formatNumber(coveredDays)} من ${formatNumber(course.days.length)} أيام${quiz && quiz.shared_count > 0 ? ` + ${formatNumber(quiz.shared_count)} مشتركة` : ''}.`
                  : 'لم تُضف أسئلة الاختبار بعد: بدونها لن يجد المتدربون اختباراً في نهاية الأيام.'}
              </span>
            </li>
            <li>
              <span className="todo" aria-hidden="true">
                !
              </span>
              <span>حدّد السعر والترخيص ثم انشر الدورة من «السعر والنشر والترخيص».</span>
            </li>
          </ul>
          <div className="cta-row">
            <a href={builderHref} className={`btn ${quizFirst ? 'btn-primary' : 'btn-ghost'}`}>
              {totalQuestions > 0 ? 'تعديل أسئلة الاختبار' : 'ابدأ إعداد أسئلة الاختبار'}
            </a>
          </div>
        </section>
      )}

      <section className="card stack" aria-labelledby="schedule">
        <h2 id="schedule" style={{ fontSize: 18 }}>
          الجدولة
        </h2>
        <ScheduleTimeline
          days={course.days.map((d, i) => ({
            key: d.id,
            title: course.starts_at ? `${d.title} · ${formatDateTime(dayOpensAt(course.starts_at, i).toISOString())}` : d.title,
            lectures: d.lessons,
            action: (
              <a href={`#quiz-day-${d.id}`} className="day-quiz-link" title={`بناء أسئلة ${d.title}`}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="3" width="16" height="18" rx="2" />
                  <path d="M8 8h8M8 12h8M8 16h5" />
                </svg>
                أسئلة اليوم
                <span className="badge">{formatNumber(quiz?.days.find((q) => q.id === d.id)?.question_count ?? 0)}</span>
              </a>
            ),
          }))}
          breakMinutes={breakMinutes}
          discussionMinutes={discussionMinutes}
        />
        <p className="small muted">
          الفيديو:{' '}
          <a href={`https://www.youtube.com/watch?v=${course.video_id}`} target="_blank" rel="noopener noreferrer" className="ltr">
            youtube.com/watch?v={course.video_id}
          </a>
          {course.channel_name && (
            <>
              {' '}
              · القناة:{' '}
              {course.channel_url ? (
                <a href={course.channel_url} target="_blank" rel="noopener noreferrer">
                  {course.channel_name}
                </a>
              ) : (
                course.channel_name
              )}
            </>
          )}
        </p>
      </section>

      <section className="card stack" aria-labelledby="source">
        <h2 id="source" style={{ fontSize: 18 }}>
          القناة وموعد الدورة
        </h2>
        {saved && saved !== 'quiz' && (
          <p className="notice ok small" role="status">
            حُفظت التعديلات.
          </p>
        )}
        <p className="small muted">
          {course.starts_at
            ? `تبدأ ${formatDateTime(course.starts_at)}، ويُفتح يوم جديد كل يوم في الوقت نفسه.`
            : 'بلا موعد محدد: يُفتح كل يوم للمتدرب بعد إكمال اليوم السابق. حدّد تاريخاً ووقتاً لتُفتح الأيام حسب الجدول.'}
        </p>
        <AdminForm action={updateRecordedSourceAction.bind(null, slug, course.id)} submitLabel="حفظ القناة والموعد">
          <div className="form-grid">
            <SourceFields channelUrl={course.channel_url} channelName={course.channel_name} startsAt={course.starts_at} />
          </div>
        </AdminForm>
      </section>

      {quiz && <QuizSection slug={slug} courseId={course.id} quiz={quiz} results={quizResults} saved={saved === 'quiz'} />}

      {course.days.map((d, i) => (
        <DiscussionBoard
          key={d.id}
          title={`نقاش ${d.title}`}
          intro={boards[i]!.length === 0 ? 'ستظهر هنا أسئلة المتدربين عن هذا اليوم، ويمكنك الرد عليها.' : undefined}
          threads={boards[i]!}
          ask={adminPostDiscussionAction.bind(null, slug, course.id, d.id, null)}
          askLabel="أضف سؤالاً توجيهياً للنقاش"
          anchorId={`discussion-${d.id}`}
          replyTo={(postId) => adminPostDiscussionAction.bind(null, slug, course.id, d.id, postId)}
        />
      ))}
    </>
  );
}
