'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { ApiError, ApiUnavailableError, api, platformApi, type CheckoutResponse, type LoginResponse, type QuizAnswer, type QuizResult, type QuizStatus } from './api';
import { isValidSlug, safeNextPath } from './format';
import { normalizePhone } from './support';
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
  COURSE_NOT_FREE: 'هذه الدورة مدفوعة. أكمل الشراء من صفحة الدفع.',
  POST_TOO_SHORT: 'اكتب سؤالك أولاً.',
  POST_NOT_FOUND: 'السؤال الذي ترد عليه لم يعد موجوداً.',
  QUIZ_NOT_AVAILABLE: 'لا توجد أسئلة لاختبار هذا اليوم بعد.',
  QUIZ_NOT_STARTED: 'ابدأ الاختبار أولاً.',
  QUIZ_ALREADY_SUBMITTED: 'سلّمت هذا الاختبار من قبل.',
  QUIZ_EXPIRED: 'انتهى وقت الاختبار قبل وصول إجاباتك.',
  QUIZ_REQUIRED_MISSING: 'أجب عن الأسئلة المطلوبة قبل الإرسال.',
  QUIZ_NOT_OPEN: 'لم يحن موعد هذا الاختبار بعد.',
  QUIZ_CLOSED: 'انتهى موعد هذا الاختبار.',
};

function describe(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? 'حدث خطأ غير متوقع. حاول مرة أخرى.';
  if (err instanceof ApiUnavailableError) return 'تعذّر الاتصال بالخادم. حاول بعد قليل.';
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}

export interface FormState {
  error?: string;
}

export interface LoginState extends FormState {
  /** Names of the fields the API rejected (registration). */
  fields?: string[];
  /** Step 2: the code was e-mailed for this challenge. */
  challenge?: { id: string; email: string };
  resent?: boolean;
}

const OTP_ERRORS: Record<string, string> = {
  OTP_INVALID: 'الرمز غير صحيح أو انتهت صلاحيته. تحقق من الرسالة أو اطلب رمزاً جديداً.',
  TOO_MANY_ATTEMPTS: 'محاولات كثيرة. اطلب رمزاً جديداً بعد قليل.',
  RESEND_TOO_SOON: 'انتظر دقيقة قبل طلب رمز جديد.',
  MAIL_UNAVAILABLE: 'تعذّر إرسال الرمز إلى بريدك الآن. حاول بعد قليل أو تواصل مع الدعم.',
  LOGIN_UNAVAILABLE: 'تسجيل الدخول غير مفعّل على هذا الخادم بعد.',
  SUBSCRIPTION_EXPIRED: 'انتهى اشتراك هذه الأكاديمية. تواصل مع إدارتها.',
  TENANT_INACTIVE: 'هذه الأكاديمية غير مفعّلة بعد.',
};

const otpMessage = (err: unknown): string => (err instanceof ApiError && OTP_ERRORS[err.code] ? OTP_ERRORS[err.code]! : describe(err));

/** Step 1: e-mails a 6-digit code to the address. The API answers the same for unknown addresses. */
export async function requestLoginCodeAction(slug: string, _prev: LoginState, form: FormData): Promise<LoginState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  const email = String(form.get('email') ?? '').trim();
  if (!email) return { error: 'أدخل بريدك الإلكتروني.' };
  try {
    const r = await api<{ challenge_id: string }>(slug, '/auth/otp/request', { method: 'POST', body: { email } });
    return { challenge: { id: r.challenge_id, email } };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') return { error: 'اكتب بريداً إلكترونياً صحيحاً.' };
    return { error: otpMessage(err) };
  }
}

