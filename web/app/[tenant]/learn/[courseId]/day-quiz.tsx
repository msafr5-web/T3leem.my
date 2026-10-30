'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuizAnswer, QuizResult, QuizResultQuestion, QuizStatus } from '@/lib/api';
import { startQuizAction, submitQuizAction } from '@/lib/actions';
import { formatDateTime } from '@/lib/format';

type Running = Extract<NonNullable<QuizStatus['attempt']>, { state: 'in_progress' }>;
type RunningQuestion = Running['questions'][number];

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const KIND: Record<RunningQuestion['type'], string> = {
  MCQ: 'اختيار واحد',
  CHECKBOX: 'اختر كل ما ينطبق',
  SHORT: 'إجابة قصيرة',
  TEXT: 'فقرة',
  RATING: 'تقييم',
};

/** Has the learner given a usable answer? (Same notion of "answered" as the API's required check.) */
const isAnswered = (v: QuizAnswer | undefined): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'number' ? true : typeof v === 'string' && v.trim() !== '');

const pointsLabel = (n: number) => `${n} ${n === 1 ? 'درجة' : 'درجات'}`;

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
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const answersRef = useRef(answers);
  const sent = useRef(false);
  answersRef.current = answers;

  const running = status.attempt?.state === 'in_progress' && !result ? (status.attempt as Running) : null;

  const setAnswer = (id: string, value: QuizAnswer | undefined) => {
    setMissing((m) => m.filter((x) => x !== id));
    setAnswers((a) => {
      if (value === undefined || (Array.isArray(value) && value.length === 0) || value === '') {
        const { [id]: _removed, ...rest } = a;
        return rest;
      }
      return { ...a, [id]: value };
    });
  };

  const goTo = (id: string) => document.querySelector<HTMLElement>(`[data-quiz-q="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  /** `auto` = the countdown reached zero: send whatever there is, required or not. */
  const submit = useCallback(
    async (auto = false) => {
      if (sent.current) return;
      if (!auto && running) {
        // Required questions must be answered first; show which, instead of a round trip to fail.
        const unanswered = running.questions.filter((q) => q.required && !isAnswered(answersRef.current[q.id])).map((q) => q.id);
        if (unanswered.length > 0) {
          setMissing(unanswered);
          setError(`أجب عن ${unanswered.length === 1 ? 'السؤال المطلوب' : `الأسئلة المطلوبة (${unanswered.length})`} قبل الإرسال.`);
          goTo(unanswered[0] as string);
          return;
        }
      }
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
        if (r.missing?.length) {
          setMissing(r.missing);
          goTo(r.missing[0] as string);
        }
        setError(r.error ?? null);
      }
      setBusy(false);
    },
    [slug, courseId, moduleId, running],
  );

  // The countdown effect must not restart when `submit` is rebuilt: keep the latest one in a ref.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Countdown from the server's own clock: remaining = expires_at - server_now at load, counted locally.
  const expiresAt = running?.expires_at;
  const serverNow = status.server_now;
  useEffect(() => {
    if (!expiresAt) return;
    const deadline = performance.now() + (Date.parse(expiresAt) - Date.parse(serverNow));
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setRemaining(left);
      if (left === 0) void submitRef.current(true);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [expiresAt, serverNow]);

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
    const answered = running.questions.filter((x) => isAnswered(answers[x.id])).length;
    const requiredCount = running.questions.filter((q) => q.required).length;
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
          {requiredCount > 0 && (
            <p className="small muted">
              <span className="gf-req">*</span> تشير إلى سؤال مطلوب.
            </p>
          )}
          <WindowNote status={status} />
        </header>

        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            const optionalBlank = running.questions.filter((q) => !q.required && !isAnswered(answers[q.id])).length;
            if (optionalBlank > 0 && !window.confirm(`لم تُجب عن ${optionalBlank} من الأسئلة. إرسال الإجابات الآن؟`)) return;
            void submit();
          }}
        >
          {running.questions.map((q, i) => (
            <fieldset key={q.id} data-quiz-q={q.id} className={`gf-card gf-q${missing.includes(q.id) ? ' gf-missing' : ''}`}>
              <legend>
                <span className="gf-num">{i + 1}</span>
                <span>
                  {q.body}
                  {q.required && (
                    <span className="gf-req" title="مطلوب" aria-label="مطلوب">
                      {' '}
                      *
                    </span>
                  )}
                </span>
              </legend>
              <span className="gf-kind">
                {KIND[q.type]}
                {(q.type === 'MCQ' || q.type === 'CHECKBOX') && <> · {pointsLabel(q.points)}</>}
              </span>
              <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
              {missing.includes(q.id) && (
                <p className="gf-miss" role="alert">
                  هذا سؤال مطلوب.
                </p>
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

/** The answer control of one question, by type. */
function QuestionInput({ q, value, onChange }: { q: RunningQuestion; value: QuizAnswer | undefined; onChange: (v: QuizAnswer | undefined) => void }) {
  if (q.type === 'MCQ') {
    return (
      <>
        <div className="gf-options">
          {q.options.map((o, oi) => (
            <label key={`${q.id}-${oi}`}>
              <input type="radio" name={`q-${q.id}`} checked={value === oi} onChange={() => onChange(oi)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {value !== undefined && (
          <button type="button" className="gf-clear" onClick={() => onChange(undefined)}>
            مسح الاختيار
          </button>
        )}
      </>
    );
  }
  if (q.type === 'CHECKBOX') {
    const picked = Array.isArray(value) ? value : [];
    return (
      <div className="gf-options">
        {q.options.map((o, oi) => (
          <label key={`${q.id}-${oi}`}>
            <input
              type="checkbox"
              checked={picked.includes(oi)}
              onChange={() => onChange(picked.includes(oi) ? picked.filter((x) => x !== oi) : [...picked, oi].sort((a, b) => a - b))}
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'RATING') {
    const stars = typeof value === 'number' ? value : 0;
    return (
      <div className="gf-stars" role="radiogroup" aria-label="التقييم من ١ إلى ٥">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} من 5`}
            className={n <= stars ? 'on' : ''}
            onClick={() => onChange(stars === n ? undefined : n)}
          >
            ★
          </button>
        ))}
      </div>
    );
  }
  if (q.type === 'SHORT') {
    return (
      <label className="stack" style={{ gap: 4 }}>
        <span className="visually-hidden">إجابتك</span>
        <input type="text" className="gf-short" maxLength={300} placeholder="إجابتك" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        <span className="small muted">تُراجَع من المدرب ولا تُحتسب في الدرجة.</span>
      </label>
    );
  }
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="visually-hidden">إجابتك</span>
      <textarea className="gf-text" rows={4} maxLength={2000} placeholder="اكتب إجابتك هنا…" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
      <span className="small muted">تُراجَع من المدرب ولا تُحتسب في الدرجة.</span>
    </label>
  );
}

