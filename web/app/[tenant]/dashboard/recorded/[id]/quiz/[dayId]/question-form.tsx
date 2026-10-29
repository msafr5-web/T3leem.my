'use client';

import { useActionState, useState } from 'react';
import type { AdminFormState } from '@/lib/admin-actions';

export interface QuestionFormValues {
  type: 'MCQ' | 'TEXT';
  body: string;
  options: string[];
  /** Index of the correct option (MCQ). */
  correct: number;
  modelAnswer: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export const EMPTY_QUESTION: QuestionFormValues = { type: 'MCQ', body: '', options: ['', '', '', ''], correct: 0, modelAnswer: '', difficulty: 'MEDIUM' };

/** Builds or edits one question: multiple choice (2-6 options, one marked correct) or a written answer. */
export function QuestionForm({
  action,
  initial = EMPTY_QUESTION,
  submitLabel,
}: {
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
  initial?: QuestionFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState(initial.type);
  const [options, setOptions] = useState(initial.options);
  const [correct, setCorrect] = useState(initial.correct);

  const setOption = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const remove = (i: number) => {
    setOptions((o) => o.filter((_, j) => j !== i));
    setCorrect((c) => (i < c ? c - 1 : i === c ? 0 : c));
  };

  return (
    <form action={formAction} className="form">
      <div className="form-grid">
        <label htmlFor="q-type">
          نوع السؤال
          <select id="q-type" name="type" value={type} onChange={(e) => setType(e.target.value as 'MCQ' | 'TEXT')}>
            <option value="MCQ">اختيار من متعدد (يُصحَّح آلياً)</option>
            <option value="TEXT">إجابة نصية (تُراجَع ولا تُحتسب)</option>
          </select>
        </label>
        <label htmlFor="q-difficulty">
          مستوى الصعوبة
          <select id="q-difficulty" name="difficulty" defaultValue={initial.difficulty}>
            <option value="EASY">سهل</option>
            <option value="MEDIUM">متوسط</option>
            <option value="HARD">صعب</option>
          </select>
        </label>
        <label htmlFor="q-body" className="full">
          نص السؤال
          <textarea id="q-body" name="body" required maxLength={2000} rows={3} defaultValue={initial.body} />
        </label>
      </div>

      {type === 'MCQ' ? (
        <fieldset className="group">
          <legend>الخيارات (اختر الدائرة بجانب الإجابة الصحيحة)</legend>
          <div className="qf-options">
            {options.map((o, i) => (
              <div key={i} className="qf-option">
                <input type="radio" name="correct" value={i} checked={correct === i} onChange={() => setCorrect(i)} aria-label={`الخيار ${i + 1} هو الصحيح`} />
                <input type="text" name="option" value={o} maxLength={300} placeholder={`الخيار ${i + 1}`} onChange={(e) => setOption(i, e.target.value)} aria-label={`نص الخيار ${i + 1}`} />
                <button type="button" className="btn btn-ghost" onClick={() => remove(i)} disabled={options.length <= MIN_OPTIONS} aria-label={`حذف الخيار ${i + 1}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div>
            <button type="button" className="btn btn-ghost" onClick={() => setOptions((o) => [...o, ''])} disabled={options.length >= MAX_OPTIONS}>
              + إضافة خيار
            </button>
          </div>
        </fieldset>
      ) : (
        <label htmlFor="q-model">
          الإجابة النموذجية <span className="hint">(اختيارية، تظهر للمتدرب بعد التسليم)</span>
          <textarea id="q-model" name="model_answer" maxLength={2000} rows={3} defaultValue={initial.modelAnswer} />
        </label>
      )}

      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'جارٍ الحفظ…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
