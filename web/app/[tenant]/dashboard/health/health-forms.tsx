'use client';

import { useActionState, useState } from 'react';
import type { AdminFormState, QuizImportState } from '@/lib/admin-actions';
import type { AdminHealthSector, HealthQuestion } from '@/lib/api';

/** A server action form: fields come in as children (server-rendered), errors from the API show inline. */
export function ActionForm({
  action,
  submitLabel,
  children,
  className = 'form',
}: {
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
  submitLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
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

/** A one-button action (e.g. install the starter bank) with its result inline. */
export function ConfirmAction({
  action,
  label,
  confirmText,
  variant = 'primary',
}: {
  action: (prev: AdminFormState) => Promise<AdminFormState>;
  label: string;
  confirmText: string;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="stack"
      style={{ gap: 8 }}
    >
      <div>
        <button type="submit" className={`btn btn-${variant}`} disabled={pending}>
          {pending ? 'جارٍ التنفيذ…' : label}
        </button>
      </div>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Excel / CSV upload: shows what was imported, or every bad row (nothing is imported then). */
export function HealthImportForm({ action }: { action: (prev: QuizImportState, form: FormData) => Promise<QuizImportState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="form" encType="multipart/form-data">
      <label htmlFor="health-file">
        ملف الأسئلة <span className="hint">(Excel ‎.xlsx أو CSV، حتى ٣ ميغابايت)</span>
        <input id="health-file" name="file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required />
      </label>
      <fieldset className="group" style={{ padding: 10 }}>
        <legend className="small">عند وجود أسئلة سابقة</legend>
        <label className="check" htmlFor="health-append">
          <input id="health-append" type="radio" name="mode" value="append" defaultChecked />
          إضافة الجديد وتحديث ما يتطابق رقمه (Question_ID)
        </label>
        <label className="check" htmlFor="health-replace">
          <input id="health-replace" type="radio" name="mode" value="replace" />
          استبدال بنك الأسئلة كله بمحتوى الملف
        </label>
      </fieldset>
      {state.done && (
        <div className="notice ok" role="status">
          {state.done}
        </div>
      )}
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
          {state.rowErrors && state.rowErrors.length > 0 && (
            <ul className="quiz-errors small">
              {state.rowErrors.map((e, i) => (
                <li key={i}>
                  {e.row > 0 ? `الصف ${e.row}: ` : ''}
                  {e.message}
                </li>
              ))}
              {(state.totalErrors ?? 0) > state.rowErrors.length && <li>… و{(state.totalErrors ?? 0) - state.rowErrors.length} أخطاء أخرى.</li>}
            </ul>
          )}
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'جارٍ الاستيراد…' : 'رفع واستيراد'}
        </button>
      </div>
    </form>
  );
}

const SLOTS = 6;

/** Add / edit one question: up to six options, a radio picks the right one. Blank boxes are ignored. */
export function QuestionEditor({
  action,
  sectors,
  question,
  defaultSectorId,
  submitLabel,
}: {
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
  sectors: AdminHealthSector[];
  question?: HealthQuestion;
  defaultSectorId?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [correct, setCorrect] = useState(question?.correct_index ?? 0);
  const options = Array.from({ length: SLOTS }, (_, i) => question?.options[i] ?? '');
  return (
    <form action={formAction} className="form">
      <label>
        القطاع
        <select name="sector_id" defaultValue={question?.sector_id ?? defaultSectorId ?? sectors[0]?.id} required>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        نص السؤال
        <textarea name="body" rows={2} maxLength={1000} defaultValue={question?.body} required />
      </label>
      <fieldset className="group" style={{ padding: 10 }}>
        <legend className="small">الخيارات (اكتب من ٢ إلى ٦، وحدّد الإجابة الصحيحة)</legend>
        {options.map((text, i) => (
          <div key={i} className="qb-opt" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input type="radio" name="correct" value={i} checked={correct === i} onChange={() => setCorrect(i)} aria-label={`الخيار ${i + 1} هو الصحيح`} />
            <input type="text" name={`option_${i}`} defaultValue={text} maxLength={300} placeholder={`خيار ${i + 1}${i < 2 ? '' : ' (اختياري)'}`} aria-label={`نص الخيار ${i + 1}`} style={{ flex: 1 }} required={i < 2} />
          </div>
        ))}
      </fieldset>
      <label>
        الشرح <span className="hint">(يظهر للمتدرب بعد الإجابة، اختياري)</span>
        <textarea name="explanation" rows={2} maxLength={1500} defaultValue={question?.explanation} />
      </label>
      <label className="check">
        <input type="checkbox" name="active" defaultChecked={question?.active ?? true} />
        ظاهر للمتدربين
      </label>
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