/** Step 2: the code signs the user in; admins land on their dashboard unless sent from a specific page. */
export async function verifyLoginCodeAction(slug: string, challenge: { id: string; email: string }, next: string, _prev: LoginState, form: FormData): Promise<LoginState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  const code = String(form.get('code') ?? '').replace(/\D/g, '');
  if (code.length !== 6) return { challenge, error: 'اكتب الرمز المكوّن من ٦ أرقام.' };
  let role: string;
  try {
    const res = await api<LoginResponse>(slug, '/auth/otp/verify', { method: 'POST', body: { challenge_id: challenge.id, code } });
    await setSession(slug, { token: res.access_token, email: res.user.email, role: res.user.role }, res.expires_in);
    role = res.user.role;
  } catch (err) {
    // A wrong code keeps the user on this step; anything else means asking for a new code.
    return err instanceof ApiError && err.code === 'OTP_INVALID' ? { challenge, error: otpMessage(err) } : { error: otpMessage(err) };
  }
  // redirect() throws, so it must stay outside the try block.
  const fallback = role === 'TENANT_ADMIN' ? `/${slug}/dashboard` : `/${slug}`;
  redirect(next ? safeNextPath(slug, next) : fallback);
}

export async function resendLoginCodeAction(slug: string, challenge: { id: string; email: string }, _prev: LoginState): Promise<LoginState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  try {
    await api(slug, '/auth/otp/resend', { method: 'POST', body: { challenge_id: challenge.id } });
    return { challenge, resent: true };
  } catch (err) {
    return err instanceof ApiError && err.code === 'RESEND_TOO_SOON' ? { challenge, error: otpMessage(err) } : { error: otpMessage(err) };
  }
}

export interface JoinState extends FormState {
  fields?: string[];
  /** Step 2: the code was e-mailed; the sign-up waits for it. */
  pending?: { id: string; email: string; slug: string; name: string };
  /** Step 3: the e-mail is confirmed and the academy is waiting for the platform owner's approval. */
  done?: { slug: string; email: string; name: string };
  /** A new code was sent (shown once). */
  resent?: boolean;
}

const JOIN_FIELDS: Record<string, string> = {
  academy_name: 'اسم الأكاديمية',
  slug: 'عنوان الموقع',
  city: 'المدينة',
  admin_name: 'اسم المسؤول',
  admin_email: 'البريد الإلكتروني',
  phone: 'رقم الجوال',
  accept_terms: 'الموافقة على الشروط',
};

const JOIN_ERRORS: Record<string, string> = {
  SLUG_TAKEN: 'عنوان الموقع مستخدم من أكاديمية أخرى. اختر عنواناً آخر.',
  SLUG_RESERVED: 'هذا العنوان محجوز للمنصة. اختر عنواناً آخر.',
  FORBIDDEN: 'التسجيل الذاتي للمزودين مغلق حالياً. تواصل مع فريق المنصة.',
  RATE_LIMITED: 'محاولات تسجيل كثيرة من هذا الجهاز. حاول بعد ساعة.',
  MAIL_UNAVAILABLE: 'تعذّر إرسال رمز التحقق إلى بريدك الآن. حاول بعد قليل أو تواصل مع فريق المنصة.',
  CODE_INVALID: 'الرمز غير صحيح. تحقق من الرسالة وأعد المحاولة.',
  CODE_EXPIRED: 'انتهت صلاحية الرمز أو استُخدم من قبل. ابدأ التسجيل من جديد.',
  TOO_MANY_ATTEMPTS: 'محاولات كثيرة. ابدأ التسجيل من جديد بعد قليل.',
  RESEND_TOO_SOON: 'انتظر دقيقة قبل طلب رمز جديد.',
};

