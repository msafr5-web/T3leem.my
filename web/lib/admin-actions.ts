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
  question_count: 'عدد الأسئلة',
  capacity: 'السعة',
  join_url: 'رابط الانضمام',
  name: 'اسم الأكاديمية',
  tagline: 'الشعار النصي',
  about: 'نبذة',
  city: 'المدينة',
  primary_color: 'اللون الرئيسي',
  legal_name: 'الاسم القانوني',
  vat_number: 'الرقم الضريبي',
  status: 'الحالة',
  domain: 'النطاق',
  content_type: 'نوع الدرس',
  media_url: 'رابط الملف',
  youtube_url: 'رابط YouTube',
  days: 'عدد الأيام',
  max_lecture_minutes: 'أقصى طول للجزء',
  min_lecture_minutes: 'أدنى طول للجزء',
  break_minutes: 'الاستراحة',
  discussion_minutes: 'وقت النقاش',
  manual_duration_seconds: 'مدة الفيديو',
  body: 'النص',
  channel_url: 'رابط القناة',
  channel_name: 'اسم القناة',
  lecture_time: 'وقت المحاضرة',
};

const ERROR_MESSAGES: Record<string, string> = {
  UNKNOWN_TRAINER: 'المدرب المختار غير موجود في أكاديميتك.',
  UNKNOWN_COURSE: 'إحدى الدورات المختارة غير موجودة في أكاديميتك.',
  DUPLICATE_COURSES: 'لا يمكن إضافة الدورة نفسها مرتين إلى الخطة.',
  INVALID_PERIOD: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.',
  START_IN_PAST: 'موعد الفصل الافتراضي يجب أن يكون في المستقبل.',
  EMAIL_TAKEN: 'يوجد مستخدم بهذا البريد في أكاديميتك.',
  COURSE_NOT_FOUND: 'الدورة غير موجودة.',
  COURSE_HAS_ENROLLMENTS: 'لا يمكن حذف دورة فيها متدربون مسجلون. ألغِ نشرها بدلاً من ذلك.',
  TRAINER_IN_USE: 'هذا المدرب مسند إلى دورات. انقل دوراته إلى مدرب آخر أولاً.',
  TRAINEE_HAS_ENROLLMENTS: 'لا يمكن حذف متدرب لديه تسجيلات وفواتير.',
  MEETING_PROVIDER_ERROR: 'تعذّر إنشاء اجتماع Zoom. حاول مرة أخرى أو ألصق رابطاً يدوياً.',
  INVALID_VAT_NUMBER: 'الرقم الضريبي يتكون من ١٥ رقماً ويبدأ وينتهي بالرقم ٣.',
  UNSUPPORTED_IMAGE: 'الشعار يجب أن يكون صورة PNG أو JPEG أو WebP.',
  LOGO_TOO_LARGE: 'حجم الشعار يجب ألا يتجاوز ٥١٢ كيلوبايت.',
  PAYLOAD_TOO_LARGE: 'حجم الملف أكبر من المسموح.',
  EMPTY_FILE: 'الملف فارغ.',
  INVALID_DOMAIN: 'أدخل نطاقاً صحيحاً مثل academy.com.sa',
  PLATFORM_DOMAIN: 'نطاقات المنصة الفرعية تُخصص تلقائياً. أدخل نطاقك الخاص.',
  DOMAIN_TAKEN: 'هذا النطاق مرتبط بأكاديمية أخرى.',
  DNS_RECORD_NOT_FOUND: 'لم نجد سجل TXT بعد. قد يستغرق تحديث DNS حتى ساعة، ثم حاول مرة أخرى.',
  NO_DOMAIN: 'أضف النطاق أولاً.',
  MEDIA_URL_REQUIRED: 'دروس PDF تحتاج رابط الملف.',
  MODULE_NOT_FOUND: 'الوحدة غير موجودة.',
  LESSON_NOT_FOUND: 'الدرس غير موجود.',
  FORBIDDEN: 'ليست لديك صلاحية لهذه العملية.',
  RATE_LIMITED: 'طلبات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
  INVALID_YOUTUBE_URL: 'أدخل رابط فيديو YouTube صحيحاً.',
  INVALID_CHANNEL_URL: 'رابط القناة غير صحيح. مثال: https://www.youtube.com/@With_fouad',
  COURSE_HAS_CONTENT: 'لهذه الدورة محتوى مُضاف، فلا يمكن ربطها بفيديو YouTube.',
  YOUTUBE_VIDEO_NOT_FOUND: 'الفيديو غير موجود أو خاص. تأكد أنه عام أو غير مدرج.',
  YOUTUBE_NOT_EMBEDDABLE: 'صاحب الفيديو منع تشغيله خارج YouTube، فلا يمكن استخدامه.',
  YOUTUBE_DURATION_UNKNOWN: 'تعذّر قراءة مدة الفيديو من YouTube. أدخل المدة يدوياً.',
  TOO_MANY_DAYS: 'عدد الأيام أكبر من المناسب لمدة الفيديو وطول الجزء. قلّل الأيام أو طول الجزء.',
  VIDEO_TOO_LONG: 'الفيديوهات الأطول من ١٢ ساعة غير مدعومة.',
  TITLE_REQUIRED: 'أدخل عنوان الدورة.',
  USE_RECORDED_COURSES: 'أجزاء YouTube تُنشأ من قسم «دورات مسجلة».',
  POST_TOO_SHORT: 'اكتب الرد أولاً.',
  INVALID_QUESTION_SHEET: 'في الملف أخطاء. صحّحها ثم أعد الرفع (لم يُستورد شيء).',
  FILE_TOO_LARGE: 'حجم الملف يجب ألا يتجاوز ٢ ميغابايت.',
  FILE_REQUIRED: 'اختر ملف Excel أو CSV.',
  INVALID_QUIZ_SETTINGS: 'المدة من ١ إلى ١٨٠ دقيقة، وعدد الأسئلة من ١ إلى ٥٠.',
  QUESTION_NOT_FOUND: 'السؤال لم يعد موجوداً.',
  INVALID_QUIZ_WINDOW: 'وقت إغلاق الاختبار يجب أن يكون بعد وقت فتحه.',
  UNKNOWN_DAY: 'أحد الأيام لا يتبع هذه الدورة.',
  INVALID_QUESTION: 'تحقق من السؤال: النص مطلوب، والدرجة من ١ إلى ١٠٠، وأسئلة الاختيار من ٢ إلى ٦ خيارات غير مكررة مع تحديد الإجابة الصحيحة.',
  QUESTION_CODE_TAKEN: 'أُضيف سؤال آخر في اللحظة نفسها. حاول مرة أخرى.',
  body: 'نص السؤال',
  POST_NOT_FOUND: 'السؤال لم يعد موجوداً.',
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
async function save(
  slug: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  done: string,
  raw?: { data: Uint8Array; contentType: string },
): Promise<AdminFormState> {
  const token = await adminToken(slug);
  try {
    await api(slug, path, { method, token, body, raw });
  } catch (err) {
    const state = describeError(err);
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      state.fields = [...new Set((err.details ?? []).map((d) => FIELD_LABELS[d.field.replace(/\[\d+\]$/, '')] ?? d.field))];
    }
    return state;
  }
  revalidatePath(`/${slug}`, 'layout');
  // Name, color and logo also appear in the platform's provider directory.
  revalidatePath('/');
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

/** The YouTube schedule + source fields of the course form, as API body fields. */
function youtubeBody(form: FormData): Record<string, string | number> {
  const body: Record<string, string | number> = {};
  for (const key of [...SCHEDULE_FIELDS, ...SOURCE_FIELDS]) {
    const v = str(form, key);
    if (v !== '') body[key] = NUMERIC_FIELDS.has(key) ? Number(v) : v;
  }
  return body;
}

function failure(err: unknown): AdminFormState {
  const state = describeError(err);
  if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
    state.fields = [...new Set((err.details ?? []).map((d) => FIELD_LABELS[d.field.replace(/\[\d+\]$/, '')] ?? d.field))];
  }
  return state;
}

