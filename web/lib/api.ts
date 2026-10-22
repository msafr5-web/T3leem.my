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
  modules: { id: string; title: string; lessons: { id: string; title: string; content_type: 'VIDEO' | 'ZOOM' | 'PDF' }[] }[];
}

export interface Provider {
  slug: string;
  name: string;
  tagline: string | null;
  city: string | null;
  primary_color: string | null;
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
  method?: 'GET' | 'POST' | 'PUT';
  token?: string;
  body?: unknown;
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
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      ...(opts.revalidate !== undefined && !opts.token ? { next: { revalidate: opts.revalidate } } : { cache: 'no-store' }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ApiUnavailableError(err instanceof Error ? err.message : 'network error');
  }

  let payload: Envelope<T>;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiUnavailableError(`non-JSON response (HTTP ${res.status})`);
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
};

/** Tenant-not-found and bad-slug both mean "no such academy" for page routing. */
export const isMissingTenant = (err: unknown) =>
  err instanceof ApiError && ['TENANT_CONTEXT_MISSING', 'INVALID_TENANT_SLUG', 'TENANT_INACTIVE'].includes(err.code);
