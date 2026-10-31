'use client';

import { useActionState, useState } from 'react';
import {
  requestOwnerCodeAction,
  resendOwnerCodeAction,
  verifyOwnerCodeAction,
  type OwnerFormState,
} from '@/lib/owner-actions';

const INITIAL: OwnerFormState = {};

/** A console form: fields come in as children (server-rendered); the API's answer shows inline. */
export function OwnerForm({
  action,
  submitLabel,
  children,
  className = 'form',
  variant = 'primary',
}: {
  action: (prev: OwnerFormState, form: FormData) => Promise<OwnerFormState>;
  submitLabel: string;
  children?: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.done && !state.error && (
        <p className="notice ok" role="status">
          {state.done}
        </p>
      )}
      <div>
        <button type="submit" className={`btn btn-${variant}`} disabled={pending}>
          {pending ? 'جارٍ التنفيذ…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** One button with a confirmation step (suspend, delete…). */
export function OwnerConfirm({ action, label, confirmText, variant = 'danger' }: { action: (prev: OwnerFormState) => Promise<OwnerFormState>; label: string; confirmText: string; variant?: 'primary' | 'ghost' | 'danger' }) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="stack"
      style={{ gap: 6 }}
    >
      <div>
        <button type="submit" className={`btn btn-${variant}`} disabled={pending}>
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

/** Owner sign-in: the official e-mail, then the 6-digit code that was sent to it. */
export function OwnerLogin() {
  const [state, formAction, pending] = useActionState(requestOwnerCodeAction, INITIAL);
  const [challenge, setChallenge] = useState<OwnerFormState['challenge'] | null>(null);
  const [seen, setSeen] = useState<OwnerFormState | null>(null);
  if (state !== seen) {
    setSeen(state);
    if (state.challenge) setChallenge(state.challenge);
  }
  if (challenge) return <OwnerCode challenge={challenge} onBack={() => setChallenge(null)} />;
  return (
    <form action={formAction} className="form">
      <label htmlFor="owner-email">
        البريد الرسمي للإدارة
        <input id="owner-email" name="email" type="email" required dir="ltr" autoComplete="email" placeholder="t3leemy@t3leem.my" />
      </label>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ إرسال الرمز…' : 'إرسال رمز الدخول'}
      </button>
      <p className="small muted">يصل الرمز إلى البريد المعتمد للإدارة فقط.</p>
    </form>
  );
}

function OwnerCode({ challenge, onBack }: { challenge: { id: string; email: string }; onBack: () => void }) {
  const [state, formAction, verifying] = useActionState<OwnerFormState, FormData>(verifyOwnerCodeAction.bind(null, challenge), { challenge });
  const [resend, resendAction, resending] = useActionState<OwnerFormState>(resendOwnerCodeAction.bind(null, challenge), { challenge });
  const dead = (state.challenge === undefined && state.error !== undefined) || (resend.challenge === undefined && resend.error !== undefined);
  return (
    <div className="form" aria-live="polite">
      <div className="notice ok" role="status">
        إن كان البريد معتمداً فقد أرسلنا رمز الدخول إلى <strong dir="ltr">{challenge.email}</strong>. صالح ١٠ دقائق.
      </div>
      <form action={formAction} className="form">
        <label htmlFor="owner-code">
          رمز الدخول
          <input id="owner-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required dir="ltr" autoFocus placeholder="000000" style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }} disabled={dead} />
        </label>
        {(state.error || resend.error) && (
          <p className="notice error" role="alert">
            {state.error ?? resend.error}
          </p>
        )}
        {resend.resent && !resend.error && !state.error && <p className="notice ok">أُرسل رمز جديد.</p>}
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
