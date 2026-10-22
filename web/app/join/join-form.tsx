'use client';

import { useActionState, useState } from 'react';
import { registerProviderAction, type JoinState } from '@/lib/actions';

export function JoinForm() {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(registerProviderAction, {});
  const [slug, setSlug] = useState('');

  return (
    <form action={formAction} className="form">
      <fieldset className="group">
        <legend>الأكاديمية</legend>
        <div className="form-grid">
          <label htmlFor="academy_name" className="full">
            اسم الأكاديمية
            <input id="academy_name" name="academy_name" type="text" required minLength={3} maxLength={120} placeholder="مثال: أكاديمية المهارات المتقدمة" />
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
            <input id="city" name="city" type="text" maxLength={60} />
          </label>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>حساب المسؤول</legend>
        <div className="form-grid">
          <label htmlFor="admin_name">
            الاسم الكامل
            <input id="admin_name" name="admin_name" type="text" required minLength={3} maxLength={120} />
          </label>
          <label htmlFor="admin_email">
            البريد الإلكتروني
            <input id="admin_email" name="admin_email" type="email" required dir="ltr" autoComplete="email" />
          </label>
          <label htmlFor="password">
            كلمة المرور
            <input id="password" name="password" type="password" required minLength={8} maxLength={128} dir="ltr" autoComplete="new-password" />
            <span className="hint">٨ أحرف على الأقل.</span>
          </label>
        </div>
      </fieldset>

      <label htmlFor="accept_terms" className="check">
        <input id="accept_terms" name="accept_terms" type="checkbox" required />
        أوافق على شروط استخدام المنصة وسياسة الخصوصية وفق نظام حماية البيانات الشخصية
      </label>

      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
          {state.fields && state.fields.length > 0 && <div className="small">الحقول: {state.fields.join('، ')}</div>}
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ إنشاء الأكاديمية…' : 'إنشاء الأكاديمية'}
      </button>
    </form>
  );
}
