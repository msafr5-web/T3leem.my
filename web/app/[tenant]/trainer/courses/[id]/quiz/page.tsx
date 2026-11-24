import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiError, trainerPortal, type AdminQuiz } from '@/lib/api';
import { importTrainerQuizAction } from '@/lib/admin-actions';
import { formatNumber } from '@/lib/format';
import { getSession } from '@/lib/session';
import { QuizImportForm } from '../../../../dashboard/recorded/[id]/quiz-import-form';
import { fromServer } from '../../../../dashboard/recorded/[id]/quiz-builder/builder-model';
import { QuizFormBuilder } from '../../../../dashboard/recorded/[id]/quiz-builder/quiz-form-builder';

export const metadata: Metadata = { title: 'أسئلة اختبار الدورة' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The trainer's own question bank for a recorded course they teach: form builder and Excel in/out. Pacing and results stay with the academy admin. */
export default async function TrainerQuiz({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/trainer/courses/${id}/quiz`)}`);
  if (session.role !== 'INSTRUCTOR') redirect(session.role === 'TENANT_ADMIN' ? `/${slug}/dashboard` : `/${slug}/my`);

  let quiz: AdminQuiz;
  try {
    quiz = await trainerPortal.quiz(slug, session.token, id);
  } catch (err) {
    // Not your course, not a recorded course, or the academy has not switched the module on: all look the same.
    if (err instanceof ApiError && [403, 404, 422].includes(err.status)) notFound();
    throw err;
  }
  const exportUrl = `/${slug}/trainer/courses/${id}/quiz/export`;
  const total = quiz.questions.length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>أسئلة اختبار الدورة</h1>
          <p className="muted small">
            {formatNumber(total)} سؤالاً. في نهاية كل يوم يُسحب لكل متدرب عدد عشوائي من أسئلة ذلك اليوم (أو من المجموعة المشتركة إن لم يكن لليوم أسئلة). مدة الاختبار ومواعيد فتحه ونتائج المتدربين تتبع مشرف الأكاديمية.
          </p>
        </div>
        <Link href={`/${slug}/trainer`} className="btn btn-ghost">
          رجوع
        </Link>
      </div>

      <section className="card stack" aria-labelledby="builder-h">
        <h2 id="builder-h" style={{ fontSize: 18 }}>
          الأسئلة
        </h2>
        <QuizFormBuilder
          slug={slug}
          courseId={id}
          scope="trainer"
          days={quiz.days.map((d) => ({ id: d.id, title: d.title }))}
          initial={quiz.questions.map(fromServer)}
          perLearner={quiz.settings.question_count}
          durationMinutes={quiz.settings.duration_minutes}
        />
      </section>

      <section className="card stack" id="quiz-import" aria-labelledby="excel-h">
        <h2 id="excel-h" style={{ fontSize: 18 }}>
          استيراد وتصدير (Excel)
        </h2>
        <div className="row-actions">
          <a className="btn btn-ghost" href={`${exportUrl}?template=1`} download>
            تنزيل قالب Excel
          </a>
          {total > 0 && (
            <a className="btn btn-ghost" href={exportUrl} download>
              تصدير بنك الأسئلة ({formatNumber(total)})
            </a>
          )}
        </div>
        <QuizImportForm action={importTrainerQuizAction.bind(null, slug, id)} />
      </section>
    </div>
  );
}
