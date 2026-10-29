'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuizResult, QuizStatus } from '@/lib/api';
import { startQuizAction, submitQuizAction } from '@/lib/actions';
import { formatDateTime } from '@/lib/format';

type Running = Extract<NonNullable<QuizStatus['attempt']>, { state: 'in_progress' }>;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Opening / closing times the supervisor set for this day, in words. */
function WindowNote({ status }: { status: QuizStatus }) {
  if (!status.opens_at && !status.closes_at) return null;
  return (
    <p className="small muted">
      {status.opens_at && <>يفتح الاختبار: {formatDateTime(status.opens_at)}</>}
      {status.opens_at && status.closes_at && ' · '}
      {status.closes_at && <>يُغلق: {formatDateTime(status.closes_at)}</>}
    </p>
  );
}

/**
 * End-of-day quiz in the style of an online form: one page, every question in its own card, a
 * timer bar that stays on screen. Opening/closing times and the deadline are decided by the API;
 * the browser only displays them (counted from the server's "now", so a wrong device clock changes
 * nothing) and auto-submits at zero. Correct answers arrive only with the result.
 */
export function DayQuiz({
  slug,
  courseId,
  moduleId,
  dayTitle,
  initial,
  dayComplete,
}: {
  slug: string;
  courseId: string;
  moduleId: string;
  dayTitle: string;
  initial: QuizStatus;
  /** Every lecture of the day is finished: the quiz opens only then. */
  dayComplete: boolean;
}) {
  const [status, setStatus] = useState(initial);
  const [result, setResult] = useState<QuizResult | null>(initial.attempt?.state === 'submitted' ? initial.attempt.result : null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const answersRef = useRef(answers);
  const sent = useRef(false);
  answersRef.current = answers;

  const running = status.attempt?.state === 'in_progress' && !result ? (status.attempt as Running) : null;

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    setError(null);
    const r = await submitQuizAction(slug, courseId, moduleId, answersRef.current);
    if (r.result) {
      setResult(r.result);
    } else {
      // Window closed or already handed in: show what the server recorded instead of an error loop.
      const fresh = r.stale ? await startQuizAction(slug, courseId, moduleId) : null;
      if (fresh?.status) {
        setStatus(fresh.status);
        if (fresh.status.attempt?.state === 'submitted') setResult(fresh.status.attempt.result);
      } else {
        sent.current = false;
      }
      setError(r.error ?? null);
    }
    setBusy(false);
  }, [slug, courseId, moduleId]);

  // Countdown from the server's own clock: remaining = expires_at - server_now at load, counted locally.
  const expiresAt = running?.expires_at;
  const serverNow = status.server_now;
  useEffect(() => {
    if (!expiresAt) return;
    const deadline = performance.now() + (Date.parse(expiresAt) - Date.parse(serverNow));
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setRemaining(left);
      if (left === 0) void submit();
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [expiresAt, serverNow, submit]);

  const start = async () => {
    setBusy(true);
    setError(null);
    const r = await startQuizAction(slug, courseId, moduleId);
    if (r.status) {
      sent.current = false;
      setStatus(r.status);
      if (r.status.attempt?.state === 'submitted') setResult(r.status.attempt.result);
    } else {
      setError(r.error ?? 'تعذّر بدء الاختبار.');
    }
    setBusy(false);
  };

  if (!status.available && !status.attempt) return null;

  if (result) return <QuizResultView result={result} dayTitle={dayTitle} />;

  if (running) {
    const total = running.questions.length;
    const answered = running.questions.filter((x) => answers[x.id] !== undefined && answers[x.id] !== '').length;
    const low = remaining !== null && remaining <= 60;
    return (
      <section className="gf" aria-labelledby="quiz-title">
        <div className={`gf-bar${low ? ' low' : ''}`}>
          <span className="small">
            أجبت عن {answered} من {total}
          </span>
          <span className="gf-time" role="timer" aria-label="الوقت المتبقي">
            <span className="small">المتبقي</span> <b dir="ltr">{remaining === null ? '--:--' : clock(remaining)}</b>
          </span>
        </div>

        <header className="gf-card gf-header">
          <h2 id="quiz-title">اختبار {dayTitle}</h2>
          <p className="small muted">أجب عن الأسئلة التالية ثم اضغط «إرسال». يُرسل الاختبار تلقائياً عند انتهاء الوقت.</p>
          <WindowNote status={status} />
        </header>

        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (answered < total && !window.confirm(`لم تُجب عن ${total - answered} من الأسئلة. إرسال الإجابات الآن؟`)) return;
            void submit();
          }}
        >
          {running.questions.map((q, i) => (
            <fieldset key={q.id} className="gf-card gf-q">
              <legend>
                <span className="gf-num">{i + 1}</span>
                <span>{q.body}</span>
              </legend>
              <span className="gf-kind">{q.type === 'MCQ' ? 'اختيار من متعدد' : 'إجابة نصية'}</span>
              {q.type === 'MCQ' ? (
                <>
                  <div className="gf-options">
                    {q.options.map((o, oi) => (
                      <label key={`${q.id}-${oi}`}>
                        <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} />
                        <span>{o}</span>
                      </label>
                    ))}
                  </div>
                  {answers[q.id] !== undefined && (
                    <button
                      type="button"
                      className="gf-clear"
                      onClick={() =>
                        setAnswers((a) => {
                          const { [q.id]: _removed, ...rest } = a;
                          return rest;
                        })
                      }
                    >
                      مسح الاختيار
                    </button>
                  )}
                </>
              ) : (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="visually-hidden">إجابتك</span>
                  <textarea
                    className="gf-text"
                    rows={4}
                    maxLength={2000}
                    placeholder="اكتب إجابتك هنا…"
                    value={String(answers[q.id] ?? '')}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  />
                  <span className="small muted">تُراجَع من المدرب ولا تُحتسب في الدرجة.</span>
                </label>
              )}
            </fieldset>
          ))}

          {error && (
            <p className="notice error small" role="alert">
              {error}
            </p>
          )}
          <div className="gf-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'جارٍ الإرسال…' : 'إرسال'}
            </button>
            <span className="small muted">
              {answered} / {total} مُجاب
            </span>
          </div>
        </form>
      </section>
    );
  }

  // Not started: the form's cover card, with the supervisor's opening / closing times.
  const closed = status.window === 'closed';
  const notOpen = status.window === 'not_open';
  return (
    <section className="gf" aria-labelledby="quiz-title">
      <header className="gf-card gf-header">
        <h2 id="quiz-title">اختبار {dayTitle}</h2>
        <p className="small muted">
          {status.question_count} {status.question_count === 1 ? 'سؤال' : 'أسئلة'} تُسحب عشوائياً لكل متدرب · مدة الاختبار {status.duration_minutes} دقيقة · محاولة واحدة فقط.
        </p>
        <WindowNote status={status} />
        {!dayComplete ? (
          <p className="notice small">يُفتح الاختبار بعد إكمال جميع أجزاء هذا اليوم.</p>
        ) : notOpen ? (
          <p className="notice sandbox small">لم يحن موعد الاختبار بعد{status.opens_at ? `، يفتح ${formatDateTime(status.opens_at)}` : ''}.</p>
        ) : closed ? (
          <p className="notice error small">انتهى موعد هذا الاختبار ولم يعد متاحاً.</p>
        ) : (
          <>
            <p className="small">يبدأ العدّ التنازلي عند الضغط على «ابدأ الاختبار»، ويُغلق تلقائياً بانتهاء الوقت وتُرسل إجاباتك كما هي.</p>
            {error && (
              <p className="notice error small" role="alert">
                {error}
              </p>
            )}
            <div>
              <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
                {busy ? 'جارٍ التحضير…' : 'ابدأ الاختبار'}
              </button>
            </div>
          </>
        )}
      </header>
    </section>
  );
}

