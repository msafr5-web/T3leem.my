'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { HealthProgress, HealthQuestion, HealthSectorSummary, PracticeQuestion } from '@/lib/api';
import { answerAction, loadQuestionsAction, recordSessionAction, setQuestionStateAction, startPracticeAction } from '@/lib/health-actions';

type Tab = 'review' | 'practice' | 'history';

interface Run {
  questions: PracticeQuestion[];
  step: number;
  picked: string | null;
  feedback: { correct: boolean; correctOption: string; explanation: string } | null;
  score: number;
  missed: string[];
  sectorId: string | null;
  sessionId: string;
  done: boolean;
}

const nf = new Intl.NumberFormat('ar-SA');
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

const newSessionId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

export function HealthStudy({ slug, sectors, progress }: { slug: string; sectors: HealthSectorSummary[]; progress: HealthProgress }) {
  const [tab, setTab] = useState<Tab>('practice');
  const [favorites, setFavorites] = useState(() => new Set(progress.favorites));
  const [read, setRead] = useState(() => new Set(progress.read));
  const [history, setHistory] = useState(progress.history);
  const [totals, setTotals] = useState({ answered: progress.answered, correct: progress.correct, sessions: progress.sessions });
  const sectorName = useMemo(() => new Map(sectors.map((s) => [s.id, s.name])), [sectors]);

  const toggleFavorite = useCallback(
    async (id: string) => {
      const next = !favorites.has(id);
      setFavorites((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(id);
        else copy.delete(id);
        return copy;
      });
      const r = await setQuestionStateAction(slug, id, { favorite: next });
      if (r.error) setFavorites((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(id);
        else copy.add(id);
        return copy;
      });
    },
    [favorites, slug],
  );

  const markRead = useCallback((id: string) => setRead((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="hl-stats" role="group" aria-label="تقدمك">
        <div><strong>{nf.format(totals.sessions)}</strong><span>جلسة تدريب</span></div>
        <div><strong>{nf.format(totals.answered)}</strong><span>سؤالاً أُجيب</span></div>
        <div><strong>{totals.answered ? `${nf.format(Math.round((totals.correct / totals.answered) * 100))}٪` : '—'}</strong><span>نسبة الصواب</span></div>
        <div><strong>{nf.format(favorites.size)}</strong><span>في المفضلة</span></div>
      </div>

      <div className="hl-tabs" role="tablist" aria-label="أقسام التدريب">
        {([['practice', 'تدريب'], ['review', 'مراجعة الأسئلة'], ['history', 'سجل التدريب']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'practice' && (
        <Practice
          slug={slug}
          sectors={sectors}
          favoriteCount={favorites.size}
          onFinished={(r) => {
            setTotals((t) => ({ answered: t.answered + r.total, correct: t.correct + r.correct, sessions: t.sessions + 1 }));
            setHistory((h) => [{ id: r.id, sector_id: r.sectorId, total: r.total, correct: r.correct, created_at: new Date().toISOString() }, ...h].slice(0, 30));
          }}
          onAnswered={markRead}
        />
      )}
      {tab === 'review' && <Review slug={slug} sectors={sectors} favorites={favorites} read={read} onFavorite={toggleFavorite} onRead={markRead} />}
      {tab === 'history' && (
        <section className="stack" aria-label="سجل التدريب">
          {history.length === 0 ? (
            <div className="card empty">لم تُجرِ أي جلسة تدريب بعد.</div>
          ) : (
            <ul className="hl-history">
              {history.map((h) => (
                <li key={h.id} className="card">
                  <div>
                    <strong>{h.sector_id ? (sectorName.get(h.sector_id) ?? 'قطاع') : 'كل القطاعات'}</strong>
                    <span className="small muted">{new Date(h.created_at).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                  <span className={`badge ${h.correct / h.total >= 0.8 ? 'ok' : ''}`}>
                    {nf.format(h.correct)} / {nf.format(h.total)} ({nf.format(Math.round((h.correct / h.total) * 100))}٪)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Practice({
  slug,
  sectors,
  favoriteCount,
  onFinished,
  onAnswered,
}: {
  slug: string;
  sectors: HealthSectorSummary[];
  favoriteCount: number;
  onFinished: (r: { id: string; sectorId: string | null; total: number; correct: number }) => void;
  onAnswered: (id: string) => void;
}) {
  const [sectorId, setSectorId] = useState('');
  const [count, setCount] = useState(10);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [pending, startTransition] = useTransition();
  const [checking, setChecking] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const begin = (override?: { questions: PracticeQuestion[]; sectorId: string | null }) => {
    setError(null);
    const launch = (questions: PracticeQuestion[], sector: string | null) => {
      setRun({ questions, step: 0, picked: null, feedback: null, score: 0, missed: [], sectorId: sector, sessionId: newSessionId(), done: false });
      topRef.current?.scrollIntoView({ block: 'start' });
    };
    if (override) return launch(override.questions, override.sectorId);
    startTransition(async () => {
      const r = await startPracticeAction(slug, { sectorId: sectorId || null, count, favoritesOnly });
      if (!r.ok) setError(r.error);
      else launch(r.questions, sectorId || null);
    });
  };

  const choose = async (option: string) => {
    if (!run || run.picked !== null || checking) return;
    const q = run.questions[run.step]!;
    setChecking(true);
    const r = await answerAction(slug, q.id, option);
    setChecking(false);
    if (!r.ok) return setError(r.error);
    onAnswered(q.id);
    setRun({ ...run, picked: option, feedback: r, score: run.score + (r.correct ? 1 : 0), missed: r.correct ? run.missed : [...run.missed, q.id] });
  };

  const next = async () => {
    if (!run) return;
    if (run.step + 1 < run.questions.length) return setRun({ ...run, step: run.step + 1, picked: null, feedback: null });
    setRun({ ...run, done: true });
    const summary = { id: run.sessionId, sectorId: run.sectorId, total: run.questions.length, correct: run.score };
    onFinished(summary);
    await recordSessionAction(slug, { clientSessionId: run.sessionId, sectorId: run.sectorId, total: summary.total, correct: summary.correct });
  };

  // Keyboard: 1-6 choose an option, Enter / Space continues once answered.
  useEffect(() => {
    if (!run || run.done) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      const q = run.questions[run.step];
      if (run.picked === null && q && /^[1-6]$/.test(e.key) && Number(e.key) <= q.options.length) void choose(q.options[Number(e.key) - 1]!);
      else if (run.picked !== null && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        void next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!run) {
    return (
      <section className="card stack" aria-label="إعداد جلسة التدريب">
        <h2>ابدأ جلسة تدريب</h2>
        <div className="hl-setup">
          <label>
            القطاع
            <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
              <option value="">كل القطاعات</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({nf.format(s.question_count)})
                </option>
              ))}
            </select>
          </label>
          <label>
            عدد الأسئلة
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[5, 10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>
                  {nf.format(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={favoritesOnly} disabled={favoriteCount === 0} onChange={(e) => setFavoritesOnly(e.target.checked)} />
          من المفضلة فقط ({nf.format(favoriteCount)})
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div>
          <button type="button" className="btn btn-primary" onClick={() => begin()} disabled={pending}>
            {pending ? 'جارٍ التحضير…' : 'ابدأ التدريب'}
          </button>
        </div>
        <p className="small muted">تُخلط الأسئلة والخيارات في كل مرة، ويظهر لك الشرح بعد كل إجابة.</p>
      </section>
    );
  }

  if (run.done) {
    const total = run.questions.length;
    const percent = Math.round((run.score / total) * 100);
    const missedQuestions = run.questions.filter((q) => run.missed.includes(q.id));
    return (
      <section className="card stack hl-result" aria-live="polite">
        <div ref={topRef} />
        <h2>انتهت الجلسة</h2>
        <p className="hl-score">
          {nf.format(run.score)} / {nf.format(total)} <span>({nf.format(percent)}٪)</span>
        </p>
        <p className="muted">{percent >= 80 ? 'أداء ممتاز، استمر على هذا المستوى.' : percent >= 60 ? 'أداء جيد، راجع الأسئلة التي أخطأت فيها.' : 'تحتاج إلى مزيد من المراجعة، جرّب إعادة الأسئلة الخاطئة.'}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {missedQuestions.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={() => begin({ questions: missedQuestions, sectorId: run.sectorId })}>
              إعادة الأسئلة الخاطئة ({nf.format(missedQuestions.length)})
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setRun(null)}>
            جلسة جديدة
          </button>
        </div>
      </section>
    );
  }

  const q = run.questions[run.step]!;
  const total = run.questions.length;
  return (
    <section className="card stack" aria-label="جلسة التدريب">
      <div ref={topRef} />
      <div className="hl-progress" aria-hidden="true">
        <span style={{ width: `${((run.step + (run.picked !== null ? 1 : 0)) / total) * 100}%` }} />
      </div>
      <p className="small muted">
        السؤال {nf.format(run.step + 1)} من {nf.format(total)} · الصحيحة {nf.format(run.score)}
      </p>
      <h2 className="hl-question">{q.body}</h2>
      <div className="hl-options" role="group" aria-label="الخيارات">
        {q.options.map((o, i) => {
          const state = run.picked === null ? '' : o === run.feedback?.correctOption ? 'right' : o === run.picked ? 'wrong' : 'dim';
          return (
            <button key={o} type="button" className={`hl-option ${state}`} onClick={() => void choose(o)} disabled={run.picked !== null || checking} aria-pressed={run.picked === o}>
              <span className="hl-letter" aria-hidden="true">{LETTERS[i]}</span>
              <span>{o}</span>
              {state === 'right' && <span className="hl-mark" aria-label="الإجابة الصحيحة">✓</span>}
              {state === 'wrong' && <span className="hl-mark" aria-label="إجابة خاطئة">✗</span>}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {run.feedback && (
        <div className={`notice ${run.feedback.correct ? 'ok' : 'error'}`} role="status">
          <strong>{run.feedback.correct ? 'إجابة صحيحة' : 'إجابة خاطئة'}</strong>
          {!run.feedback.correct && <> — الصحيح: {run.feedback.correctOption}</>}
          {run.feedback.explanation && <p style={{ margin: '6px 0 0' }}>{run.feedback.explanation}</p>}
        </div>
      )}
      {run.picked !== null && (
        <div>
          <button type="button" className="btn btn-primary" onClick={() => void next()} autoFocus>
            {run.step + 1 < total ? 'السؤال التالي' : 'عرض النتيجة'}
          </button>
        </div>
      )}
    </section>
  );
}

function Review({
  slug,
  sectors,
  favorites,
  read,
  onFavorite,
  onRead,
}: {
  slug: string;
  sectors: HealthSectorSummary[];
  favorites: Set<string>;
  read: Set<string>;
  onFavorite: (id: string) => void;
  onRead: (id: string) => void;
}) {
  const [sectorId, setSectorId] = useState('');
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [items, setItems] = useState<HealthQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      const r = await loadQuestionsAction(slug, { sectorId: sectorId || null, search, offset });
      if (id !== requestId.current) return;
      setLoading(false);
      if (!r.ok) return setError(r.error);
      setTotal(r.page.total);
      setItems((prev) => (replace ? r.page.questions : [...prev, ...r.page.questions]));
    },
    [slug, sectorId, search],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(0, true), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const shown = onlyFavorites ? items.filter((q) => favorites.has(q.id)) : items;

  return (
    <section className="stack" aria-label="مراجعة الأسئلة">
      <div className="hl-filters">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في الأسئلة…" aria-label="بحث" maxLength={100} />
        <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} aria-label="القطاع">
          <option value="">كل القطاعات</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />
          المفضلة فقط
        </label>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {!loading && shown.length === 0 && <div className="card empty">لا توجد أسئلة مطابقة.</div>}
      <div className="stack" style={{ gap: 12 }}>
        {shown.map((q, i) => (
          <article key={q.id} className="card hl-review">
            <header>
              <span className="small muted">
                {sectors.find((s) => s.id === q.sector_id)?.name} · {nf.format(i + 1)}
              </span>
              <span className="hl-review-actions">
                {read.has(q.id) && <span className="badge">اطّلعت</span>}
                <button type="button" className={`hl-star${favorites.has(q.id) ? ' on' : ''}`} onClick={() => onFavorite(q.id)} aria-pressed={favorites.has(q.id)} aria-label={favorites.has(q.id) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}>
                  {favorites.has(q.id) ? '★' : '☆'}
                </button>
              </span>
            </header>
            <h3>{q.body}</h3>
            <ul className="hl-answers">
              {q.options.map((o, idx) => (
                <li key={o} className={idx === q.correct_index ? 'right' : ''}>
                  <span className="hl-letter" aria-hidden="true">{LETTERS[idx]}</span> {o}
                  {idx === q.correct_index && <span className="sr-only"> (الإجابة الصحيحة)</span>}
                </li>
              ))}
            </ul>
            {q.explanation && <p className="small hl-explain">{q.explanation}</p>}
            {!read.has(q.id) && (
              <div>
                <button type="button" className="btn btn-ghost" onClick={() => { onRead(q.id); void setQuestionStateAction(slug, q.id, { read: true }); }}>
                  تمت المراجعة
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {items.length < total && (
        <div>
          <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load(items.length, false)}>
            {loading ? 'جارٍ التحميل…' : `عرض المزيد (${nf.format(total - items.length)})`}
          </button>
        </div>
      )}
    </section>
  );
}
