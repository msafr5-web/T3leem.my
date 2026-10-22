'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, ApiUnavailableError, api } from './api';
import { isValidSlug } from './format';
import { getSession } from './session';

/**
 * Provider-dashboard mutations. These run on the Next.js server with the admin's token from
 * the httpOnly session cookie; the API independently enforces TENANT_ADMIN + tenant binding,
 * so the role check here is only for a friendly redirect, not the security boundary.
 */

export interface AdminFormState {
  error?: string;
  fields?: string[];
}

const FIELD_LABELS: Record<string, string> = {
  title: 'العنوان',
  type: 'النوع',
  price: 'السعر',
  trainer_id: 'المدرب',
  license_number: 'رقم الترخيص',
  license_authority: 'جهة الترخيص',
  license_expires_on: 'تاريخ انتهاء الترخيص',
  accreditation_number: 'رقم الاعتماد',
  training_hours: 'عدد الساعات',
  duration_days: 'المدة بالأيام',
  description: 'الوصف',
  full_name: 'الاسم الكامل',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  specialization: 'التخصص',
  starts_on: 'تاريخ البداية',
  ends_on: 'تاريخ النهاية',
  course_ids: 'الدورات',
  starts_at: 'موعد البدء',
  duration_minutes: 'المدة بالدقائق',
  capacity: 'السعة',
  join_url: 'رابط الانضمام',
};

const ERROR_MESSAGES: Record<string, string> = {
  UNKNOWN_TRAINER: 'المدرب المختار غير موجود في أكاديميتك.',
  UNKNOWN_COURSE: 'إحدى الدورات المختارة غير موجودة في أكاديميتك.',
  DUPLICATE_COURSES: 'لا يمكن إضافة الدورة نفسها مرتين إلى الخطة.',
  INVALID_PERIOD: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.',
  START_IN_PAST: 'موعد الفصل الافتراضي يجب أن يكون في المستقبل.',
  EMAIL_TAKEN: 'يوجد مستخدم بهذا البريد في أكاديميتك.',
  COURSE_NOT_FOUND: 'الدورة غير موجودة.',
  FORBIDDEN: 'ليست لديك صلاحية لهذه العملية.',
  RATE_LIMITED: 'طلبات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
};

function describeError(err: unknown): AdminFormState {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_FAILED') return { error: 'تحقق من الحقول المميزة.', fields: [] };
    return { error: ERROR_MESSAGES[err.code] ?? 'تعذّر حفظ البيانات. حاول مرة أخرى.' };
  }
  if (err instanceof ApiUnavailableError) return { error: 'تعذّر الاتصال بالخادم. حاول بعد قليل.' };
  return { error: 'حدث خطأ غير متوقع.' };
}

async function adminToken(slug: string): Promise<string> {
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/dashboard`)}`);
  if (session.role !== 'TENANT_ADMIN') redirect(`/${slug}`);
  return session.token;
}

const str = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();
const optional = (form: FormData, key: string): string | null => str(form, key) || null;
const optionalNumber = (form: FormData, key: string): number | null => {
  const v = str(form, key);
  return v === '' ? null : Number(v);
};

/** Turns API validation details into the Arabic names of the offending fields. */
async function save(slug: string, path: string, method: 'POST' | 'PUT', body: unknown, done: string): Promise<AdminFormState> {
  const token = await adminToken(slug);
  try {
    await api(slug, path, { method, token, body });
  } catch (err) {
    const state = describeError(err);
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      state.fields = [...new Set((err.details ?? []).map((d) => FIELD_LABELS[d.field.replace(/\[\d+\]$/, '')] ?? d.field))];
    }
    return state;
  }
  revalidatePath(`/${slug}`, 'layout');
  redirect(done);
}

function courseBody(form: FormData) {
  return {
    title: str(form, 'title'),
    type: str(form, 'type'),
    price: Number(str(form, 'price') || 0),
    trainer_id: str(form, 'trainer_id'),
    description: optional(form, 'description'),
    license_number: optional(form, 'license_number'),
    license_authority: optional(form, 'license_authority'),
    license_expires_on: optional(form, 'license_expires_on'),
    accreditation_number: optional(form, 'accreditation_number'),
    training_hours: optionalNumber(form, 'training_hours'),
    duration_days: optionalNumber(form, 'duration_days'),
    is_published: form.get('is_published') === 'on',
  };
}

export async function createCourseAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, '/admin/courses', 'POST', courseBody(form), `/${slug}/dashboard/courses`);
}

export async function updateCourseAction(slug: string, courseId: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, `/admin/courses/${encodeURIComponent(courseId)}`, 'PUT', courseBody(form), `/${slug}/dashboard/courses`);
}

export async function createTrainerAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(
    slug,
    '/admin/trainers',
    'POST',
    { full_name: str(form, 'full_name'), specialization: optional(form, 'specialization'), bio: optional(form, 'bio'), email: optional(form, 'email') },
    `/${slug}/dashboard/trainers`,
  );
}

export async function createTraineeAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(
    slug,
    '/admin/trainees',
    'POST',
    { full_name: str(form, 'full_name'), email: str(form, 'email'), password: String(form.get('password') ?? '') },
    `/${slug}/dashboard/trainees`,
  );
}

export async function createPlanAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(
    slug,
    '/admin/plans',
    'POST',
    {
      title: str(form, 'title'),
      type: str(form, 'type'),
      status: str(form, 'status') || 'DRAFT',
      description: optional(form, 'description'),
      starts_on: optional(form, 'starts_on'),
      ends_on: optional(form, 'ends_on'),
      course_ids: form.getAll('course_ids').map(String),
    },
    `/${slug}/dashboard/plans`,
  );
}

export async function createClassroomAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  // <input type="datetime-local"> has no timezone; providers schedule in Saudi time (UTC+3, no DST).
  const local = str(form, 'starts_at');
  const startsAt = local ? new Date(`${local}:00+03:00`).toISOString() : '';
  return save(
    slug,
    '/admin/classrooms',
    'POST',
    {
      title: str(form, 'title'),
      starts_at: startsAt,
      duration_minutes: Number(str(form, 'duration_minutes') || 0),
      capacity: optionalNumber(form, 'capacity'),
      course_id: optional(form, 'course_id'),
      trainer_id: optional(form, 'trainer_id'),
      provider: str(form, 'provider') || 'ZOOM',
      join_url: optional(form, 'join_url'),
    },
    `/${slug}/dashboard/classrooms`,
  );
}
