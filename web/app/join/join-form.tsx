'use client';

import { useActionState, useState } from 'react';
import { registerProviderAction, resendProviderCodeAction, verifyProviderAction, type JoinState } from '@/lib/actions';

const INITIAL: JoinState = {};
type Pending = NonNullable<JoinState['pending']>;

export function JoinForm() {
  const [step1, startAction, starting] = useActionState<JoinState, FormData>(registerProviderAction, INITIAL);
  const [slug, setSlug] = useState('');
  // React resets an action form once it is submitted; these defaults bring typed values back if the user returns to step 1.
  const [vals, setVals] = useState({ academy_name: '', city: '', admin_name: '', admin_email: '' });
  // Kept in state, not read from the field: React resets the form after the first action, which would blank it.
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [seen, setSeen] = useState<JoinState | null>(null);

  // Move to step 2 when the API accepted the sign-up (compare by reference so it happens once per response).
  if (step1 !== seen) {
    setSeen(step1);
    if (step1.pending) setPending(step1.pending);
  }

  // Step 1 stays mounted (only hidden) so the typed password is still there when the code comes in.
  return (
    <>
      {pending && <VerifyStep pending={pending} password={password} onRestart={() => setPending(null)} />}
      <form
        action={startAction}
        className="form"
        style={pending ? { display: 'none' } : undefined}
        onChange={(e) => {
          const t = e.target as unknown as HTMLInputElement;
          if (t.name in vals) setVals((v) => ({ ...v, [t.name]: t.value }));
        }}
      >
      <fieldset className="group">
        <legend>الأكاديمية</legend>
        <div className="form-grid">
          <label htmlFor="academy_name" className="full">
            اسم الأكاديمية
            <input id="academy_name" name="academy_name" defaultValue={vals.academy_name} type="text" required minLength={3} maxLength={120} placeholder="مثال: أكاديمية المهارات المتقدمة" />
          </label>
          <label htmlFor="slug">
            عنوان الموقع
            <input
              id="slug"
              name="slug"
              type="text"
              required
              minLength={3}
              maxLength={40}
              pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
              dir="ltr"
              placeholder="skills-academy"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
            <span className="hint ltr" style={{ textAlign: 'right' }}>
              t3leem.my/{slug || 'your-academy'}
            </span>
          </label>
          <label htmlFor="city">
            المدينة
            <input id="city" name="city" defaultValue={vals.city} type="text" maxLength={60} />
          </label>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>حساب المسؤول</legend>
        <div className="form-grid">
          <label htmlFor="admin_name">
            الاسم الكامل
            <input id="admin_name" name="admin_name" defaultValue={vals.admin_name} type="text" required minLength={3} maxLength={120} />
          </label>
          <label htmlFor="admin_email">
            البريد الإلكتروني
            <input id="admin_email" name="admin_email" defaultValue={vals.admin_email} type="email" required dir="ltr" autoComplete="email" />
          </label>
          <label htmlFor="password">
            كلمة المرور
            <input id="password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} dir="ltr" autoComplete="new-password" />
            <span className="hint">٨ أحرف على الأقل.</span>
          </label>
        </div>
      </fieldset>

      <label htmlFor="accept_terms" className="check">
        <input id="accept_terms" name="accept_terms" type="checkbox" required />
        أوافق على شروط استخدام المنصة وسياسة الخصوصية وفق نظام حماية البيانات الشخصية
      </label>

      {step1.error && (
        <div className="notice error" role="alert">
          {step1.error}
          {step1.fields && step1.fields.length > 0 && <div className="small">الحقول: {step1.fields.join('، ')}</div>}
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={starting}>
        {starting ? 'جارٍ إرسال رمز التحقق…' : 'إرسال رمز التحقق'}
      </button>
      <p className="small muted">سنرسل رمزاً من ٦ أرقام إلى بريد المسؤول للتأكد أنه بريدك، ولا تُنشأ الأكاديمية إلا بعد إدخاله.</p>
      </form>
    </>
  );
}

function VerifyStep({ pending, password, onRestart }: { pending: Pending; password: string; onRestart: () => void }) {
  const [state, formAction, verifying] = useActionState<JoinState, FormData>(async (prev, form) => {
    form.set('password', password);
    return verifyProviderAction(pending, prev, form);
  }, { pending });
  const [resend, resendAction, resending] = useActionState<JoinState>((prev) => resendProviderCodeAction(pending, prev), { pending });
  // An expired or locked sign-up comes back without `pending`: the only way on is to start again.
  const dead = (state.pending === undefined && state.error !== undefined) || (resend.pending === undefined && resend.error !== undefined);

  return (
    <div className="form" aria-live="polite">
      <div className="notice ok" role="status">
        أرسلنا رمز التحقق إلى <strong dir="ltr">{pending.email}</strong>. الرسالة تحتوي أيضاً بيانات أكاديميتك: الاسم والرابط t3leem.my/{pending.slug}. الرمز صالح ١٥ دقيقة.
      </div>
      <form action={formAction} className="form">
        <label htmlFor="code">
          رمز التحقق
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required dir="ltr" autoFocus placeholder="000000" style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }} disabled={dead} />
        </label>
        {(state.error || resend.error) && (
          <div className="notice error" role="alert">
            {state.error ?? resend.error}
          </div>
        )}
        {resend.resent && !resend.error && !state.error && (
          <div className="notice ok" role="status">
            أُرسل رمز جديد.
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={verifying || dead}>
          {verifying ? 'جارٍ التحقق…' : 'تأكيد وإنشاء الأكاديمية'}
        </button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <form action={resendAction}>
          <button type="submit" className="btn btn-ghost" disabled={resending || dead}>
            {resending ? 'جارٍ الإرسال…' : 'إعادة إرسال الرمز'}
          </button>
        </form>
        <button type="button" className="btn btn-ghost" onClick={onRestart}>
          تعديل البيانات أو البريد
        </button>
      </div>
    </div>
  );
}
