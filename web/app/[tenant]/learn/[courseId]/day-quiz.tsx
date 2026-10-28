'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuizResult, QuizStatus } from '@/lib/api';
import { startQuizAction, submitQuizAction } from '@/lib/actions';

type Running = Extract<NonNullable<QuizStatus['attempt']>, { state: 'in_progress' }>;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

/**
 * End-of-day quiz: N random questions, one attempt, a countdown. The deadline is decided by the
 * API; the browser only displays it (counted from the server's "now" so a wrong device clock
 * changes nothing) and auto-submits at zero. Correct answers arrive only with the result.
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
  const [index, setIndex] = useState(0);
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
      setIndex(0);
      if (r.status.attempt?.state === 'submitted') setResult(r.status.attempt.result);
    } else {
      setError(r.error ?? 'تعذّر بدء الاختبار.');
    }
    setBusy(false);
  };

  if (!status.available && !status.attempt) return null;

  if (result) return <QuizResultView result={result} dayTitle={dayTitle} />;

  if (running) {
    const q = running.questions[index]!;
    const total = running.questions.length;
    const answered = running.questions.filter((x) => answers[x.id] !== undefined && answers[x.id] !== '').length;
    const low = remaining !== null && remaining <= 60;
    return (
      <section className="card quiz stack" aria-labelledby="quiz-title">
        <div className="quiz-bar">
          <div>
            <h2 id="quiz-title" style={{ fontSize: 18 }}>
              اختبار {dayTitle}
            </h2>
            <p className="small muted">
              السؤال {index + 1} من {total} · أجبت عن {answered}
            </p>
          </div>
          <div className={`quiz-timer${low ? ' low' : ''}`} role="timer" aria-label="الوقت المتبقي">
            <span className="small">المتبقي</span>
            <b dir="ltr">{remaining === null ? '--:--' : clock(remaining)}</b>
          </div>
        </div>
        <div className="quiz-dots" aria-hidden="true">
          {running.questions.map((x, i) => (
            <span key={x.id} className={`${i === index ? 'on' : ''}${answers[x.id] !== undefined && answers[x.id] !== '' ? ' done' : ''}`} />
          ))}
        </div>

        <fieldset className="quiz-q" key={q.id}>
          <legend>{q.body}</legend>
          {q.type === 'MCQ' ? (
            <div className="quiz-options">
              {q.options.map((o, i) => (
                <label key={`${q.id}-${i}`} className={answers[q.id] === i ? 'picked' : ''}>
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === i} onChange={() => setAnswers((a) => ({ ...a, [q.id]: i }))} />
                  <span className="letter" aria-hidden="true">
                    {LETTERS[i]}
                  </span>
                  <span>{o}</span>
                </label>
              ))}
            </div>
          ) : (
            <label className="stack" style={{ gap: 4 }}>
              <span className="small muted">اكتب إجابتك بكلماتك (تُراجَع من المدرب ولا تُحتسب في الدرجة).</span>
              <textarea rows={5} maxLength={2000} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
            </label>
          )}
        </fieldset>

        {error && (
          <p className="notice error small" role="alert">
            {error}
          </p>
        )}
        <div className="row-actions">
          <button type="button" className="btn btn-ghost" disabled={index === 0 || busy} onClick={() => setIndex((i) => i - 1)}>
            → السابق
          </button>
          {index < total - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => setIndex((i) => i + 1)}>
              التالي ←
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                if (answered < total && !window.confirm(`لم تُجب عن ${total - answered} من الأسئلة. إرسال الإجابات الآن؟`)) return;
                void submit();
              }}
            >
              {busy ? 'جارٍ الإرسال…' : 'إرسال الإجابة النهائية'}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="card quiz stack" aria-labelledby="quiz-title">
      <h2 id="quiz-title" style={{ fontSize: 18 }}>
        اختبار {dayTitle}
      </h2>
      <p className="small muted">
        {status.question_count} {status.question_count === 1 ? 'سؤال' : 'أسئلة'} تُسحب عشوائياً لكل متدرب · مدة الاختبار {status.duration_minutes} دقيقة · محاولة واحدة فقط.
      </p>
      {!dayComplete ? (
        <p className="notice small">يُفتح الاختبار بعد إكمال جميع أجزاء هذا اليوم.</p>
      ) : (
        <>
          <p className="small">يبدأ العدّ التنازلي عند الضغط على «ابدأ الاختبار»، ويُغلق الاختبار تلقائياً بانتهاء الوقت وتُرسل إجاباتك كما هي.</p>
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
    </section>
  );
}

function QuizResultView({ result, dayTitle }: { result: QuizResult; dayTitle: string }) {
  const graded = result.max_score > 0;
  return (
    <section className="card quiz stack" aria-labelledby="quiz-title">
      <h2 id="quiz-title" style={{ fontSize: 18 }}>
        نتيجة اختبار {dayTitle}
      </h2>
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
      <ol className="quiz-review">
        {result.questions.map((q, i) => {
          const mine = typeof q.your_answer === 'number' ? q.options[q.your_answer] : q.your_answer;
          return (
            <li key={q.id} className={q.is_correct === null ? 'text' : q.is_correct ? 'right' : 'wrong'}>
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
                  {!q.is_correct && <p className="small">الإجابة الصحيحة: <b>{q.correct_answer}</b></p>}
                </>
              ) : (
                <>
                  <p className="small">إجابتك: {mine ? <span>{mine}</span> : <span className="muted">لم تُجب</span>}</p>
                  {q.correct_answer && <p className="small">الإجابة النموذجية: <b>{q.correct_answer}</b></p>}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
