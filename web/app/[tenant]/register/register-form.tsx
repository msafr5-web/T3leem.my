'use client';

import { useActionState } from 'react';
import { registerLearnerAction, type JoinState } from '@/lib/actions';

export function RegisterForm({ slug, next }: { slug: string; next: string }) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(registerLearnerAction.bind(null, slug), {});

  return (
    <form action={formAction} className="form">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="full_name">
        الاسم الكامل
        <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={120} autoComplete="name" />
        <span className="hint">يظهر على شهاداتك كما تكتبه هنا.</span>
      </label>
      <label htmlFor="email">
        البريد الإلكتروني
        <input id="email" name="email" type="email" required dir="ltr" autoComplete="email" />
      </label>
      <label htmlFor="password">
        كلمة المرور
        <input id="password" name="password" type="password" required minLength={8} maxLength={128} dir="ltr" autoComplete="new-password" />
        <span className="hint">٨ أحرف على الأقل.</span>
      </label>
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
          {state.fields && state.fields.length > 0 && <div className="small">الحقول: {state.fields.join('، ')}</div>}
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'}
      </button>
    </form>
  );
}
