'use client';

import { useActionState } from 'react';
import type { AdminFormState } from '@/lib/admin-actions';

/** Shared wrapper for dashboard forms: pending state, error message, and invalid field names. */
export function AdminForm({
  action,
  submitLabel,
  children,
}: {
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="form">
      {children}
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
          {state.fields && state.fields.length > 0 && <div className="small">الحقول: {state.fields.join('، ')}</div>}
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
