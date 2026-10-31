'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, ApiUnavailableError, platformApi, type LoginResponse } from './api';
import { clearOwnerSession, getOwnerSession, setOwnerSession } from './owner-session';

export interface OwnerFormState {
  error?: string;
  done?: string;
  /** Sign-in step 2: a code was e-mailed for this challenge. */
  challenge?: { id: string; email: string };
  resent?: boolean;
}

const MESSAGES: Record<string, string> = {
  OTP_INVALID: 'الرمز غير صحيح أو انتهت صلاحيته.',
  TOO_MANY_ATTEMPTS: 'محاولات كثيرة. اطلب رمزاً جديداً بعد قليل.',
  RESEND_TOO_SOON: 'انتظر دقيقة قبل طلب رمز جديد.',
  MAIL_UNAVAILABLE: 'تعذّر إرسال البريد الآن (إعدادات SMTP).',
  LOGIN_UNAVAILABLE: 'تسجيل الدخول غير مفعّل على هذا الخادم.',
  TENANT_NOT_FOUND: 'الأكاديمية غير موجودة.',
  UNKNOWN_PLAN: 'الباقة غير موجودة.',
  PLAN_EXISTS: 'توجد باقة بهذا الاسم.',
  PLAN_NOT_FOUND: 'الباقة غير موجودة.',
  PLAN_IN_USE: 'توجد أكاديميات على هذه الباقة. انقلها إلى باقة أخرى أولاً.',
  VALIDATION_FAILED: 'تحقق من القيم المدخلة.',
  FORBIDDEN: 'ليست لديك صلاحية.',
  UNAUTHORIZED: 'انتهت الجلسة. سجّل الدخول من جديد.',
};

function describe(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? 'حدث خطأ غير متوقع.';
  if (err instanceof ApiUnavailableError) return 'تعذّر الاتصال بالخادم.';
  return 'حدث خطأ غير متوقع.';
}

async function token(): Promise<string> {
  const s = await getOwnerSession();
  if (!s) redirect('/owner');
  return s.token;
}

// ---- sign-in ----
export async function requestOwnerCodeAction(_prev: OwnerFormState, form: FormData): Promise<OwnerFormState> {
  const email = String(form.get('email') ?? '').trim();
  if (!email) return { error: 'أدخل البريد الرسمي.' };
  try {
    const r = await platformApi<{ challenge_id: string }>('/owner/otp/request', { method: 'POST', body: { email } });
    return { challenge: { id: r.challenge_id, email } };
  } catch (err) {
    return { error: describe(err) };
  }
}

export async function verifyOwnerCodeAction(challenge: { id: string; email: string }, _prev: OwnerFormState, form: FormData): Promise<OwnerFormState> {
  const code = String(form.get('code') ?? '').replace(/\D/g, '');
  if (code.length !== 6) return { challenge, error: 'اكتب الرمز المكوّن من ٦ أرقام.' };
  try {
    const res = await platformApi<LoginResponse>('/owner/otp/verify', { method: 'POST', body: { challenge_id: challenge.id, code } });
    await setOwnerSession({ token: res.access_token, email: res.user.email }, res.expires_in);
  } catch (err) {
    return err instanceof ApiError && err.code === 'OTP_INVALID' ? { challenge, error: describe(err) } : { error: describe(err) };
  }
  redirect('/owner');
}

export async function resendOwnerCodeAction(challenge: { id: string; email: string }, _prev: OwnerFormState): Promise<OwnerFormState> {
  try {
    await platformApi('/owner/otp/resend', { method: 'POST', body: { challenge_id: challenge.id } });
    return { challenge, resent: true };
  } catch (err) {
    return err instanceof ApiError && err.code === 'RESEND_TOO_SOON' ? { challenge, error: describe(err) } : { error: describe(err) };
  }
}

export async function ownerLogoutAction(): Promise<void> {
  await clearOwnerSession();
  redirect('/owner');
}

// ---- console ----
const flag = (form: FormData, key: string) => form.get(key) === 'on';
const featuresOf = (form: FormData) => ({ health: flag(form, 'f_health'), recorded: flag(form, 'f_recorded') });

async function run(call: (t: string) => Promise<unknown>, done: string): Promise<OwnerFormState> {
  const t = await token();
  try {
    await call(t);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/owner');
    return { error: describe(err) };
  }
  revalidatePath('/owner');
  return { done };
}

export async function approveTenantAction(tenantId: string, _prev: OwnerFormState, form: FormData): Promise<OwnerFormState> {
  const plan = String(form.get('plan_id') ?? '');
  return run(
    (t) => platformApi(`/owner/tenants/${encodeURIComponent(tenantId)}/approve`, { method: 'POST', token: t, body: { plan_id: plan || null, months: Number(form.get('months') ?? 0), features: featuresOf(form) } }),
    'تم اعتماد الأكاديمية وأُرسل بريد إلى مسؤولها.',
  );
}

export async function updateTenantAction(tenantId: string, _prev: OwnerFormState, form: FormData): Promise<OwnerFormState> {
  const plan = String(form.get('plan_id') ?? '');
  const ends = String(form.get('ends_at') ?? '').trim();
  return run(
    (t) =>
      platformApi(`/owner/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PUT',
        token: t,
        body: { plan_id: plan || null, subscription_ends_at: ends ? new Date(`${ends}T23:59:59+03:00`).toISOString() : null, features: featuresOf(form) },
      }),
    'تم حفظ التعديلات.',
  );
}

export async function setTenantStatusAction(tenantId: string, status: 'ACTIVE' | 'SUSPENDED', _prev: OwnerFormState): Promise<OwnerFormState> {
  return run((t) => platformApi(`/owner/tenants/${encodeURIComponent(tenantId)}`, { method: 'PUT', token: t, body: { status } }), status === 'ACTIVE' ? 'تم تفعيل الأكاديمية.' : 'تم إيقاف الأكاديمية.');
}

export async function extendTenantAction(tenantId: string, _prev: OwnerFormState, form: FormData): Promise<OwnerFormState> {
  return run((t) => platformApi(`/owner/tenants/${encodeURIComponent(tenantId)}/extend`, { method: 'POST', token: t, body: { months: Number(form.get('months') ?? 1) } }), 'تم تمديد الاشتراك.');
}

const planBody = (form: FormData) => ({
  name: String(form.get('name') ?? '').trim(),
  max_students: Number(form.get('max_students') ?? 0),
  max_storage_gb: Number(form.get('max_storage_gb') ?? 0),
  monthly_price: Number(form.get('monthly_price') ?? 0),
});

export async function createPlanAction(_prev: OwnerFormState, form: FormData): Promise<OwnerFormState> {
  return run((t) => platformApi('/owner/plans', { method: 'POST', token: t, body: planBody(form) }), 'تمت إضافة الباقة.');
}

export async function updatePlanAction(planId: string, _prev: OwnerFormState, form: FormData): Promise<OwnerFormState> {
  return run((t) => platformApi(`/owner/plans/${encodeURIComponent(planId)}`, { method: 'PUT', token: t, body: planBody(form) }), 'تم حفظ الباقة.');
}

export async function deletePlanAction(planId: string, _prev: OwnerFormState): Promise<OwnerFormState> {
  return run((t) => platformApi(`/owner/plans/${encodeURIComponent(planId)}`, { method: 'DELETE', token: t }), 'تم حذف الباقة.');
}
