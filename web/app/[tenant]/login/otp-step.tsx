'use client';

import { useActionState } from 'react';
import { resendLoginCodeAction, verifyLoginCodeAction, type LoginState } from '@/lib/actions';

/** The e-mailed 6-digit code: shared by sign-in and learner registration. */
export function OtpStep({ slug, challenge, next, onBack }: { slug: string; challenge: { id: string; email: string }; next: string; onBack: () => void }) {
  const [state, formAction, verifying] = useActionState<LoginState, FormData>(verifyLoginCodeAction.bind(null, slug, challenge, next), { challenge });
  const [resend, resendAction, resending] = useActionState<LoginState>(resendLoginCodeAction.bind(null, slug, challenge), { challenge });
  // After a lock-out or an expired code the action answers without `challenge`: the way on is a new code.
  const dead = (state.challenge === undefined && state.error !== undefined) || (resend.challenge === undefined && resend.error !== undefined);

  return (
    <div className="form" aria-live="polite">
      <div className="notice ok" role="status">
        إن كان لهذا البريد حساب فقد أرسلنا إليه رمز دخول من ٦ أرقام: <strong dir="ltr">{challenge.email}</strong>. الرمز صالح ١٠ دقائق.
      </div>
      <form action={formAction} className="form">
        <label htmlFor="code">
          رمز الدخول
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required dir="ltr" autoFocus placeholder="000000" style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }} disabled={dead} />
        </label>
        {(state.error || resend.error) && (
          <p className="notice error" role="alert">
            {state.error ?? resend.error}
          </p>
        )}
        {resend.resent && !resend.error && !state.error && (
          <p className="notice ok" role="status">
            أُرسل رمز جديد.
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={verifying || dead}>
          {verifying ? 'جارٍ التحقق…' : 'دخول'}
        </button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <form action={resendAction}>
          <button type="submit" className="btn btn-ghost" disabled={resending || dead}>
            {resending ? 'جارٍ الإرسال…' : 'إعادة إرسال الرمز'}
          </button>
        </form>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          تغيير البريد
        </button>
      </div>
    </div>
  );
}