/** What the learner answered, as readable text. */
function answerText(q: QuizResultQuestion): string | null {
  const a = q.your_answer;
  if (a === null) return null;
  if (q.type === 'MCQ') return typeof a === 'number' ? (q.options[a] ?? null) : null;
  if (q.type === 'CHECKBOX') return Array.isArray(a) ? a.map((i) => q.options[i]).filter(Boolean).join('، ') : null;
  if (q.type === 'RATING') return typeof a === 'number' ? `${'★'.repeat(a)}${'☆'.repeat(5 - a)} (${a} من 5)` : null;
  return typeof a === 'string' ? a : null;
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
          <p className="notice small">هذا الاختبار أسئلته كتابية أو تقييمات فقط: أُرسلت إجاباتك للمدرب ولا درجة آلية له.</p>
        )}
      </header>
      {result.questions.map((q, i) => {
        const mine = answerText(q);
        return (
          <article key={q.id} className={`gf-card gf-review ${q.is_correct === null ? 'text' : q.is_correct ? 'right' : 'wrong'}`}>
            <p>
              <b>
                {i + 1}. {q.body}
              </b>
            </p>
            <p className="small">
              إجابتك: {mine ? <span>{mine}</span> : <span className="muted">لم تُجب</span>}{' '}
              {q.is_correct !== null && (
                <span className={`badge ${q.is_correct ? 'ok' : 'draft'}`}>
                  {q.is_correct ? 'صحيحة' : 'غير صحيحة'} · {q.earned}/{q.points}
                </span>
              )}
            </p>
            {q.is_correct === false && q.type === 'MCQ' && (
              <p className="small">
                الإجابة الصحيحة: <b>{q.correct_answer}</b>
              </p>
            )}
            {q.is_correct === false && q.type === 'CHECKBOX' && (
              <p className="small">
                الإجابات الصحيحة: <b>{q.correct_options.join('، ')}</b>
              </p>
            )}
            {(q.type === 'SHORT' || q.type === 'TEXT') && q.correct_answer && (
              <p className="small">
                الإجابة النموذجية: <b>{q.correct_answer}</b>
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
