'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { ApiError, ApiUnavailableError, api, platformApi, type CheckoutResponse, type LoginResponse, type QuizResult, type QuizStatus } from './api';
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
  COURSE_NOT_FREE: 'هذه الدورة مدفوعة. أكمل الشراء من صفحة الدفع.',
  POST_TOO_SHORT: 'اكتب سؤالك أولاً.',
  POST_NOT_FOUND: 'السؤال الذي ترد عليه لم يعد موجوداً.',
  QUIZ_NOT_AVAILABLE: 'لا توجد أسئلة لاختبار هذا اليوم بعد.',
  QUIZ_NOT_STARTED: 'ابدأ الاختبار أولاً.',
  QUIZ_ALREADY_SUBMITTED: 'سلّمت هذا الاختبار من قبل.',
  QUIZ_EXPIRED: 'انتهى وقت الاختبار قبل وصول إجاباتك.',
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

  let role: string;
  try {
    const res = await api<LoginResponse>(slug, '/auth/login', { method: 'POST', body: { email, password } });
    await setSession(slug, { token: res.access_token, email: res.user.email, role: res.user.role }, res.expires_in);
    role = res.user.role;
  } catch (err) {
    return { error: describe(err) };
  }
  // redirect() throws, so it must stay outside the try block. Admins land on their
  // dashboard unless they were sent to login from a specific page.
  const next = form.get('next');
  const fallback = role === 'TENANT_ADMIN' ? `/${slug}/dashboard` : `/${slug}`;
  redirect(typeof next === 'string' && next ? safeNextPath(slug, next) : fallback);
}

export interface JoinState extends FormState {
  fields?: string[];
}

const JOIN_FIELDS: Record<string, string> = {
  academy_name: 'اسم الأكاديمية',
  slug: 'عنوان الموقع',
  city: 'المدينة',
  admin_name: 'اسم المسؤول',
  admin_email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  accept_terms: 'الموافقة على الشروط',
};

const JOIN_ERRORS: Record<string, string> = {
  SLUG_TAKEN: 'عنوان الموقع مستخدم من أكاديمية أخرى. اختر عنواناً آخر.',
  SLUG_RESERVED: 'هذا العنوان محجوز للمنصة. اختر عنواناً آخر.',
  FORBIDDEN: 'التسجيل الذاتي للمزودين مغلق حالياً. تواصل مع فريق المنصة.',
  RATE_LIMITED: 'محاولات تسجيل كثيرة من هذا الجهاز. حاول بعد ساعة.',
};

/** Self-service provider sign-up: creates the academy, then signs its admin straight in. */
export async function registerProviderAction(_prev: JoinState, form: FormData): Promise<JoinState> {
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  const email = String(form.get('admin_email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  try {
    await platformApi('/providers', {
      method: 'POST',
      body: {
        academy_name: String(form.get('academy_name') ?? '').trim(),
        slug,
        city: String(form.get('city') ?? '').trim() || null,
        admin_name: String(form.get('admin_name') ?? '').trim(),
        admin_email: email,
        password,
        accept_terms: form.get('accept_terms') === 'on',
      },
    });
    const login = await api<LoginResponse>(slug, '/auth/login', { method: 'POST', body: { email, password } });
    await setSession(slug, { token: login.access_token, email: login.user.email, role: login.user.role }, login.expires_in);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      return { error: 'تحقق من الحقول المميزة.', fields: [...new Set((err.details ?? []).map((d) => JOIN_FIELDS[d.field] ?? d.field))] };
    }
    if (err instanceof ApiError && JOIN_ERRORS[err.code]) return { error: JOIN_ERRORS[err.code] };
    return { error: describe(err) };
  }
  redirect(`/${slug}/dashboard/settings?welcome=1`);
}

/** PRD §6 learner self-registration in this academy, then signed straight in. */
export async function registerLearnerAction(slug: string, _prev: JoinState, form: FormData): Promise<JoinState> {
  if (!isValidSlug(slug)) return { error: 'أكاديمية غير معروفة.' };
  try {
    const res = await api<LoginResponse>(slug, '/auth/register', {
      method: 'POST',
      body: {
        full_name: String(form.get('full_name') ?? '').trim(),
        email: String(form.get('email') ?? '').trim(),
        password: String(form.get('password') ?? ''),
      },
    });
    await setSession(slug, { token: res.access_token, email: res.user.email, role: res.user.role }, res.expires_in);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') return { error: 'يوجد حساب بهذا البريد في هذه الأكاديمية. سجّل الدخول بدلاً من ذلك.' };
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      return { error: 'تحقق من الحقول المميزة.', fields: [...new Set((err.details ?? []).map((d) => ({ full_name: 'الاسم الكامل', email: 'البريد الإلكتروني', password: 'كلمة المرور' })[d.field] ?? d.field))] };
    }
    return { error: describe(err) };
  }
  redirect(safeNextPath(slug, form.get('next')) === `/${slug}` ? `/${slug}/my` : safeNextPath(slug, form.get('next')));
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
export async function submitQuizAction(slug: string, courseId: string, moduleId: string, answers: Record<string, string | number>): Promise<QuizActionState> {
  const token = await quizToken(slug, courseId);
  if (!token) return { error: 'أكاديمية غير معروفة.' };
  try {
    const result = await api<QuizResult>(slug, `/me/modules/${encodeURIComponent(moduleId)}/quiz/submit`, { method: 'POST', token, body: { answers } });
    return { result };
  } catch (err) {
    const stale = err instanceof ApiError && (err.code === 'QUIZ_EXPIRED' || err.code === 'QUIZ_ALREADY_SUBMITTED');
    return { error: describe(err), stale };
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
