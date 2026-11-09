'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { EnrollState } from '@/lib/admin-actions';

type Action = (prev: EnrollState, form: FormData) => Promise<EnrollState>;

const STATUS_LABEL = { enrolled: 'سُجّل', already_enrolled: 'مسجّل مسبقاً', error: 'لم يُسجَّل' } as const;

/** What happened: counts, then one line per person (errors first, so nothing is missed in a long list). */
function Outcome({ state }: { state: EnrollState }) {
  const { outcome } = state;
  return (
    <>
      {outcome && (
        <div className="notice ok" role="status">
          <strong>
            سُجّل {outcome.summary.enrolled} موظفاً
            {outcome.summary.accounts_created > 0 ? `، وأُنشئ ${outcome.summary.accounts_created} حساباً جديداً` : ''}
            {outcome.summary.already_enrolled > 0 ? `، و${outcome.summary.already_enrolled} مسجّلون مسبقاً` : ''}
            {outcome.summary.errors > 0 ? `، و${outcome.summary.errors} لم يُسجَّلوا (انظر أدناه)` : ''}.
          </strong>
          {outcome.summary.errors > 0 && (
            <ul className="quiz-errors small">
              {outcome.results
                .filter((r) => r.status === 'error')
                .map((r) => (
                  <li key={r.email}>
                    <span className="ltr">{r.email}</span>: {r.message ?? STATUS_LABEL.error}
                  </li>
                ))}
            </ul>
          )}
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
    </>
  );
}

let nextRowId = 0;
const newRow = () => ({ id: nextRowId++ });
const INITIAL_ROWS = 3;

/** Type employees in a grid: add or remove rows; empty rows are ignored. The form clears after a successful save. */
export function TypedEnrollForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [rows, setRows] = useState(() => Array.from({ length: INITIAL_ROWS }, newRow));
  const formRef = useRef<HTMLFormElement>(null);

  // A fully successful batch clears the grid for the next one; a failed one keeps what was typed so it can be fixed.
  useEffect(() => {
    if (state.outcome && state.outcome.summary.errors === 0) {
      formRef.current?.reset();
      setRows(Array.from({ length: INITIAL_ROWS }, newRow));
    }
  }, [state.outcome]);

  return (
    <form ref={formRef} action={formAction} className="form">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">الاسم الكامل</th>
              <th scope="col">البريد الإلكتروني</th>
              <th scope="col">الجوال <span className="hint">(اختياري)</span></th>
              <th scope="col">الرقم الوظيفي <span className="hint">(اختياري)</span></th>
              <th scope="col"><span className="sr-only">حذف الصف</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="num">{i + 1}</td>
                <td>
                  <input name="full_name" type="text" maxLength={120} aria-label={`الاسم الكامل، الصف ${i + 1}`} autoComplete="off" />
                </td>
                <td>
                  <input name="email" type="email" dir="ltr" maxLength={254} aria-label={`البريد الإلكتروني، الصف ${i + 1}`} autoComplete="off" />
                </td>
                <td>
                  <input name="phone" type="tel" dir="ltr" placeholder="0551234567" maxLength={20} aria-label={`الجوال، الصف ${i + 1}`} autoComplete="off" />
                </td>
                <td>
                  <input name="employee_no" type="text" dir="ltr" maxLength={40} aria-label={`الرقم الوظيفي، الصف ${i + 1}`} autoComplete="off" />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setRows((cur) => (cur.length > 1 ? cur.filter((x) => x.id !== r.id) : cur))}
                    disabled={rows.length === 1}
                    aria-label={`حذف الصف ${i + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Outcome state={state} />
      <div className="cta-row">
        <button type="button" className="btn btn-ghost" onClick={() => setRows((cur) => (cur.length < 100 ? [...cur, newRow()] : cur))} disabled={rows.length >= 100}>
          + إضافة صف
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'جارٍ التسجيل…' : 'تسجيل الموظفين في الدورة'}
        </button>
      </div>
      <p className="small muted">لأكثر من ١٠٠ موظف استعمل رفع ملف Excel.</p>
    </form>
  );
}

/** Excel / CSV upload: shows the result, or every bad row (nothing is enrolled then). */
export function ImportEnrollForm({ action, templateHref }: { action: Action; templateHref: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="form" encType="multipart/form-data">
      <label htmlFor="trainee-file">
        ملف الموظفين <span className="hint">(Excel ‎.xlsx أو CSV، حتى ١ ميغابايت و٥٠٠ موظف)</span>
        <input id="trainee-file" name="file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required />
      </label>
      <p className="small muted">
        الأعمدة: الاسم الكامل، البريد الإلكتروني، الجوال، الرقم الوظيفي. <a href={templateHref}>تنزيل القالب</a>
      </p>
      <Outcome state={state} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'جارٍ الرفع…' : 'رفع وتسجيل'}
        </button>
      </div>
    </form>
  );
}
