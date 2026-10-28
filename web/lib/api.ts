import 'server-only';

/**
 * Server-side client for the t3leem API. Runs only on the Next.js server (Server Components
 * and Server Actions), so the API URL and access tokens never reach the browser and no CORS
 * is involved. The academy is identified by its slug via `x-tenant-slug`.
 */

export interface Price {
  net: number;
  vat: number;
  total: number;
  currency: 'SAR';
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  brand_settings: {
    primaryColor?: string;
    logoUrl?: string | null;
    locale?: string;
    tagline?: string;
    about?: string;
    city?: string;
  } | null;
  logo_version: string | null;
}

export interface CourseSummary {
  id: string;
  title: string;
  type: 'RECORDED' | 'LIVE';
  price: Price;
  training_hours: number | null;
  duration_days: number | null;
  accreditation_number: string | null;
  trainer_name: string;
  module_count: number;
  lesson_count: number;
}

export interface License {
  number: string | null;
  authority: string | null;
  expires_on: string | null;
}

export interface CourseDetail extends CourseSummary {
  description: string | null;
  license: License;
  trainer: { id: string; full_name: string; specialization: string | null; bio: string | null };
  modules: { id: string; title: string; lessons: { id: string; title: string; content_type: LessonContentType }[] }[];
}

export interface Provider {
  slug: string;
  name: string;
  tagline: string | null;
  city: string | null;
  primary_color: string | null;
  logo_version: string | null;
}

export interface AdminBranding {
  name: string;
  slug: string;
  tagline: string | null;
  about: string | null;
  city: string | null;
  primary_color: string | null;
  legal_name: string | null;
  vat_number: string | null;
  has_logo: boolean;
  logo_version: string | null;
}

export interface Trainer {
  id: string;
  full_name: string;
  specialization: string | null;
  bio: string | null;
  course_count: number;
}

export interface AdminTrainer extends Trainer {
  email: string | null;
  has_account: boolean;
}

export type PlanType = 'TRAINING' | 'DEVELOPMENT';
export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface Plan {
  id: string;
  title: string;
  description: string | null;
  type: PlanType;
  status: PlanStatus;
  starts_on: string | null;
  ends_on: string | null;
  total_hours: number;
  courses: { id: string; title: string; training_hours: number | null; is_published: boolean }[];
}

export type MeetingProvider = 'ZOOM' | 'TEAMS' | 'GOOGLE_MEET' | 'OTHER';

export interface Classroom {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number | null;
  provider: MeetingProvider;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  join_url?: string | null;
  course: { id: string; title: string } | null;
  trainer: { id: string; full_name: string } | null;
}

export interface AdminCourse {
  id: string;
  title: string;
  description: string | null;
  type: 'RECORDED' | 'LIVE';
  price: Price;
  trainer: { id: string; full_name: string };
  license: License;
  accreditation_number: string | null;
  training_hours: number | null;
  duration_days: number | null;
  is_published: boolean;
  enrollment_count: number;
}

export interface Trainee {
  id: string;
  email: string;
  full_name: string | null;
  enrollment_count: number;
  created_at: string;
}

export interface MyEnrollment {
  enrollment_id: string;
  course_id: string;
  course_title: string;
  trainer_name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  completion_status: 'ENROLLED' | 'COMPLETED';
  progress: number;
  lesson_count: number;
  certificate_code: string | null;
  enrolled_at: string;
}

export type LessonContentType = 'VIDEO' | 'ZOOM' | 'PDF' | 'YOUTUBE';

export interface MyLesson {
  id: string;
  title: string;
  content_type: LessonContentType;
  media_url: string | null;
  video_ready: boolean | null;
  duration_seconds: number | null;
  /** YOUTUBE lessons: the segment of the course's source video. */
  start_second: number | null;
  end_second: number | null;
  completed: boolean;
}

export interface MyCourse {
  enrollment_id: string;
  course_title: string;
  progress: number;
  completion_status: 'ENROLLED' | 'COMPLETED';
  certificate_code: string | null;
  youtube_video_id: string | null;
  schedule: { break_minutes: number; discussion_minutes: number } | null;
  modules: { id: string; title: string; lessons: MyLesson[] }[];
}

export interface ScheduleSettings {
  max_lecture_minutes: number;
  min_lecture_minutes: number;
  break_minutes: number;
  discussion_minutes: number;
  daily_video_minutes: number;
}

export interface SchedulePreview {
  video: { id: string; title: string; channel: string; duration_seconds: number; duration_source: 'youtube' | 'manual' };
  config: ScheduleSettings;
  plan: {
    video_seconds: number;
    lecture_count: number;
    training_hours: number;
    days: { day: number; video_seconds: number; break_count: number; total_minutes: number; lectures: { start_second: number; end_second: number }[] }[];
  };
}