/**
 * New course. A recorded course with a YouTube link is checked against YouTube first (so a bad
 * link never leaves a half-made course behind), then created, then split into days and lectures.
 */
export async function createCourseAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const youtube = str(form, 'type') === 'RECORDED' && str(form, 'youtube_url') ? youtubeBody(form) : null;
  if (!youtube) return save(slug, '/admin/courses', 'POST', courseBody(form), `/${slug}/dashboard/courses`);

  const token = await adminToken(slug);
  let id: string;
  try {
    await api(slug, '/admin/recorded-courses/preview', { method: 'POST', token, body: youtube });
    ({ id } = await api<{ id: string }>(slug, '/admin/courses', { method: 'POST', token, body: courseBody(form) }));
  } catch (err) {
    return failure(err);
  }
  try {
    await api(slug, `/admin/courses/${id}/youtube`, { method: 'POST', token, body: youtube });
  } catch {
    // The course exists; send the provider to it rather than inviting a duplicate on resubmit.
    revalidatePath(`/${slug}`, 'layout');
    redirect(`/${slug}/dashboard/courses/${id}?youtube=failed`);
  }
  revalidatePath(`/${slug}`, 'layout');
  redirect(`/${slug}/dashboard/recorded/${id}?created=1`);
}

/** Edit course. Recorded YouTube courses also save channel + start date; an empty recorded course can get a YouTube link. */
export async function updateCourseAction(slug: string, courseId: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  if (!ID_RE.test(courseId)) return { error: 'طلب غير صالح.' };
  const isRecorded = form.get('recorded_course') === '1';
  const youtube = !isRecorded && str(form, 'type') === 'RECORDED' && str(form, 'youtube_url') ? youtubeBody(form) : null;
  if (!isRecorded && !youtube) return save(slug, `/admin/courses/${courseId}`, 'PUT', courseBody(form), `/${slug}/dashboard/courses`);

  const token = await adminToken(slug);
  try {
    if (youtube) await api(slug, '/admin/recorded-courses/preview', { method: 'POST', token, body: youtube });
    await api(slug, `/admin/courses/${courseId}`, { method: 'PUT', token, body: courseBody(form) });
    if (isRecorded) {
      const source: Record<string, string> = {};
      for (const key of SOURCE_FIELDS) source[key] = str(form, key);
      await api(slug, `/admin/recorded-courses/${courseId}/source`, { method: 'PUT', token, body: source });
    } else if (youtube) {
      await api(slug, `/admin/courses/${courseId}/youtube`, { method: 'POST', token, body: youtube });
    }
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/${slug}`, 'layout');
  redirect(youtube ? `/${slug}/dashboard/recorded/${courseId}?created=1` : `/${slug}/dashboard/courses`);
}

export async function createTrainerAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, '/admin/trainers', 'POST', trainerBody(form), `/${slug}/dashboard/trainers`);
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
  return save(slug, '/admin/plans', 'POST', planBody(form), `/${slug}/dashboard/plans`);
}

/** <input type="datetime-local"> has no timezone; providers schedule in Saudi time (UTC+3, no DST). */
const riyadhToIso = (local: string): string => (local ? new Date(`${local}:00+03:00`).toISOString() : '');

function classroomBody(form: FormData) {
  return {
    title: str(form, 'title'),
    starts_at: riyadhToIso(str(form, 'starts_at')),
    duration_minutes: Number(str(form, 'duration_minutes') || 0),
    capacity: optionalNumber(form, 'capacity'),
    course_id: optional(form, 'course_id'),
    trainer_id: optional(form, 'trainer_id'),
    provider: str(form, 'provider') || 'ZOOM',
    join_url: optional(form, 'join_url'),
  };
}

export async function createClassroomAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, '/admin/classrooms', 'POST', classroomBody(form), `/${slug}/dashboard/classrooms`);
}

export async function updateClassroomAction(slug: string, id: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(
    slug,
    `/admin/classrooms/${encodeURIComponent(id)}`,
    'PUT',
    { ...classroomBody(form), status: str(form, 'status') || 'SCHEDULED' },
    `/${slug}/dashboard/classrooms`,
  );
}

function trainerBody(form: FormData) {
  return { full_name: str(form, 'full_name'), specialization: optional(form, 'specialization'), bio: optional(form, 'bio'), email: optional(form, 'email') };
}

export async function updateTrainerAction(slug: string, id: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, `/admin/trainers/${encodeURIComponent(id)}`, 'PUT', trainerBody(form), `/${slug}/dashboard/trainers`);
}

export async function updateTraineeAction(slug: string, id: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, `/admin/trainees/${encodeURIComponent(id)}`, 'PUT', { full_name: str(form, 'full_name') }, `/${slug}/dashboard/trainees`);
}

function planBody(form: FormData) {
  return {
    title: str(form, 'title'),
    type: str(form, 'type'),
    status: str(form, 'status') || 'DRAFT',
    description: optional(form, 'description'),
    starts_on: optional(form, 'starts_on'),
    ends_on: optional(form, 'ends_on'),
    course_ids: form.getAll('course_ids').map(String),
  };
}

export async function updatePlanAction(slug: string, id: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, `/admin/plans/${encodeURIComponent(id)}`, 'PUT', planBody(form), `/${slug}/dashboard/plans`);
}

// ----- deletes (one generic action: resource kind is whitelisted, never a free-form path) -----

const DELETABLE = {
  courses: 'courses',
  trainers: 'trainers',
  trainees: 'trainees',
  plans: 'plans',
  classrooms: 'classrooms',
} as const;

export async function deleteAction(slug: string, kind: keyof typeof DELETABLE, id: string, _prev: AdminFormState): Promise<AdminFormState> {
  const resource = DELETABLE[kind];
  if (!resource || !/^[0-9a-f-]{36}$/i.test(id)) return { error: 'طلب غير صالح.' };
  return save(slug, `/admin/${resource}/${id}`, 'DELETE', undefined, `/${slug}/dashboard/${resource}`);
}

// ----- course content -----

export async function createModuleAction(slug: string, courseId: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, `/admin/courses/${encodeURIComponent(courseId)}/modules`, 'POST', { title: str(form, 'title') }, `/${slug}/dashboard/courses/${courseId}/content`);
}

export async function createLessonAction(slug: string, courseId: string, moduleId: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(
    slug,
    `/admin/modules/${encodeURIComponent(moduleId)}/lessons`,
    'POST',
    { title: str(form, 'title'), content_type: str(form, 'content_type'), media_url: optional(form, 'media_url') },
    `/${slug}/dashboard/courses/${courseId}/content`,
  );
}

const ID_RE = /^[0-9a-f-]{36}$/i;

export async function deleteModuleAction(slug: string, courseId: string, moduleId: string, _prev: AdminFormState): Promise<AdminFormState> {
  if (!ID_RE.test(moduleId)) return { error: 'طلب غير صالح.' };
  return save(slug, `/admin/modules/${moduleId}`, 'DELETE', undefined, `/${slug}/dashboard/courses/${courseId}/content`);
}

export async function deleteLessonAction(slug: string, courseId: string, lessonId: string, _prev: AdminFormState): Promise<AdminFormState> {
  if (!ID_RE.test(lessonId)) return { error: 'طلب غير صالح.' };
  return save(slug, `/admin/lessons/${lessonId}`, 'DELETE', undefined, `/${slug}/dashboard/courses/${courseId}/content`);
}

// ----- recorded (YouTube) courses -----

const SCHEDULE_FIELDS = ['youtube_url', 'split_mode', 'days', 'max_lecture_minutes', 'min_lecture_minutes', 'break_minutes', 'discussion_minutes', 'manual_duration_seconds'] as const;
const SOURCE_FIELDS = ['channel_url', 'channel_name', 'starts_on', 'lecture_time'] as const;
const NUMERIC_FIELDS = new Set<string>(['days', 'max_lecture_minutes', 'min_lecture_minutes', 'break_minutes', 'discussion_minutes', 'manual_duration_seconds']);

/** Creates the course + its days and lectures in one call, then opens its schedule page. */
export async function createRecordedCourseAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const token = await adminToken(slug);
  const body: Record<string, unknown> = {
    title: optional(form, 'title'),
    description: optional(form, 'description'),
    trainer_id: str(form, 'trainer_id'),
    price: Number(str(form, 'price') || 0),
    is_published: form.get('is_published') === 'on',
  };
  for (const key of [...SCHEDULE_FIELDS, ...SOURCE_FIELDS]) {
    const v = str(form, key);
    if (v !== '') body[key] = NUMERIC_FIELDS.has(key) ? Number(v) : v;
  }
  let id: string;
  try {
    ({ id } = await api<{ id: string }>(slug, '/admin/recorded-courses', { method: 'POST', token, body }));
  } catch (err) {
    const state = describeError(err);
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      state.fields = [...new Set((err.details ?? []).map((d) => FIELD_LABELS[d.field] ?? d.field))];
    }
    return state;
  }
  revalidatePath(`/${slug}`, 'layout');
  redirect(`/${slug}/dashboard/recorded/${id}?created=1`);
}

/** Channel + start date/time of an existing recorded course. */
export async function updateRecordedSourceAction(slug: string, courseId: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  if (!ID_RE.test(courseId)) return { error: 'طلب غير صالح.' };
  const body: Record<string, string> = {};
  for (const key of SOURCE_FIELDS) body[key] = str(form, key);
  return save(slug, `/admin/recorded-courses/${courseId}/source`, 'PUT', body, `/${slug}/dashboard/recorded/${courseId}?saved=1`);
}

/** Trainer/admin answer (or new note) on a day's discussion board. */
export async function adminPostDiscussionAction(
  slug: string,
  courseId: string,
  moduleId: string,
  parentId: string | null,
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  if (!ID_RE.test(moduleId) || (parentId !== null && !ID_RE.test(parentId))) return { error: 'طلب غير صالح.' };
  const token = await adminToken(slug);
  try {
    await api(slug, `/admin/modules/${moduleId}/discussion`, { method: 'POST', token, body: { body: str(form, 'body'), parent_id: parentId } });
  } catch (err) {
    return describeError(err);
  }
  revalidatePath(`/${slug}/dashboard/recorded/${courseId}`);
  revalidatePath(`/${slug}/learn/${courseId}`);
  return {};
}

// ----- custom domain -----

export async function setDomainAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(slug, '/tenant/domain', 'PUT', { domain: str(form, 'domain') }, `/${slug}/dashboard/settings#domain`);
}

export async function verifyDomainAction(slug: string, _prev: AdminFormState): Promise<AdminFormState> {
  return save(slug, '/tenant/domain/verify', 'POST', {}, `/${slug}/dashboard/settings?saved=1#domain`);
}

export async function removeDomainAction(slug: string, _prev: AdminFormState): Promise<AdminFormState> {
  return save(slug, '/tenant/domain', 'DELETE', undefined, `/${slug}/dashboard/settings#domain`);
}

// ----- settings & branding -----

export async function updateBrandingAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(
    slug,
    '/tenant/branding',
    'PUT',
    {
      name: str(form, 'name'),
      tagline: optional(form, 'tagline'),
      about: optional(form, 'about'),
      city: optional(form, 'city'),
      primary_color: optional(form, 'primary_color'),
      legal_name: optional(form, 'legal_name'),
      vat_number: optional(form, 'vat_number'),
    },
    `/${slug}/dashboard/settings?saved=1`,
  );
}

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO = 512 * 1024;

