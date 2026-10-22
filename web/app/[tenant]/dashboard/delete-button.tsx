'use client';

import { useActionState } from 'react';
import type { AdminFormState } from '@/lib/admin-actions';

/** Destructive action with an explicit confirmation and the API's refusal reason shown inline. */
export function DeleteButton({ action, label, confirmText }: { action: (prev: AdminFormState) => Promise<AdminFormState>; label: string; confirmText: string }) {
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
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? 'جارٍ الحذف…' : label}
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
