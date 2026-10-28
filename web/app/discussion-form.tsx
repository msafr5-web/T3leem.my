'use client';

import { useActionState, useEffect, useRef } from 'react';

interface PostState {
  error?: string;
}

/** Question / reply box for day discussions; clears itself after a successful post. */
export function DiscussionForm({
  action,
  label,
  placeholder,
  submitLabel,
  compact = false,
}: {
  action: (prev: PostState, form: FormData) => Promise<PostState>;
  label: string;
  placeholder: string;
  submitLabel: string;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) form.current?.reset();
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <form ref={form} action={formAction} className="stack" style={{ gap: 8 }}>
      <label className="stack" style={{ gap: 4 }}>
        <span className={compact ? 'visually-hidden' : 'small'} style={{ fontWeight: 600 }}>
          {label}
        </span>
        <textarea name="body" required minLength={2} maxLength={2000} rows={compact ? 2 : 3} placeholder={placeholder} />
      </label>
      {state.error && (
        <p className="notice error small" role="alert">
          {state.error}
        </p>
      )}
      <div>
        <button type="submit" className={compact ? 'btn btn-ghost' : 'btn btn-primary'} disabled={pending}>
          {pending ? 'جارٍ الإرسال…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
