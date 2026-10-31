'use client';

import { useActionState, useState } from 'react';
import { requestLoginCodeAction, type LoginState } from '@/lib/actions';
import { OtpStep } from './otp-step';

const INITIAL: LoginState = {};

/** Passwordless sign-in: the e-mail address, then the 6-digit code that was sent to it. */
export function LoginForm({ slug, next }: { slug: string; next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(requestLoginCodeAction.bind(null, slug), INITIAL);
  const [challenge, setChallenge] = useState<LoginState['challenge'] | null>(null);
  const [seen, setSeen] = useState<LoginState | null>(null);
  const [email, setEmail] = useState('');

  // Move to the code step once per API answer (compared by reference).
  if (state !== seen) {
    setSeen(state);
    if (state.challenge) setChallenge(state.challenge);
  }

  if (challenge) return <OtpStep slug={slug} challenge={challenge} next={next} onBack={() => setChallenge(null)} />;

  return (
    <form action={formAction} className="form">
      <label htmlFor="email">
        البريد الإلكتروني
        <input id="email" name="email" type="email" autoComplete="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ إرسال الرمز…' : 'إرسال رمز الدخول'}
      </button>
      <p className="small muted">نرسل رمزاً من ٦ أرقام إلى بريدك، ولا حاجة إلى كلمة مرور.</p>
    </form>
  );
}
