import type { AdminQuiz, QuizAttemptSummary } from '@/lib/api';
import { deleteQuizQuestionAction, importQuizAction, saveQuizSettingsAction, saveQuizWindowsAction } from '@/lib/admin-actions';
import { formatDateTime, formatNumber, riyadhInputs } from '@/lib/format';
import { AdminForm } from '../../admin-form';
import { DeleteButton } from '../../delete-button';
import { QuizImportForm } from './quiz-import-form';

const LEVEL: Record<string, string> = { EASY: 'سهل', MEDIUM: 'متوسط', HARD: 'صعب' };

/** Supervisor's end-of-day quiz: Excel in/out, settings, coverage per day, the bank and learners' results. */
export function QuizSection({
  slug,
  courseId,
  quiz,
  results,
  saved,
}: {
  slug: string;
  courseId: string;
  quiz: AdminQuiz;
  results: QuizAttemptSummary[];
  saved: boolean;
}) {
  const dayTitle = new Map(quiz.days.map((d) => [d.id, d.title]));
  const base = `/${slug}/dashboard/recorded/${courseId}/quiz/export`;
  const total = quiz.questions.length;
  const uncovered = quiz.days.filter((d) => d.question_count === 0);

  return (
    <section className="card stack" id="quiz" aria-labelledby="quiz-h">
      <h2 id="quiz-h" style={{ fontSize: 18 }}>
        الاختبارات القصيرة في نهاية كل يوم
      </h2>
      <p className="small muted">
        يرفع المشرف بنك الأسئلة بملف Excel. في نهاية كل يوم يُسحب لكل متدرب عدد عشوائي من أسئلة ذلك اليوم (أو من المجموعة المشتركة إن لم يكن لليوم أسئلة)، بمؤقت يحسبه الخادم ومحاولة واحدة.
      </p>
      {saved && (
        <p className="notice ok small" role="status">
          حُفظت التعديلات.
        </p>
      )}

      <div className="quiz-admin-grid">
        <div className="stack">
          <h3 style={{ fontSize: 15 }}>إعدادات الاختبار</h3>
          <AdminForm action={saveQuizSettingsAction.bind(null, slug, courseId)} submitLabel="حفظ الإعدادات">
            <div className="form-grid">
              <label htmlFor="duration_minutes">
                مدة الاختبار <span className="hint">(دقائق)</span>
                <input id="duration_minutes" name="duration_minutes" type="number" min={1} max={180} required defaultValue={quiz.settings.duration_minutes} />
              </label>
              <label htmlFor="question_count">
                عدد الأسئلة لكل متدرب
                <input id="question_count" name="question_count" type="number" min={1} max={50} required defaultValue={quiz.settings.question_count} />
              </label>
            </div>
          </AdminForm>
        </div>

        <div className="stack">
          <h3 style={{ fontSize: 15 }}>استيراد وتصدير</h3>
          <div className="row-actions">
            <a className="btn btn-ghost" href={`${base}?template=1`} download>
              تنزيل قالب Excel
            </a>
            {total > 0 && (
              <a className="btn btn-ghost" href={base} download>
                تصدير بنك الأسئلة ({formatNumber(total)})
              </a>
            )}
          </div>
          <QuizImportForm action={importQuizAction.bind(null, slug, courseId)} />
        </div>
      </div>

      <div className="stack">
        <h3 style={{ fontSize: 15 }}>موعد فتح الاختبار وإغلاقه لكل يوم</h3>
        <p className="small muted">بتوقيت السعودية. اترك الحقل فارغاً لعدم التقييد. لا يستطيع المتدرب بدء الاختبار قبل الفتح ولا بعد الإغلاق، ولا يتجاوز وقته لحظة الإغلاق.</p>
        <AdminForm action={saveQuizWindowsAction.bind(null, slug, courseId)} submitLabel="حفظ المواعيد">
          <div className="table-wrap">
            <table className="quiz-table">
              <thead>
                <tr>
                  <th>اليوم</th>
                  <th>يفتح</th>
                  <th>يُغلق</th>
                </tr>
              </thead>
              <tbody>
                {quiz.days.map((d) => {
                  const o = riyadhInputs(d.opens_at);
                  const c = riyadhInputs(d.closes_at);
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.title}
                        <input type="hidden" name="day_id" value={d.id} />
                      </td>
                      <td>
                        <input type="datetime-local" name={`opens_${d.id}`} aria-label={`فتح ${d.title}`} defaultValue={o.date ? `${o.date}T${o.time}` : ''} />
                      </td>
                      <td>
                        <input type="datetime-local" name={`closes_${d.id}`} aria-label={`إغلاق ${d.title}`} defaultValue={c.date ? `${c.date}T${c.time}` : ''} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminForm>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <h3 style={{ fontSize: 15 }}>تغطية الأيام</h3>
        <div className="quiz-days">
          {quiz.days.map((d) => (
            <span key={d.id} className={`badge ${d.question_count > 0 ? 'ok' : ''}`}>
              {d.title}: {formatNumber(d.question_count)}
            </span>
          ))}
          <span className="badge">المجموعة المشتركة: {formatNumber(quiz.shared_count)}</span>
        </div>
        {total > 0 && uncovered.length > 0 && quiz.shared_count === 0 && (
          <p className="notice sandbox small">
            لا أسئلة لـ{uncovered.map((d) => d.title).join('، ')} ولا مجموعة مشتركة، فلن يظهر اختبار في هذه الأيام. أضف أسئلتها بعمود Day أو اترك Day فارغاً لتدخل في المجموعة المشتركة.
          </p>
        )}
      </div>

      {total > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>بنك الأسئلة ({formatNumber(total)})</summary>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="quiz-table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>السؤال</th>
                  <th>النوع</th>
                  <th>اليوم</th>
                  <th>الصعوبة</th>
                  <th>الإجابة الصحيحة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quiz.questions.map((q) => (
                  <tr key={q.id}>
                    <td className="ltr">{q.code}</td>
                    <td className="q-body">
                      {q.body}
                      {q.type === 'MCQ' && <div className="small muted">{q.options.join(' · ')}</div>}
                    </td>
                    <td>{q.type === 'MCQ' ? 'اختيار من متعدد' : 'نصي'}</td>
                    <td>{q.day_id ? (dayTitle.get(q.day_id) ?? '—') : 'مشترك'}</td>
                    <td>{LEVEL[q.difficulty]}</td>
                    <td className="q-body">{q.correct_answer || '—'}</td>
                    <td>
                      <DeleteButton action={deleteQuizQuestionAction.bind(null, slug, courseId, q.id)} label="حذف" confirmText="حذف هذا السؤال؟" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <h3 style={{ fontSize: 15 }}>نتائج المتدربين</h3>
        {results.length === 0 ? (
          <p className="small muted">لم يبدأ أي متدرب اختباراً بعد.</p>
        ) : (
          <div className="table-wrap">
            <table className="quiz-table">
              <thead>
                <tr>
                  <th>المتدرب</th>
                  <th>اليوم</th>
                  <th>الدرجة</th>
                  <th>الحالة</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.learner_name}
                      <div className="small muted ltr">{r.learner_email}</div>
                      {r.text_answers.length > 0 && (
                        <details className="small">
                          <summary>الإجابات النصية</summary>
                          {r.text_answers.map((t, i) => (
                            <p key={i} style={{ margin: '4px 0' }}>
                              <b>{t.question}</b>
                              <br />
                              {t.answer}
                            </p>
                          ))}
                        </details>
                      )}
                    </td>
                    <td>{r.day_title}</td>
                    <td>{r.submitted_at && r.max_score ? `${formatNumber(r.score ?? 0)} / ${formatNumber(r.max_score)}` : '—'}</td>
                    <td>{r.submitted_at ? <span className="badge ok">سُلّم</span> : <span className="badge draft">قيد الحل</span>}</td>
                    <td className="small">{formatDateTime(r.submitted_at ?? r.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
