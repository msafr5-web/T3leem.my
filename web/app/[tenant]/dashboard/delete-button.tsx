'use client';

import { useActionState } from 'react';
import type { AdminFormState } from '@/lib/admin-actions';

/** Action with an explicit confirmation step and the API's refusal reason shown inline. Destructive by default. */
export function DeleteButton({
  action,
  label,
  confirmText,
  variant = 'danger',
}: {
  action: (prev: AdminFormState) => Promise<AdminFormState>;
  label: string;
  confirmText: string;
  variant?: 'danger' | 'primary';
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
        <button type="submit" className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={pending}>
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