export interface RecordedCourseSummary {
  id: string;
  title: string;
  is_published: boolean;
  video_id: string;
  duration_seconds: number;
  day_count: number;
  lecture_count: number;
  enrollment_count: number;
  post_count: number;
}

export interface RecordedCourseDetail {
  id: string;
  title: string;
  is_published: boolean;
  video_id: string;
  duration_seconds: number;
  enrollment_count: number;
  training_hours: number | null;
  config: ScheduleSettings | null;
  days: { id: string; title: string; post_count: number; lessons: { id: string; title: string; start_second: number; end_second: number }[] }[];
}

export interface DiscussionPost {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
  author_is_staff: boolean;
  mine: boolean;
}

export interface DiscussionThread extends DiscussionPost {
  replies: DiscussionPost[];
}

export interface MyClassroom {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  provider: MeetingProvider;
  join_url: string | null;
  course_title: string | null;
}

export interface CertificateVerification {
  valid: true;
  code: string;
  issued_at: string;
  learner_name: string;
  course_title: string;
  training_hours: number | null;
  accreditation_number: string | null;
  license_number: string | null;
  trainer_name: string;
  academy: { name: string; slug: string };
}

export type HlsStatus = 'NONE' | 'PROCESSING' | 'READY' | 'FAILED';

export interface ContentModule {
  id: string;
  title: string;
  sort_order: number;
  lessons: {
    id: string;
    title: string;
    content_type: LessonContentType;
    sort_order: number;
    media_url: string | null;
    hls_status: HlsStatus;
    hls_error: string | null;
    duration_seconds: number | null;
    start_second: number | null;
    end_second: number | null;
  }[];
}

export interface DomainStatus {
  domain: string | null;
  verified: boolean;
  dns: { txt: { name: string; value: string }; cname: { name: string; target: string } } | null;
}

export interface Attendance {
  name: string;
  email: string | null;
  joined_at: string;
  is_trainee: boolean;
}

export interface IssuedCertificate {
  code: string;
  issued_at: string;
  learner_name: string;
  course_title: string;
}

export interface Overview {
  counts: { courses: number; published_courses: number; trainers: number; trainees: number; active_plans: number; enrollments: number };
  revenue_total: number;
  upcoming_classrooms: Classroom[];
  recent_enrollments: { id: string; created_at: string; trainee_name: string; course_title: string }[];
}

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: { id: string; email: string; role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'INSTRUCTOR' | 'LEARNER' };
}

export interface CheckoutResponse {
  enrollment_id: string;
  status: string;
  invoice: { invoice_number: string; total_amount: number; vat_amount: number; zatca_qr_base64: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown when API_URL is missing or the API can't be reached — rendered as a friendly outage page. */
export class ApiUnavailableError extends Error {
  constructor(reason: string) {
    super(`API unavailable: ${reason}`);
    this.name = 'ApiUnavailableError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token?: string;
  body?: unknown;
  /** Binary upload (e.g. a logo) sent as-is with its own content type, instead of JSON. */
  raw?: { data: Uint8Array; contentType: string };
  /** Seconds to cache a GET in Next's data cache; omit for no caching. */
  revalidate?: number;
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: { field: string; message: string }[] } };

/** Tenant-scoped request (the academy is identified by its slug). */
export function api<T>(slug: string, path: string, opts: RequestOptions = {}): Promise<T> {
  return request<T>(path, { 'x-tenant-slug': slug }, opts);
}

/** Platform-level request: no tenant (e.g. the provider directory). */
export function platformApi<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return request<T>(`/platform${path}`, {}, opts);
}

async function request<T>(path: string, scope: Record<string, string>, opts: RequestOptions): Promise<T> {
  const base = process.env.API_URL;
  if (!base) throw new ApiUnavailableError('API_URL is not configured');

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...scope,
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.raw ? { 'Content-Type': opts.raw.contentType } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.raw ? (opts.raw.data as BodyInit) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      ...(opts.revalidate !== undefined && !opts.token ? { next: { revalidate: opts.revalidate } } : { cache: 'no-store' }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ApiUnavailableError(err instanceof Error ? err.message : 'network error');
  }

  if (res.status === 204) return undefined as T;

  let payload: Envelope<T>;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiUnavailableError(`non-JSON response (HTTP ${res.status})`);
  }
  // Only OUR envelope counts as an API answer. A misconfigured API_URL can return foreign JSON
  // (e.g. Vercel's {"error":{"code":"DEPLOYMENT_NOT_FOUND"}}) that would otherwise be mistaken
  // for an application error and crash pages instead of showing the outage screen.
  if (typeof payload !== 'object' || payload === null || typeof (payload as { success?: unknown }).success !== 'boolean') {
    throw new ApiUnavailableError(`unexpected response from API_URL (HTTP ${res.status}) — is it the t3leem API?`);
  }
  if (!payload.success) throw new ApiError(res.status, payload.error.code, payload.error.message, payload.error.details);
  return payload.data;
}