export async function uploadLogoAction(slug: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const file = form.get('logo');
  if (!(file instanceof File) || file.size === 0) return { error: 'اختر ملف الشعار.' };
  // Early, friendly checks; the API re-verifies the actual bytes (magic numbers) regardless.
  if (!LOGO_TYPES.has(file.type)) return { error: ERROR_MESSAGES.UNSUPPORTED_IMAGE };
  if (file.size > MAX_LOGO) return { error: ERROR_MESSAGES.LOGO_TOO_LARGE };
  const data = new Uint8Array(await file.arrayBuffer());
  return save(slug, '/tenant/branding/logo', 'PUT', undefined, `/${slug}/dashboard/settings?saved=1`, { data, contentType: file.type });
}

export async function removeLogoAction(slug: string, _prev: AdminFormState): Promise<AdminFormState> {
  return save(slug, '/tenant/branding/logo', 'DELETE', undefined, `/${slug}/dashboard/settings?saved=1`);
}


// ---- End-of-day quiz: question bank (Excel) and settings -------------------------------------

export interface QuizImportState extends AdminFormState {
  /** Row-level problems from the sheet (nothing was imported). */
  rowErrors?: { row: number; message: string }[];
  totalErrors?: number;
  done?: string;
}

const MAX_SHEET = 2 * 1024 * 1024;

