'use client';

import { useActionState, useState } from 'react';
import { registerLearnerAction, type LoginState } from '@/lib/actions';
import { OtpStep } from '../login/otp-step';

const INITIAL: LoginState = {};

/** Learner sign-up: name and e-mail, then the code e-mailed to that address (it also proves the address is theirs). */
export function RegisterForm({ slug, next }: { slug: string; next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(registerLearnerAction.bind(null, slug), INITIAL);
  const [challenge, setChallenge] = useState<LoginState['challenge'] | null>(null);
  const [seen, setSeen] = useState<LoginState | null>(null);
  const [vals, setVals] = useState({ full_name: '', email: '' });

  if (state !== seen) {
    setSeen(state);
    if (state.challenge) setChallenge(state.challenge);
  }

  if (challenge) return <OtpStep slug={slug} challenge={challenge} next={next || `/${slug}/my`} onBack={() => setChallenge(null)} />;

  return (
    <form action={formAction} className="form">
      <label htmlFor="full_name">
        الاسم الكامل
        <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={120} autoComplete="name" value={vals.full_name} onChange={(e) => setVals((v) => ({ ...v, full_name: e.target.value }))} />
        <span className="hint">يظهر على شهاداتك كما تكتبه هنا.</span>
      </label>
      <label htmlFor="email">
        البريد الإلكتروني
        <input id="email" name="email" type="email" required dir="ltr" autoComplete="email" value={vals.email} onChange={(e) => setVals((v) => ({ ...v, email: e.target.value }))} />
      </label>
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
          {state.fields && state.fields.length > 0 && <div className="small">الحقول: {state.fields.join('، ')}</div>}
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب وإرسال الرمز'}
      </button>
      <p className="small muted">سنرسل رمز دخول من ٦ أرقام إلى بريدك، ولا حاجة إلى كلمة مرور.</p>
    </form>
  );
}