export const getTenant = (slug: string) => api<Tenant>(slug, '/tenant', { revalidate: 60 });
export const getCourses = (slug: string) => api<CourseSummary[]>(slug, '/courses', { revalidate: 60 });
export const getCourse = (slug: string, id: string) => api<CourseDetail>(slug, `/courses/${encodeURIComponent(id)}`, { revalidate: 60 });
export const getPlans = (slug: string) => api<Plan[]>(slug, '/plans', { revalidate: 60 });
export const getTrainers = (slug: string) => api<Trainer[]>(slug, '/trainers', { revalidate: 60 });
export const getUpcomingClassrooms = (slug: string) => api<Classroom[]>(slug, '/classrooms/upcoming', { revalidate: 60 });
export const getProviders = () => platformApi<Provider[]>('/providers', { revalidate: 60 });

/** Provider dashboard reads (TENANT_ADMIN token; never cached). */
export const admin = {
  overview: (slug: string, token: string) => api<Overview>(slug, '/admin/overview', { token }),
  courses: (slug: string, token: string) => api<AdminCourse[]>(slug, '/admin/courses', { token }),
  course: (slug: string, token: string, id: string) => api<AdminCourse>(slug, `/admin/courses/${encodeURIComponent(id)}`, { token }),
  trainers: (slug: string, token: string) => api<AdminTrainer[]>(slug, '/admin/trainers', { token }),
  trainees: (slug: string, token: string) => api<Trainee[]>(slug, '/admin/trainees', { token }),
  plans: (slug: string, token: string) => api<Plan[]>(slug, '/admin/plans', { token }),
  classrooms: (slug: string, token: string) => api<Classroom[]>(slug, '/admin/classrooms', { token }),
  classroom: (slug: string, token: string, id: string) => api<Classroom>(slug, `/admin/classrooms/${encodeURIComponent(id)}`, { token }),
  integrations: (slug: string, token: string) => api<{ zoom: boolean }>(slug, '/admin/integrations', { token }),
  branding: (slug: string, token: string) => api<AdminBranding>(slug, '/tenant/branding', { token }),
  content: (slug: string, token: string, courseId: string) => api<ContentModule[]>(slug, `/admin/courses/${encodeURIComponent(courseId)}/content`, { token }),
  attendance: (slug: string, token: string, classroomId: string) => api<Attendance[]>(slug, `/admin/classrooms/${encodeURIComponent(classroomId)}/attendance`, { token }),
  certificates: (slug: string, token: string) => api<IssuedCertificate[]>(slug, '/admin/certificates', { token }),
  domain: (slug: string, token: string) => api<DomainStatus>(slug, '/tenant/domain', { token }),
  recordedCourses: (slug: string, token: string) => api<RecordedCourseSummary[]>(slug, '/admin/recorded-courses', { token }),
  recordedCourse: (slug: string, token: string, id: string) => api<RecordedCourseDetail>(slug, `/admin/recorded-courses/${encodeURIComponent(id)}`, { token }),
  recordedPreview: (slug: string, token: string, body: Record<string, string | number>) =>
    api<SchedulePreview>(slug, '/admin/recorded-courses/preview', { method: 'POST', token, body }),
  discussion: (slug: string, token: string, moduleId: string) => api<DiscussionThread[]>(slug, `/admin/modules/${encodeURIComponent(moduleId)}/discussion`, { token }),
};

/** Learner portal reads (the learner's own token; never cached). */
export const me = {
  enrollments: (slug: string, token: string) => api<MyEnrollment[]>(slug, '/me/enrollments', { token }),
  course: (slug: string, token: string, courseId: string) => api<MyCourse>(slug, `/me/courses/${encodeURIComponent(courseId)}`, { token }),
  classrooms: (slug: string, token: string) => api<MyClassroom[]>(slug, '/me/classrooms', { token }),
  discussion: (slug: string, token: string, moduleId: string) => api<DiscussionThread[]>(slug, `/me/modules/${encodeURIComponent(moduleId)}/discussion`, { token }),
  playback: (slug: string, token: string, lessonId: string) =>
    api<{ playlist_path: string; expires_in: number }>(slug, `/me/lessons/${encodeURIComponent(lessonId)}/playback`, { token }),
};

/** Public certificate verification (no tenant: certificate codes are global). */
export async function verifyCertificate(code: string): Promise<CertificateVerification | null> {
  try {
    return await request<CertificateVerification>(`/certificates/verify/${encodeURIComponent(code)}`, {}, { revalidate: 300 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Tenant-not-found and bad-slug both mean "no such academy" for page routing. */
export const isMissingTenant = (err: unknown) =>
  err instanceof ApiError && ['TENANT_CONTEXT_MISSING', 'INVALID_TENANT_SLUG', 'TENANT_INACTIVE'].includes(err.code);
