'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { ApiError, ApiUnavailableError, api, type CheckoutResponse, type LoginResponse } from './api';
import { isValidSlug, safeNextPath } from './format';
import { clearSession, getSession, setSession } from './session';

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  VALIDATION_FAILED: 'تحقق من البيانات المدخلة.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
  LOGIN_UNAVAILABLE: 'تسجيل الدخول غير مفعّل على هذا الخادم بعد.',
  ALREADY_ENROLLED: 'أنت مسجّل في هذه الدورة بالفعل.',
  PAYMENT_DECLINED: 'رُفضت عملية الدفع. لم يُخصم أي مبلغ.',
  COURSE_NOT_FOUND: 'الدورة غير متاحة.',
  COURSE_IS_FREE: 'هذه الدورة مجانية ولا تحتاج إلى دفع.',
  TENANT_BILLING_NOT_CONFIGURED: 'لا يمكن لهذه الأكاديمية إصدار فواتير ضريبية بعد.',
  FORBIDDEN: 'ليست لديك صلاحية لهذه العملية.',
};

function describe(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? 'حدث خطأ غير متوقع. حاول مرة أخرى.';
  if (err instanceof ApiUnavailableError) return 'تعذّر الاتصال بالخادم. حاول بعد قليل.';
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}

export interface FormState {
  error?: string;
}

export async function loginAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'أدخل البريد الإلكتروني وكلمة المرور.' };

  try {
    const res = await api<LoginResponse>(slug, '/auth/login', { method: 'POST', body: { email, password } });
    await setSession(slug, { token: res.access_token, email: res.user.email, role: res.user.role }, res.expires_in);
  } catch (err) {
    return { error: describe(err) };
  }
  // redirect() throws, so it must stay outside the try block.
  redirect(safeNextPath(slug, form.get('next')));
}

export async function logoutAction(slug: string): Promise<void> {
  if (!isValidSlug(slug)) return;
  await clearSession(slug);
  redirect(`/${slug}`);
}

export interface CheckoutState extends FormState {
  invoice?: {
    number: string;
    total: number;
    vat: number;
    qrSvg: string;
  };
}

const METHODS = new Set(['MADA', 'CREDIT_CARD', 'APPLE_PAY', 'STC_PAY']);

export async function checkoutAction(slug: string, courseId: string, _prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/checkout/${courseId}`)}`);

  const method = String(form.get('payment_method') ?? '');
  if (!METHODS.has(method)) return { error: 'اختر طريقة الدفع.' };

  // Sandbox gateway: in production this token comes from the payment provider's client SDK
  // (card details never touch our servers). "simulate_decline" exercises the failure path.
  const paymentToken = form.get('simulate_decline') === 'on' ? `tok_decline_${randomUUID()}` : `tok_sandbox_${randomUUID()}`;

  try {
    const res = await api<CheckoutResponse>(slug, '/enrollments/checkout', {
      method: 'POST',
      token: session.token,
      body: { course_id: courseId, payment_method: method, payment_token: paymentToken },
    });
    const qrSvg = await QRCode.toString(res.invoice.zatca_qr_base64, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return {
      invoice: { number: res.invoice.invoice_number, total: res.invoice.total_amount, vat: res.invoice.vat_amount, qrSvg },
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSession(slug);
      return { error: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' };
    }
    return { error: describe(err) };
  }
}
