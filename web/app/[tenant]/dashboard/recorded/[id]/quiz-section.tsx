import type { AdminQuiz, QuizAttemptSummary } from '@/lib/api';
import { importQuizAction, saveQuizSettingsAction, saveQuizWindowsAction } from '@/lib/admin-actions';
import { formatDateTime, formatNumber, riyadhInputs } from '@/lib/format';
import { AdminForm } from '../../admin-form';
import { QuizImportForm } from './quiz-import-form';
import { fromServer } from './quiz-builder/builder-model';
import { QuizFormBuilder } from './quiz-builder/quiz-form-builder';

/** Supervisor's end-of-day quiz: the question form, settings, Excel in/out, opening windows and learners' results. */
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
  const base = `/${slug}/dashboard/recorded/${courseId}/quiz/export`;
  const total = quiz.questions.length;

  return (
    <section className="card stack" id="quiz" aria-labelledby="quiz-h">
      <h2 id="quiz-h" style={{ fontSize: 18 }}>
        الاختبارات القصيرة في نهاية كل يوم
      </h2>
      <p className="small muted">
        يضيف المشرف الأسئلة في النموذج أدناه (أو يرفع بنكاً جاهزاً بملف Excel). في نهاية كل يوم يُسحب لكل متدرب عدد عشوائي من أسئلة ذلك اليوم (أو من المجموعة المشتركة إن لم يكن لليوم أسئلة)، بمؤقت يحسبه الخادم ومحاولة واحدة.
      </p>
      {saved && (
        <p className="notice ok small" role="status">
          حُفظت التعديلات.
        </p>
      )}

      <QuizFormBuilder
        slug={slug}
        courseId={courseId}
        days={quiz.days.map((d) => ({ id: d.id, title: d.title }))}
        initial={quiz.questions.map(fromServer)}
        perLearner={quiz.settings.question_count}
        durationMinutes={quiz.settings.duration_minutes}
      />

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

        <div className="stack" id="quiz-import">
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