/** Step 1 of the provider sign-up: validates and e-mails a code to the admin address. Nothing is created yet. */
export async function registerProviderAction(_prev: JoinState, form: FormData): Promise<JoinState> {
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  const rawPhone = String(form.get('phone') ?? '').trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return { error: 'رقم الجوال غير صحيح. اكتبه مثل 0566477687 أو +966566477687.', fields: ['رقم الجوال'] };
  try {
    const r = await platformApi<{ pending_id: string; email: string }>('/providers', {
      method: 'POST',
      body: {
        academy_name: String(form.get('academy_name') ?? '').trim(),
        slug,
        city: String(form.get('city') ?? '').trim() || null,
        admin_name: String(form.get('admin_name') ?? '').trim(),
        admin_email: String(form.get('admin_email') ?? '').trim(),
        phone,
        accept_terms: form.get('accept_terms') === 'on',
      },
    });
    return { pending: { id: r.pending_id, email: r.email, slug, name: String(form.get('academy_name') ?? '').trim() } };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      return { error: 'تحقق من الحقول المميزة.', fields: [...new Set((err.details ?? []).map((d) => JOIN_FIELDS[d.field] ?? d.field))] };
    }
    if (err instanceof ApiError && JOIN_ERRORS[err.code]) return { error: JOIN_ERRORS[err.code] };
    return { error: describe(err) };
  }
}

/** Step 2: the e-mailed code confirms the address and files the request; the owner approves it before it goes live. */
export async function verifyProviderAction(pending: NonNullable<JoinState['pending']>, _prev: JoinState, form: FormData): Promise<JoinState> {
  const code = String(form.get('code') ?? '').replace(/\D/g, '');
  if (code.length !== 6) return { pending, error: 'اكتب الرمز المكوّن من ٦ أرقام.' };
  try {
    const r = await platformApi<{ slug: string }>('/providers/verify', { method: 'POST', body: { pending_id: pending.id, code } });
    return { done: { slug: r.slug, email: pending.email, name: pending.name } };
  } catch (err) {
    // A wrong code keeps the user on this step; an expired or locked sign-up sends them back to step 1.
    const retry = err instanceof ApiError && err.code === 'CODE_INVALID';
    const message = err instanceof ApiError && JOIN_ERRORS[err.code] ? JOIN_ERRORS[err.code]! : describe(err);
    return retry ? { pending, error: message } : { error: message };
  }
}

export async function resendProviderCodeAction(pending: NonNullable<JoinState['pending']>, _prev: JoinState): Promise<JoinState> {
  try {
    await platformApi('/providers/resend', { method: 'POST', body: { pending_id: pending.id } });
    return { pending, resent: true };
  } catch (err) {
    const message = err instanceof ApiError && JOIN_ERRORS[err.code] ? JOIN_ERRORS[err.code]! : describe(err);
    return err instanceof ApiError && err.code === 'RESEND_TOO_SOON' ? { pending, error: message } : { error: message };
  }
}

/** PRD §6 learner self-registration: creates the account, then e-mails the sign-in code (also proves the address). */
export async function registerLearnerAction(slug: string, _prev: LoginState, form: FormData): Promise<LoginState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  const email = String(form.get('email') ?? '').trim();
  try {
    const rawPhone = String(form.get('phone') ?? '').trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) return { error: 'رقم الجوال غير صحيح. اكتبه مثل 0566477687.', fields: ['رقم الجوال'] };
    await api(slug, '/auth/register', { method: 'POST', body: { full_name: String(form.get('full_name') ?? '').trim(), email, phone } });
    const r = await api<{ challenge_id: string }>(slug, '/auth/otp/request', { method: 'POST', body: { email } });
    return { challenge: { id: r.challenge_id, email } };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') return { error: 'يوجد حساب بهذا البريد في هذه الأكاديمية. سجّل الدخول بدلاً من ذلك.' };
    if (err instanceof ApiError && err.code === 'PHONE_TAKEN') return { error: 'رقم الجوال هذا مسجّل لحساب آخر. لكل مشترك حساب واحد، فسجّل الدخول بحسابك.' };
    if (err instanceof ApiError && err.code === 'PHONE_REQUIRED') return { error: 'رقم الجوال مطلوب للتسجيل في هذه الأكاديمية.', fields: ['رقم الجوال'] };
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      return { error: 'تحقق من الحقول المميزة.', fields: [...new Set((err.details ?? []).map((d) => ({ full_name: 'الاسم الكامل', email: 'البريد الإلكتروني', phone: 'رقم الجوال' })[d.field as 'full_name' | 'email' | 'phone'] ?? d.field))] };
    }
    return { error: otpMessage(err) };
  }
}

