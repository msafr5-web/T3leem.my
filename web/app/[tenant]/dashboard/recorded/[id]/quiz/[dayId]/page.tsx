import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AdminQuiz, type RecordedCourseDetail } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { deleteDayQuestionAction, saveQuizQuestionAction } from '@/lib/admin-actions';
import { formatNumber } from '@/lib/format';
import { DeleteButton } from '../../../../delete-button';
import { QuestionForm, EMPTY_QUESTION, type QuestionFormValues } from './question-form';

const LEVEL: Record<string, string> = { EASY: 'سهل', MEDIUM: 'متوسط', HARD: 'صعب' };

/** Builds a day's quiz question by question, in a form (Excel stays available for bulk work). */
export default async function DayQuestions({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string; dayId: string }>;
  searchParams: Promise<{ edit?: string; saved?: string }>;
}) {
  const [{ tenant: slug, id, dayId }, { edit, saved }] = await Promise.all([params, searchParams]);
  const token = await requireAdmin(slug);

  let course: RecordedCourseDetail;
  let quiz: AdminQuiz;
  try {
    [course, quiz] = await Promise.all([admin.recordedCourse(slug, token, id), admin.quiz(slug, token, id)]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  const dayIndex = course.days.findIndex((d) => d.id === dayId);
  if (dayIndex < 0) notFound();
  const day = course.days[dayIndex]!;
  const mine = quiz.questions.filter((q) => q.day_id === dayId);
  const editing = edit ? mine.find((q) => q.id === edit) : undefined;

  const initial: QuestionFormValues | undefined = editing
    ? {
        type: editing.type,
        body: editing.body,
        options: editing.type === 'MCQ' ? editing.options : EMPTY_QUESTION.options,
        correct: Math.max(0, editing.options.indexOf(editing.correct_answer)),
        modelAnswer: editing.type === 'TEXT' ? editing.correct_answer : '',
        difficulty: editing.difficulty,
      }
    : undefined;
  const back = `/${slug}/dashboard/recorded/${id}`;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 26 }}>أسئلة {day.title}</h1>
          <p className="muted small">
            {course.title} · {formatNumber(mine.length)} {mine.length === 1 ? 'سؤال' : 'أسئلة'} لهذا اليوم
          </p>
        </div>
        <div className="cta-row">
          <Link href={`${back}#quiz`} className="btn btn-ghost">
            الاستيراد والمواعيد
          </Link>
          <Link href={back} className="btn btn-ghost">
            رجوع للدورة
          </Link>
        </div>
      </div>

      {saved && (
        <div className="notice ok" role="status">
          حُفظ السؤال.
        </div>
      )}

      <section className="card stack" aria-labelledby="form-h">
        <h2 id="form-h" style={{ fontSize: 18 }}>
          {editing ? 'تعديل سؤال' : 'إضافة سؤال'}
        </h2>
        {/* Remount when switching between "add" and a specific question so the fields reset. */}
        <QuestionForm
          key={editing?.id ?? 'new'}
          action={saveQuizQuestionAction.bind(null, slug, id, dayId, editing?.id ?? null)}
          initial={initial}
          submitLabel={editing ? 'حفظ التعديل' : 'إضافة السؤال'}
        />
        {editing && (
          <p>
            <Link href={`${back}/quiz/${dayId}`}>إلغاء التعديل</Link>
          </p>
        )}
      </section>

      <section className="stack" aria-labelledby="list-h">
        <h2 id="list-h" style={{ fontSize: 18 }}>
          أسئلة اليوم
        </h2>
        {mine.length === 0 ? (
          <div className="card empty">
            لا أسئلة لهذا اليوم بعد.
            {quiz.shared_count > 0 ? ` سيحصل المتدربون على أسئلة من المجموعة المشتركة (${formatNumber(quiz.shared_count)} سؤالاً).` : ' أضف سؤالاً من النموذج أعلاه أو استورد ملف Excel.'}
          </div>
        ) : (
          mine.map((q, i) => (
            <article key={q.id} className="card stack" style={{ gap: 8 }}>
              <div className="badges">
                <span className="chip">{i + 1}</span>
                <span className="badge">{q.type === 'MCQ' ? 'اختيار من متعدد' : 'نصي'}</span>
                <span className="badge">{LEVEL[q.difficulty]}</span>
                <span className="badge ltr">{q.code}</span>
              </div>
              <p style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{q.body}</p>
              {q.type === 'MCQ' ? (
                <ul className="qf-list">
                  {q.options.map((o) => (
                    <li key={o} className={o === q.correct_answer ? 'right' : ''}>
                      {o === q.correct_answer ? '✓ ' : ''}
                      {o}
                    </li>
                  ))}
                </ul>
              ) : (
                q.correct_answer && <p className="small muted">الإجابة النموذجية: {q.correct_answer}</p>
              )}
              <div className="row-actions">
                <Link href={`${back}/quiz/${dayId}?edit=${q.id}#form-h`} className="btn btn-ghost">
                  تعديل
                </Link>
                <DeleteButton action={deleteDayQuestionAction.bind(null, slug, id, dayId, q.id)} label="حذف" confirmText="حذف هذا السؤال؟" />
              </div>
            </article>
          ))
        )}
      </section>
    </>
  );
}
