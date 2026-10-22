'use client';

import { useActionState } from 'react';
import { loginAction, type FormState } from '@/lib/actions';

export function LoginForm({ slug, next }: { slug: string; next: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(loginAction.bind(null, slug), {});

  return (
    <form action={formAction} className="form">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email">
        البريد الإلكتروني
        <input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </label>
      <label htmlFor="password">
        كلمة المرور
        <input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
      </label>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ الدخول…' : 'دخول'}
      </button>
    </form>
  );
}