/** Marks a lesson done; the API issues the certificate when it's the last one. */
export async function completeLessonAction(slug: string, courseId: string, lessonId: string): Promise<void> {
  if (!isValidSlug(slug)) return;
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/learn/${courseId}`)}`);
  await api(slug, `/me/lessons/${encodeURIComponent(lessonId)}/complete`, { method: 'POST', token: session.token });
  revalidatePath(`/${slug}/learn/${courseId}`);
  revalidatePath(`/${slug}/my`);
}

/** Free course: enroll in one click (no payment, no invoice), then go straight to learning. */
export async function enrollFreeAction(slug: string, courseId: string, _prev: FormState): Promise<FormState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  const learnPath = `/${slug}/learn/${courseId}`;
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/courses/${courseId}`)}`);
  try {
    await api(slug, '/enrollments/free', { method: 'POST', token: session.token, body: { course_id: courseId } });
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'ALREADY_ENROLLED')) return { error: describe(err) };
  }
  revalidatePath(`/${slug}/my`);
  redirect(learnPath);
}

/** Ask a question (or reply) on a day's discussion board. */
export async function postDiscussionAction(slug: string, courseId: string, moduleId: string, parentId: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/learn/${courseId}`)}`);
  const body = String(form.get('body') ?? '').trim();
  if (body.length < 2) return { error: 'اكتب سؤالك أولاً.' };
  try {
    await api(slug, `/me/modules/${encodeURIComponent(moduleId)}/discussion`, { method: 'POST', token: session.token, body: { body, parent_id: parentId } });
  } catch (err) {
    return { error: describe(err) };
  }
  revalidatePath(`/${slug}/learn/${courseId}`);
  return {};
}

export interface QuizActionState {
  status?: QuizStatus;
  result?: QuizResult;
  error?: string;
  /** The server closed the window (or it was already submitted): reload the status. */
  stale?: boolean;
  /** Ids of required questions that were left unanswered. */
  missing?: string[];
}

async function quizToken(slug: string, courseId: string): Promise<string | null> {
  if (!isValidSlug(slug)) return null;
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/learn/${courseId}`)}`);
  return session.token;
}

/** Starts (or resumes) the end-of-day quiz. The deadline is set by the API, not the browser. */
export async function startQuizAction(slug: string, courseId: string, moduleId: string): Promise<QuizActionState> {
  const token = await quizToken(slug, courseId);
  if (!token) return { error: 'أكاديمية غير معروفة.' };
  try {
    return { status: await api<QuizStatus>(slug, `/me/modules/${encodeURIComponent(moduleId)}/quiz/start`, { method: 'POST', token }) };
  } catch (err) {
    return { error: describe(err) };
  }
}

/** Sends the answers (MCQ: chosen option's index; text: the written answer). */
export async function submitQuizAction(slug: string, courseId: string, moduleId: string, answers: Record<string, QuizAnswer>): Promise<QuizActionState> {
  const token = await quizToken(slug, courseId);
  if (!token) return { error: 'أكاديمية غير معروفة.' };
  try {
    const result = await api<QuizResult>(slug, `/me/modules/${encodeURIComponent(moduleId)}/quiz/submit`, { method: 'POST', token, body: { answers } });
    return { result };
  } catch (err) {
    const stale = err instanceof ApiError && (err.code === 'QUIZ_EXPIRED' || err.code === 'QUIZ_ALREADY_SUBMITTED');
    const details = err instanceof ApiError ? (err.details as unknown as { missing?: unknown } | undefined) : undefined;
    const missing = Array.isArray(details?.missing) ? details.missing.filter((id): id is string => typeof id === 'string') : undefined;
    return { error: describe(err), stale, ...(missing ? { missing } : {}) };
  }
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