function QuizResultView({ result, dayTitle }: { result: QuizResult; dayTitle: string }) {
  const graded = result.max_score > 0;
  return (
    <section className="gf" aria-labelledby="quiz-title">
      <header className="gf-card gf-header">
        <h2 id="quiz-title">نتيجة اختبار {dayTitle}</h2>
        {graded ? (
          <div className={`quiz-score ${result.percent !== null && result.percent >= 60 ? 'pass' : 'fail'}`}>
            <b>
              {result.score} / {result.max_score}
            </b>
            <span>{result.percent}٪</span>
          </div>
        ) : (
          <p className="notice small">هذا الاختبار أسئلته نصية فقط: أُرسلت إجاباتك للمدرب ولا درجة آلية له.</p>
        )}
      </header>
      {result.questions.map((q, i) => {
        const mine = typeof q.your_answer === 'number' ? q.options[q.your_answer] : q.your_answer;
        return (
          <article key={q.id} className={`gf-card gf-review ${q.is_correct === null ? 'text' : q.is_correct ? 'right' : 'wrong'}`}>
            <p>
              <b>
                {i + 1}. {q.body}
              </b>
            </p>
            {q.type === 'MCQ' ? (
              <>
                <p className="small">
                  إجابتك: {mine ? <span>{mine}</span> : <span className="muted">لم تُجب</span>}{' '}
                  <span className={`badge ${q.is_correct ? 'ok' : 'draft'}`}>{q.is_correct ? 'صحيحة' : 'غير صحيحة'}</span>
                </p>
                {!q.is_correct && (
                  <p className="small">
                    الإجابة الصحيحة: <b>{q.correct_answer}</b>
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="small">إجابتك: {mine ? <span>{mine}</span> : <span className="muted">لم تُجب</span>}</p>
                {q.correct_answer && (
                  <p className="small">
                    الإجابة النموذجية: <b>{q.correct_answer}</b>
                  </p>
                )}
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}
