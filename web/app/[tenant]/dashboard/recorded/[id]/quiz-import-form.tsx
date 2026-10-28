'use client';

import { useActionState } from 'react';
import type { QuizImportState } from '@/lib/admin-actions';

/** Excel/CSV upload for the question bank: shows what was imported, or every bad row (nothing is imported then). */
export function QuizImportForm({ action }: { action: (prev: QuizImportState, form: FormData) => Promise<QuizImportState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="form" encType="multipart/form-data">
      <label htmlFor="quiz-file">
        ملف الأسئلة <span className="hint">(Excel ‎.xlsx أو CSV، حتى ٢ ميغابايت)</span>
        <input id="quiz-file" name="file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required />
      </label>
      <fieldset className="group" style={{ padding: 10 }}>
        <legend className="small">عند وجود أسئلة سابقة</legend>
        <label className="check" htmlFor="mode-append">
          <input id="mode-append" type="radio" name="mode" value="append" defaultChecked />
          إضافة الجديد وتحديث ما يتطابق رقمه (Question_ID)
        </label>
        <label className="check" htmlFor="mode-replace">
          <input id="mode-replace" type="radio" name="mode" value="replace" />
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
