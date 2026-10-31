'use client';

import { useState, useTransition } from 'react';
import type { ExamPaper, ExamResult, ExamStatus, HealthSectorSummary } from '@/lib/api';
import { requestExamCodeAction, startExamAction, submitExamAction } from '@/lib/health-actions';

const nf = new Intl.NumberFormat('ar-SA');
const when = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' });
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

type Phase =
  | { name: 'pick' }
  | { name: 'code'; sectorId: string; challengeId: string }
  | { name: 'exam'; paper: ExamPaper }
  | { name: 'result'; result: ExamResult };

/**
 * Official exam (strict mode): choose a sector, confirm with the code e-mailed to the account, answer the
 * drawn questions, see the score. Attempts are capped per day; the server enforces everything shown here.
 */
export function ExamPortal({ slug, sectors, status }: { slug: string; sectors: HealthSectorSummary[]; status: ExamStatus }) {
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [quota, setQuota] = useState(status.quota);
  const [history, setHistory] = useState(status.history);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [code, setCode] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const sectorName = new Map(sectors.map((s) => [s.id, s.name]));
  const locked = quota.remaining <= 0;

  const sendCode = (sectorId: string) => {
    setError(null);
    start(async () => {
      const r = await requestExamCodeAction(slug, sectorId);
      if (!r.ok) return setError(r.error);
      setCode('');
      setPhase({ name: 'code', sectorId, challengeId: r.challengeId });
    });
  };

  const begin = (p: Extract<Phase, { name: 'code' }>) => {
    setError(null);
    start(async () => {
      const r = await startExamAction(slug, { sectorId: p.sectorId, challengeId: p.challengeId, code });
      if (!r.ok) return setError(r.error);
      setAnswers({});
      setQuota((q) => ({ ...q, used: q.used + 1, remaining: Math.max(q.remaining - 1, 0) }));
      setHistory((h) => [{ id: r.exam.id, sector_id: r.exam.sector_id, score: null, total: r.exam.questions.length, started_at: r.exam.started_at, submitted_at: null }, ...h]);
      setPhase({ name: 'exam', paper: r.exam });
      window.scrollTo({ top: 0 });
    });
  };

  const submit = (paper: ExamPaper) => {
    setError(null);
    start(async () => {
      const r = await submitExamAction(slug, paper.id, answers);
      if (!r.ok) return setError(r.error);
      setHistory((h) => h.map((e) => (e.id === paper.id ? { ...e, score: r.result.score, submitted_at: r.result.submitted_at } : e)));
      setPhase({ name: 'result', result: r.result });
      window.scrollTo({ top: 0 });
    });
  };

  if (phase.name === 'exam') {
    const { paper } = phase;
    const answered = paper.questions.filter((q) => answers[q.id]).length;
    return (
      <section className="stack" aria-label="الاختبار">
        <div className="notice" role="status">
          اختبار قطاع «{sectorName.get(paper.sector_id ?? '') ?? ''}» · {nf.format(paper.questions.length)} سؤالاً · أجبت عن {nf.format(answered)}. لا تغلق الصفحة؛ المحاولة محسوبة من لحظة البدء.
        </div>
        {paper.questions.map((q, i) => (
          <fieldset key={q.id} className="card hl-review" style={{ margin: 0 }}>
            <legend className="small muted">السؤال {nf.format(i + 1)}</legend>
            <h3>{q.body}</h3>
            <div className="hl-options">
              {q.options.map((o, idx) => (
                <label key={o} className={`hl-option${answers[q.id] === o ? ' right' : ''}`} style={{ cursor: 'pointer' }}>
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === o} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o }))} style={{ marginInlineEnd: 4 }} />
                  <span className="hl-letter" aria-hidden="true">{LETTERS[idx]}</span>
                  <span>{o}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              if (answered < paper.questions.length && !window.confirm(`لم تُجب عن ${nf.format(paper.questions.length - answered)} سؤال. تسليم الاختبار الآن؟`)) return;
              submit(paper);
            }}
          >
            {pending ? 'جارٍ التسليم…' : 'تسليم الاختبار'}
          </button>
        </div>
      </section>
    );
  }

  if (phase.name === 'result') {
    const { result } = phase;
    return (
      <section className="stack" aria-label="نتيجة الاختبار">
        <div className="card stack hl-result" aria-live="polite">
          <h2>نتيجتك</h2>
          <p className="hl-score">
            {nf.format(result.score)} / {nf.format(result.total)} <span>({nf.format(result.percent)}٪)</span>
          </p>
          <p className="muted">{result.percent >= 80 ? 'نتيجة ممتازة.' : result.percent >= 60 ? 'نتيجة جيدة.' : 'تحتاج إلى مزيد من المذاكرة.'}</p>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => setPhase({ name: 'pick' })}>
              العودة
            </button>
          </div>
        </div>
        {result.questions.map((q, i) => (
          <article key={q.id} className="card hl-review">
            <h3>
              {nf.format(i + 1)}. {q.body}
            </h3>
            <ul className="hl-answers">
              {q.options.map((o) => (
                <li key={o} className={o === q.correct_option ? 'right' : ''} style={o === q.your_answer && !q.correct ? { borderColor: 'var(--danger)', background: 'var(--danger-soft)' } : undefined}>
                  {o}
                  {o === q.correct_option && <span className="sr-only"> (الإجابة الصحيحة)</span>}
                  {o === q.your_answer && <span className="small muted"> · إجابتك</span>}
                </li>
              ))}
            </ul>
            {q.your_answer === null && <p className="small muted">لم تجب عن هذا السؤال.</p>}
            {q.explanation && <p className="small hl-explain">{q.explanation}</p>}
          </article>
        ))}
      </section>
    );
  }

  if (phase.name === 'code') {
    return (
      <section className="card stack" aria-label="تأكيد الهوية">
        <h2>أكّد أنك صاحب الحساب</h2>
        <p>
          أرسلنا رمزاً من ٦ أرقام إلى بريدك المسجّل. اكتبه لبدء اختبار قطاع «{sectorName.get(phase.sectorId) ?? ''}». الرمز صالح ١٠ دقائق ويعمل مرة واحدة.
        </p>
        <label htmlFor="exam-code">
          الرمز
          <input id="exam-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" autoFocus placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }} />
        </label>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={pending || code.length !== 6} onClick={() => begin(phase)}>
            {pending ? 'جارٍ البدء…' : 'ابدأ الاختبار'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => sendCode(phase.sectorId)}>
            إعادة إرسال الرمز
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setPhase({ name: 'pick' })}>
            رجوع
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="hl-stats" role="group" aria-label="محاولاتك">
        <div><strong>{nf.format(quota.remaining)}</strong><span>محاولة متبقية اليوم</span></div>
        <div><strong>{nf.format(quota.limit)}</strong><span>الحد الأقصى اليومي</span></div>
        <div><strong>{nf.format(status.questions_per_exam)}</strong><span>سؤالاً في الاختبار</span></div>
      </div>

      {locked && (
        <div className="notice error" role="alert">
          وصلت إلى الحد الأقصى للاختبارات اليومية{quota.next_allowed_at ? `. يُفتح لك الاختبار بعد ${when.format(new Date(quota.next_allowed_at))}` : ''}.
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      <section className="stack" aria-label="اختر القطاع">
        <h2>اختر قطاعك</h2>
        <p className="muted">تظهر لك أسئلة القطاع الذي تختاره فقط، بترتيب عشوائي في كل مرة. قبل البدء نرسل رمزاً إلى بريدك للتأكد أنك صاحب الحساب.</p>
        <div className="grid">
          {sectors.map((s) => (
            <article key={s.id} className="card stack">
              <h3>{s.name}</h3>
              {s.title && <p className="small muted">{s.title}</p>}
              <span className="badge">{nf.format(s.question_count)} سؤالاً في البنك</span>
              <div>
                <button type="button" className="btn btn-primary" disabled={pending || locked} onClick={() => sendCode(s.id)}>
                  {pending ? 'جارٍ إرسال الرمز…' : 'ابدأ الاختبار'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="stack" aria-label="سجل المحاولات">
        <h2>سجل محاولاتك</h2>
        {history.length === 0 ? (
          <div className="card empty">لم تُجرِ أي اختبار بعد.</div>
        ) : (
          <ul className="hl-history">
            {history.map((h) => (
              <li key={h.id} className="card">
                <div>
                  <strong>{sectorName.get(h.sector_id ?? '') ?? 'قطاع'}</strong>
                  <span className="small muted">{when.format(new Date(h.started_at))}</span>
                </div>
                {h.submitted_at ? (
                  <span className={`badge ${(h.score ?? 0) / h.total >= 0.8 ? 'ok' : ''}`}>
                    {nf.format(h.score ?? 0)} / {nf.format(h.total)} ({nf.format(Math.round(((h.score ?? 0) / h.total) * 100))}٪)
                  </span>
                ) : (
                  <span className="badge">غير مُسلَّم</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