export async function importQuizAction(slug: string, courseId: string, _prev: QuizImportState, form: FormData): Promise<QuizImportState> {
  const token = await adminToken(slug);
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: ERROR_MESSAGES.FILE_REQUIRED };
  if (file.size > MAX_SHEET) return { error: ERROR_MESSAGES.FILE_TOO_LARGE };
  const mode = form.get('mode') === 'replace' ? 'replace' : 'append';
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const r = await api<{ created: number; updated: number; removed: number }>(slug, `/admin/recorded-courses/${encodeURIComponent(courseId)}/quiz/import?mode=${mode}`, {
      method: 'POST',
      token,
      raw: { data, contentType: 'application/octet-stream' },
    });
    revalidatePath(`/${slug}/dashboard/recorded/${courseId}`);
    const parts = [`أُضيف ${r.created}`, `حُدّث ${r.updated}`];
    if (r.removed > 0) parts.push(`حُذف ${r.removed}`);
    return { done: `تم الاستيراد: ${parts.join('، ')} سؤالاً.` };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'INVALID_QUESTION_SHEET') {
      const d = err.details as unknown as { errors?: { row: number; message: string }[]; total_errors?: number } | undefined;
      return { error: ERROR_MESSAGES.INVALID_QUESTION_SHEET, rowErrors: d?.errors ?? [], totalErrors: d?.total_errors ?? d?.errors?.length ?? 0 };
    }
    return describeError(err);
  }
}

