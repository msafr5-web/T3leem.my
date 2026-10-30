'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { saveQuizFormAction } from '@/lib/admin-actions';
import { formatNumber } from '@/lib/format';
import { LIMITS, QUESTION_TYPES, blankQuestion, buildPayload, duplicateOf, fingerprint, hasOptions, isGraded, validateQuestion, type BuilderQuestion, type Difficulty, type QuestionType } from './builder-model';

const SHARED = 'shared';
const DIFFICULTY: Record<Difficulty, string> = { EASY: 'سهل', MEDIUM: 'متوسط', HARD: 'صعب' };

interface Props {
  slug: string;
  courseId: string;
  days: { id: string; title: string }[];
  initial: BuilderQuestion[];
  perLearner: number;
  durationMinutes: number;
}

type Status = { kind: 'idle' | 'saving' | 'saved' | 'error'; text: string };

const focusField = (key: string, field: string) =>
  setTimeout(() => {
    document.querySelector<HTMLElement>(`[data-q="${key}"] [data-field="${field}"]`)?.focus();
  }, 0);

const scrollToQuestion = (key: string) =>
  setTimeout(() => {
    document.querySelector<HTMLElement>(`[data-q="${key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 0);

/**
 * A Google-Forms-style editor for a course's end-of-day quizzes: one card per question, a tab per
 * course day (like a form's sections), add/duplicate/delete, answer key by clicking the right
 * option, a learner preview, and one Save that sends only what changed.
 */
export function QuizFormBuilder({ slug, courseId, days, initial, perLearner, durationMinutes }: Props) {
  const [questions, setQuestions] = useState<BuilderQuestion[]>(initial);
  const [savedMap, setSavedMap] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((q) => [q.key, fingerprint(q)])));
  const [deleted, setDeleted] = useState<string[]>([]);
  const [tab, setTab] = useState<string>(days[0]?.id ?? SHARED);
  const [activeKey, setActiveKey] = useState<string | null>(initial.find((q) => (q.dayId ?? SHARED) === (days[0]?.id ?? SHARED))?.key ?? null);
  const [preview, setPreview] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [undo, setUndo] = useState<{ q: BuilderQuestion; index: number } | null>(null);

  const saving = status.kind === 'saving';
  const savedLookup = useMemo(() => new Map(Object.entries(savedMap)), [savedMap]);
  const payload = useMemo(() => buildPayload(questions, savedLookup, deleted), [questions, savedLookup, deleted]);
  const dirty = payload.upserts.length > 0 || payload.deletes.length > 0;

  const dayOf = (q: BuilderQuestion) => q.dayId ?? SHARED;
  const inTab = useMemo(() => questions.filter((q) => dayOf(q) === tab), [questions, tab]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of questions) m.set(dayOf(q), (m.get(dayOf(q)) ?? 0) + 1);
    return m;
  }, [questions]);
  const sharedCount = counts.get(SHARED) ?? 0;
  const uncovered = days.filter((d) => !counts.get(d.id));
  const tabTitle = tab === SHARED ? 'الأسئلة المشتركة' : (days.find((d) => d.id === tab)?.title ?? '');

  // ---- editing -------------------------------------------------------------------------------

  // Any edit makes an old "saved" or error message stale; the "unsaved changes" label takes over.
  const touch = () => setStatus((s) => (s.kind === 'saving' || s.kind === 'idle' ? s : { kind: 'idle', text: '' }));

  const patch = (key: string, change: Partial<BuilderQuestion>) => {
    touch();
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...change } : q)));
  };

  const addQuestion = () => {
    touch();
    const q = blankQuestion(tab === SHARED ? null : tab);
    setQuestions((qs) => {
      const at = activeKey ? qs.findIndex((x) => x.key === activeKey && dayOf(x) === tab) : -1;
      if (at < 0) return [...qs, q];
      return [...qs.slice(0, at + 1), q, ...qs.slice(at + 1)];
    });
    setPreview(false);
    setActiveKey(q.key);
    scrollToQuestion(q.key);
    focusField(q.key, 'body');
  };

  const changeType = (q: BuilderQuestion, type: QuestionType) => {
    if (type === q.type) return;
    patch(q.key, {
      type,
      options: q.options.length >= LIMITS.minOptions ? q.options : ['', ''],
      // Carry the answer key across the two choice types instead of losing it.
      corrects: type === 'CHECKBOX' && q.type === 'MCQ' && q.correct >= 0 ? [q.correct] : q.corrects,
      correct: type === 'MCQ' && q.type === 'CHECKBOX' ? (q.corrects[0] ?? -1) : q.correct,
    });
  };

  const addOption = (q: BuilderQuestion) => {
    if (q.options.length >= LIMITS.maxOptions) return;
    patch(q.key, { options: [...q.options, ''] });
    focusField(q.key, `option-${q.options.length}`);
  };

  const removeOption = (q: BuilderQuestion, i: number) => {
    if (q.options.length <= LIMITS.minOptions) return;
    // Removing the right answer leaves none selected, so the supervisor must choose again on purpose.
    const correct = i < q.correct ? q.correct - 1 : i === q.correct ? -1 : q.correct;
    const corrects = q.corrects.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
    patch(q.key, { options: q.options.filter((_, j) => j !== i), correct, corrects });
  };

  const optionKey = (q: BuilderQuestion, i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (i < q.options.length - 1) focusField(q.key, `option-${i + 1}`);
      else addOption(q);
    } else if (e.key === 'Backspace' && e.currentTarget.value === '' && q.options.length > LIMITS.minOptions) {
      e.preventDefault();
      removeOption(q, i);
      focusField(q.key, `option-${Math.max(0, i - 1)}`);
    }
  };

  const duplicate = (q: BuilderQuestion) => {
    touch();
    const copy = duplicateOf(q);
    setQuestions((qs) => {
      const at = qs.findIndex((x) => x.key === q.key);
      return [...qs.slice(0, at + 1), copy, ...qs.slice(at + 1)];
    });
    setActiveKey(copy.key);
    scrollToQuestion(copy.key);
    focusField(copy.key, 'body');
  };

  const remove = (q: BuilderQuestion) => {
    touch();
    const index = questions.findIndex((x) => x.key === q.key);
    setQuestions((qs) => qs.filter((x) => x.key !== q.key));
    if (q.id) setDeleted((d) => [...d, q.id as string]);
    setUndo({ q, index });
    setActiveKey(null);
  };

  const undoRemove = () => {
    if (!undo) return;
    touch();
    const { q, index } = undo;
    setQuestions((qs) => [...qs.slice(0, index), q, ...qs.slice(index)]);
    if (q.id) setDeleted((d) => d.filter((id) => id !== q.id));
    setActiveKey(q.key);
    setUndo(null);
  };

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  // A link such as #quiz-day-<dayId> (from the schedule) opens that day's tab and scrolls to the form.
  useEffect(() => {
    const open = () => {
      const m = /^#quiz-day-(.+)$/.exec(window.location.hash);
      if (!m || !days.some((d) => d.id === m[1])) return;
      setTab(m[1] as string);
      setPreview(false);
      document.getElementById('quiz-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [days]);

  // ---- saving --------------------------------------------------------------------------------

  const save = useCallback(async () => {
    if (saving) return;
    const invalid = questions.filter((q) => validateQuestion(q));
    if (invalid.length > 0) {
      const first = invalid[0] as BuilderQuestion;
      setShowErrors(true);
      setPreview(false);
      setTab(dayOf(first));
      setActiveKey(first.key);
      scrollToQuestion(first.key);
      setStatus({ kind: 'error', text: `يوجد ${formatNumber(invalid.length)} ${invalid.length === 1 ? 'سؤال يحتاج' : 'أسئلة تحتاج'} إلى تصحيح قبل الحفظ.` });
      return;
    }
    if (!dirty) {
      setStatus({ kind: 'saved', text: 'لا توجد تغييرات جديدة.' });
      return;
    }
    setStatus({ kind: 'saving', text: 'جارٍ الحفظ…' });
    setFailedKey(null);
    const res = await saveQuizFormAction(slug, courseId, JSON.stringify(payload)).catch(() => null);
    if (!res) {
      setStatus({ kind: 'error', text: 'تعذّر الاتصال بالخادم. تغييراتك ما زالت هنا، حاول مرة أخرى.' });
      return;
    }
    // Questions created before a failure already exist on the server: remember their ids so a retry updates instead of duplicating.
    const withIds = questions.map((q) => (res.created[q.key] ? { ...q, id: res.created[q.key] as string } : q));
    setQuestions(withIds);
    if (res.ok) {
      setSavedMap(Object.fromEntries(withIds.map((q) => [q.key, fingerprint(q)])));
      setDeleted([]);
      setShowErrors(false);
      setStatus({ kind: 'saved', text: `تم الحفظ ${new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date())}` });
      return;
    }
    setSavedMap((m) => ({ ...m, ...Object.fromEntries(withIds.filter((q) => res.created[q.key]).map((q) => [q.key, fingerprint(q)])) }));
    if (res.failedKey) {
      const failed = withIds.find((q) => q.key === res.failedKey);
      setFailedKey(res.failedKey);
      if (failed) {
        setTab(dayOf(failed));
        setActiveKey(failed.key);
        scrollToQuestion(failed.key);
      }
    }
    setStatus({ kind: 'error', text: res.error ?? 'تعذّر الحفظ.' });
  }, [saving, questions, dirty, payload, slug, courseId]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---- render --------------------------------------------------------------------------------

  const tabs = [...days.map((d) => ({ id: d.id, title: d.title })), { id: SHARED, title: 'أسئلة مشتركة' }];

  return (
    <div className="qb" id="quiz-form">
      <div className="qb-bar">
        <strong className="qb-bar-title">نموذج الأسئلة</strong>
        <span className={`qb-status ${status.kind}`} role="status" aria-live="polite">
          {dirty && status.kind !== 'saving' && status.kind !== 'error' ? 'تغييرات غير محفوظة' : status.text}
        </span>
        <button type="button" className="btn btn-ghost" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? 'العودة للتحرير' : 'معاينة'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'جارٍ الحفظ…' : 'حفظ الأسئلة'}
        </button>
      </div>

      <p className="muted small qb-note">
        في نهاية كل يوم يُسحب لكل متدرب {formatNumber(perLearner)} {perLearner === 1 ? 'سؤال' : 'أسئلة'} عشوائياً من أسئلة ذلك اليوم خلال {formatNumber(durationMinutes)} دقيقة، بمحاولة واحدة. الأيام التي بلا أسئلة تُسحب أسئلتها من «الأسئلة المشتركة». عدّل المدة والعدد من «إعدادات الاختبار» أدناه.
      </p>

      {questions.length > 0 && uncovered.length > 0 && sharedCount === 0 && (
        <p className="notice sandbox small">
          لا أسئلة لـ{uncovered.map((d) => d.title).join('، ')} ولا أسئلة مشتركة، فلن يظهر اختبار في هذه الأيام.
        </p>
      )}

      <div className="qb-tabs" role="tablist" aria-label="أيام الدورة">
        {tabs.map((t) => {
          const n = counts.get(t.id) ?? 0;
          return (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="qb-panel" className={`qb-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
              {t.title}
              <span className={`badge ${n > 0 ? 'ok' : t.id === SHARED ? '' : 'draft'}`}>{formatNumber(n)}</span>
            </button>
          );
        })}
      </div>

      <div className="qb-layout">
        <div id="qb-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="qb-list">
          {preview ? (
            <Preview title={tabTitle} questions={inTab} />
          ) : (
            <fieldset className="qb-fieldset" disabled={saving}>
              <legend className="visually-hidden">أسئلة {tabTitle}</legend>
              {inTab.length === 0 && (
                <div className="qb-empty">
                  <p>
                    <strong>لا أسئلة في {tabTitle} بعد.</strong>
                  </p>
                  <p className="small muted">
                    {tab !== SHARED && sharedCount > 0 ? `سيحصل المتدربون في هذا اليوم على أسئلة من المجموعة المشتركة (${formatNumber(sharedCount)}).` : 'أضف أول سؤال لهذا اليوم.'}
                  </p>
                  <button type="button" className="btn btn-primary" onClick={addQuestion}>
                    + إضافة سؤال
                  </button>
                </div>
              )}
              {inTab.map((q, i) => (
                <QuestionCard
                  key={q.key}
                  q={q}
                  index={i}
                  active={activeKey === q.key}
                  failed={failedKey === q.key}
                  error={showErrors || failedKey === q.key ? validateQuestion(q) : null}
                  days={days}
                  onActivate={() => setActiveKey(q.key)}
                  onPatch={(c) => patch(q.key, c)}
                  onType={(t) => changeType(q, t)}
                  onAddOption={() => addOption(q)}
                  onRemoveOption={(j) => removeOption(q, j)}
                  onOptionKey={(j, e) => optionKey(q, j, e)}
                  onDuplicate={() => duplicate(q)}
                  onDelete={() => remove(q)}
                />
              ))}
            </fieldset>
          )}
        </div>

        <div className="qb-tools" role="toolbar" aria-label="أدوات النموذج">
          <button type="button" className="qb-tool" onClick={addQuestion} title="إضافة سؤال" aria-label="إضافة سؤال">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </button>
          <a href="#quiz-import" className="qb-tool" title="استيراد من Excel" aria-label="استيراد الأسئلة من Excel">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5M9 13l4 4m0-4l-4 4" />
            </svg>
          </a>
          <button type="button" className="qb-tool" aria-pressed={preview} onClick={() => setPreview((p) => !p)} title="معاينة" aria-label="معاينة كما يراها المتدرب">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>

      {undo && (
        <div className="qb-toast" role="status">
          حُذف السؤال.{' '}
          <button type="button" onClick={undoRemove}>
            تراجع
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  q,
  index,
  active,
  failed,
  error,
  days,
  onActivate,
  onPatch,
  onType,
  onAddOption,
  onRemoveOption,
  onOptionKey,
  onDuplicate,
  onDelete,
}: {
  q: BuilderQuestion;
  index: number;
  active: boolean;
  failed: boolean;
  error: string | null;
  days: { id: string; title: string }[];
  onActivate: () => void;
  onPatch: (change: Partial<BuilderQuestion>) => void;
  onType: (t: QuestionType) => void;
  onAddOption: () => void;
  onRemoveOption: (i: number) => void;
  onOptionKey: (i: number, e: KeyboardEvent<HTMLInputElement>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const n = formatNumber(index + 1);
  return (
    <article className={`qb-card${active ? ' active' : ''}${error ? ' invalid' : ''}${failed ? ' failed' : ''}`} data-q={q.key} onFocusCapture={onActivate} onClick={onActivate} aria-label={`السؤال ${n}`}>
      <div className="qb-card-top">
        <span className="qb-num" aria-hidden="true">
          {n}
        </span>
        <textarea
          data-field="body"
          className="qb-title"
          rows={1}
          maxLength={LIMITS.body}
          placeholder="نص السؤال"
          aria-label={`نص السؤال ${n}`}
          aria-invalid={error ? true : undefined}
          value={q.body}
          onChange={(e) => onPatch({ body: e.target.value })}
        />
        {q.required && (
          <span className="qb-req" title="سؤال مطلوب" aria-label="سؤال مطلوب">
            *
          </span>
        )}
        <select data-field="type" className="qb-type" aria-label={`نوع السؤال ${n}`} value={q.type} onChange={(e) => onType(e.target.value as QuestionType)}>
          {QUESTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {hasOptions(q.type) ? (
        <div className="qb-options">
          {q.options.map((o, i) => {
            const right = q.type === 'MCQ' ? q.correct === i : q.corrects.includes(i);
            return (
              <div key={i} className={`qb-opt${right ? ' correct' : ''}`}>
                {q.type === 'MCQ' ? (
                  <input type="radio" name={`correct-${q.key}`} checked={right} onChange={() => onPatch({ correct: i })} aria-label={`الخيار ${formatNumber(i + 1)} هو الإجابة الصحيحة`} title="الإجابة الصحيحة" />
                ) : (
                  <input
                    type="checkbox"
                    checked={right}
                    onChange={() => onPatch({ corrects: right ? q.corrects.filter((c) => c !== i) : [...q.corrects, i] })}
                    aria-label={`الخيار ${formatNumber(i + 1)} من الإجابات الصحيحة`}
                    title="إجابة صحيحة"
                  />
                )}
                <input
                  type="text"
                  data-field={`option-${i}`}
                  value={o}
                  maxLength={LIMITS.option}
                  placeholder={`خيار ${formatNumber(i + 1)}`}
                  aria-label={`نص الخيار ${formatNumber(i + 1)}`}
                  onChange={(e) => onPatch({ options: q.options.map((x, j) => (j === i ? e.target.value : x)) })}
                  onKeyDown={(e) => onOptionKey(i, e)}
                />
                {right && <span className="qb-right-tag">{q.type === 'MCQ' ? 'الإجابة الصحيحة' : 'صحيحة'}</span>}
                <button type="button" className="qb-x" onClick={() => onRemoveOption(i)} disabled={q.options.length <= LIMITS.minOptions} aria-label={`حذف الخيار ${formatNumber(i + 1)}`}>
                  ✕
                </button>
              </div>
            );
          })}
          {q.options.length < LIMITS.maxOptions && (
            <div className="qb-opt add">
              <span className="qb-ghost-radio" aria-hidden="true" />
              <button type="button" className="qb-add-opt" onClick={onAddOption}>
                إضافة خيار
              </button>
            </div>
          )}
          {q.type === 'CHECKBOX' && <p className="small muted">تُمنح الدرجة كاملة فقط إذا اختار المتدرب كل الإجابات الصحيحة ولم يختر غيرها.</p>}
        </div>
      ) : q.type === 'RATING' ? (
        <div className="qb-text">
          <div className="qb-stars-fake" aria-hidden="true">
            {'★★★★★'}
          </div>
          <p className="small muted">يقيّم المتدرب من ١ إلى ٥ نجوم. يُحفظ تقييمه لتراه، ولا يدخل في الدرجة.</p>
        </div>
      ) : (
        <div className="qb-text">
          <div className="qb-fake" aria-hidden="true">
            {q.type === 'SHORT' ? 'إجابة المتدرب (قصيرة)' : 'إجابة المتدرب (فقرة)'}
          </div>
          <label>
            الإجابة النموذجية <span className="hint">(اختيارية، تظهر للمتدرب بعد التسليم ولا تُحتسب في الدرجة)</span>
            <textarea data-field="model" rows={2} maxLength={q.type === 'SHORT' ? LIMITS.short : LIMITS.body} value={q.modelAnswer} onChange={(e) => onPatch({ modelAnswer: e.target.value })} />
          </label>
        </div>
      )}

      {error && (
        <p className="qb-error" role="alert">
          {error}
        </p>
      )}

      <div className="qb-card-foot">
        {isGraded(q.type) ? (
          <label className="qb-inline">
            الدرجة
            <input
              type="number"
              className="qb-points"
              min={LIMITS.minPoints}
              max={LIMITS.maxPoints}
              step={1}
              value={Number.isFinite(q.points) ? q.points : ''}
              aria-label={`درجة السؤال ${n}`}
              onChange={(e) => onPatch({ points: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
            />
          </label>
        ) : (
          <span className="small muted">بلا درجة آلية</span>
        )}
        <label className="qb-inline qb-required">
          <input type="checkbox" checked={q.required} onChange={(e) => onPatch({ required: e.target.checked })} />
          مطلوب
        </label>
        <label className="qb-inline">
          الصعوبة
          <select value={q.difficulty} onChange={(e) => onPatch({ difficulty: e.target.value as Difficulty })}>
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="qb-inline">
          اليوم
          <select value={q.dayId ?? SHARED} onChange={(e) => onPatch({ dayId: e.target.value === SHARED ? null : e.target.value })}>
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
            <option value={SHARED}>أسئلة مشتركة</option>
          </select>
        </label>
        <span className="qb-spacer" />
        <button type="button" className="qb-icon" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="نسخ السؤال" aria-label={`نسخ السؤال ${n}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" />
          </svg>
        </button>
        <button type="button" className="qb-icon danger" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="حذف السؤال" aria-label={`حذف السؤال ${n}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </button>
      </div>
    </article>
  );
}

/** The quiz as a learner sees it (answers can be tried, nothing is stored or graded). */
function Preview({ title, questions }: { title: string; questions: BuilderQuestion[] }) {
  return (
    <div className="qb-preview">
      <p className="notice ok small">معاينة {title}: هكذا يراها المتدرب. لا تُحفظ الإجابات هنا.</p>
      {questions.length === 0 && <p className="qb-empty">لا أسئلة للمعاينة.</p>}
      {questions.map((q, i) => (
        <section key={q.key} className="qb-card">
          <p className="qb-pq">
            {formatNumber(i + 1)}. {q.body.trim() || <span className="muted">(سؤال بلا نص)</span>}
            {q.required && <span className="qb-req"> *</span>}
            {isGraded(q.type) && <span className="badge"> {formatNumber(q.points)} {q.points === 1 ? 'درجة' : 'درجات'}</span>}
          </p>
          {hasOptions(q.type) ? (
            <div className="qb-options">
              {q.options
                .filter((o) => o.trim())
                .map((o, j) => (
                  <label key={j} className="qb-opt">
                    <input type={q.type === 'MCQ' ? 'radio' : 'checkbox'} name={`pv-${q.key}`} />
                    <span>{o}</span>
                  </label>
                ))}
            </div>
          ) : q.type === 'RATING' ? (
            <div className="qb-stars-fake" aria-label="تقييم من ١ إلى ٥">
              {'☆☆☆☆☆'}
            </div>
          ) : q.type === 'SHORT' ? (
            <input type="text" placeholder="اكتب إجابتك هنا…" aria-label={`إجابة السؤال ${formatNumber(i + 1)}`} />
          ) : (
            <textarea rows={3} placeholder="اكتب إجابتك هنا…" aria-label={`إجابة السؤال ${formatNumber(i + 1)}`} />
          )}
        </section>
      ))}
    </div>
  );
}
