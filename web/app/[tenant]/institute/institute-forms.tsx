'use client';

import { useActionState } from 'react';
import type { InstState } from '@/lib/institute-actions';

/** Excel / CSV upload of assets: shows what was imported, or every bad row (nothing is imported then). */
export function AssetImportForm({ action }: { action: (prev: InstState, form: FormData) => Promise<InstState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="form" encType="multipart/form-data">
      <label htmlFor="asset-file">
        ملف الأصول <span className="hint">(Excel ‎.xlsx أو CSV، حتى ٢ ميغابايت. الفرع والقاعة بالاسم كما في النظام)</span>
        <input id="asset-file" name="file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required />
      </label>
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
            </ul>
          )}
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'جارٍ الاستيراد…' : 'استيراد الأصول'}
        </button>
      </div>
    </form>
  );
}