export async function saveQuizSettingsAction(slug: string, courseId: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return save(
    slug,
    `/admin/recorded-courses/${encodeURIComponent(courseId)}/quiz-settings`,
    'PUT',
    { duration_minutes: Number(str(form, 'duration_minutes')), question_count: Number(str(form, 'question_count')) },
    `/${slug}/dashboard/recorded/${courseId}?saved=quiz#quiz`,
  );
}

export async function deleteQuizQuestionAction(slug: string, courseId: string, questionId: string, _prev: AdminFormState): Promise<AdminFormState> {
  return save(slug, `/admin/recorded-courses/${encodeURIComponent(courseId)}/quiz/questions/${encodeURIComponent(questionId)}`, 'DELETE', undefined, `/${slug}/dashboard/recorded/${courseId}?saved=quiz#quiz`);
}

/** Opening / closing time of each day's quiz. Inputs are Saudi time (UTC+3, no daylight saving). */
export async function saveQuizWindowsAction(slug: string, courseId: string, _prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const toIso = (v: string): string | null | undefined => {
    if (!v) return null;
    const d = new Date(`${v}:00+03:00`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const windows: { day_id: string; opens_at: string | null; closes_at: string | null }[] = [];
  for (const dayId of form.getAll('day_id').map(String)) {
    const opens = toIso(str(form, `opens_${dayId}`));
    const closes = toIso(str(form, `closes_${dayId}`));
    if (opens === undefined || closes === undefined) return { error: 'تاريخ أو وقت غير صالح.' };
    windows.push({ day_id: dayId, opens_at: opens, closes_at: closes });
  }
  if (windows.length === 0) return { error: 'لا توجد أيام لحفظ مواعيدها.' };
  return save(slug, `/admin/recorded-courses/${encodeURIComponent(courseId)}/quiz-windows`, 'PUT', { windows }, `/${slug}/dashboard/recorded/${courseId}?saved=quiz#quiz`);
}

export interface QuizFormResult {
  ok: boolean;
  error?: string;
  /** Client key -> server id for every question created, even when a later one failed (so a retry never duplicates). */
  created: Record<string, string>;
  /** Client key of the question whose save failed. */
  failedKey?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FORM_CHANGES = 200;
const QUESTION_TYPES = new Set(['MCQ', 'CHECKBOX', 'SHORT', 'TEXT', 'RATING']);

/**
 * Saves the quiz form builder: the questions that were added or edited, then the ones removed,
 * through the same per-question endpoints (and the same server-side validation) as the single
 * question form. Stays on the page instead of redirecting, so the supervisor keeps their place.
 * Sequential on purpose: question codes are numbered by the API, and parallel creates would collide.
 */
export async function saveQuizFormAction(slug: string, courseId: string, raw: string): Promise<QuizFormResult> {
  const token = await adminToken(slug);
  const created: Record<string, string> = {};
  const fail = (error: string, failedKey?: string): QuizFormResult => ({ ok: false, error, created, ...(failedKey ? { failedKey } : {}) });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('تعذّر قراءة الأسئلة. أعد تحميل الصفحة وحاول مرة أخرى.');
  }
  const input = parsed as { upserts?: unknown; deletes?: unknown };
  if (!Array.isArray(input.upserts) || !Array.isArray(input.deletes) || input.upserts.length + input.deletes.length > MAX_FORM_CHANGES) {
    return fail(`عدد التغييرات كبير. احفظ على دفعات، أو استورد الأسئلة من ملف Excel (حتى ${MAX_FORM_CHANGES} تغييراً في الحفظ الواحد).`);
  }
  const deletes = input.deletes.filter((id): id is string => typeof id === 'string' && UUID.test(id));
  if (deletes.length !== input.deletes.length) return fail('بيانات غير صالحة.');

  const base = `/admin/recorded-courses/${encodeURIComponent(courseId)}/quiz/questions`;
  try {
    for (const item of input.upserts as Record<string, unknown>[]) {
      const key = typeof item.key === 'string' ? item.key : '';
      const id = typeof item.id === 'string' ? item.id : null;
      if (!key || (id !== null && !UUID.test(id))) return fail('بيانات غير صالحة.', key || undefined);
      // The API validates every field again; only the shape the form is allowed to send is forwarded.
      const body = {
        day_id: typeof item.day_id === 'string' && UUID.test(item.day_id) ? item.day_id : null,
        body: String(item.body ?? ''),
        type: QUESTION_TYPES.has(String(item.type)) ? String(item.type) : 'MCQ',
        difficulty: item.difficulty === 'EASY' || item.difficulty === 'HARD' ? item.difficulty : 'MEDIUM',
        options: Array.isArray(item.options) ? item.options.map(String) : [],
        correct_answer: String(item.correct_answer ?? ''),
        correct_options: Array.isArray(item.correct_options) ? item.correct_options.map(String) : [],
        points: Number.isInteger(item.points) ? item.points : 1,
        required: item.required === true,
      };
      try {
        if (id) await api(slug, `${base}/${encodeURIComponent(id)}`, { method: 'PUT', token, body });
        else created[key] = (await api<{ id: string }>(slug, base, { method: 'POST', token, body })).id;
      } catch (err) {
        return fail(describeError(err).error ?? 'تعذّر حفظ السؤال.', key);
      }
    }
    for (const id of deletes) {
      try {
        await api(slug, `${base}/${encodeURIComponent(id)}`, { method: 'DELETE', token });
      } catch (err) {
        // Already gone (e.g. deleted in another tab): the goal is met.
        if (!(err instanceof ApiError && err.code === 'QUESTION_NOT_FOUND')) return fail(describeError(err).error ?? 'تعذّر حذف السؤال.');
      }
    }
  } catch (err) {
    return fail(describeError(err).error ?? 'حدث خطأ غير متوقع.');
  }
  revalidatePath(`/${slug}/dashboard/recorded/${courseId}`);
  return { ok: true, created };
}
