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
  recorded: RecordedSource | null;
}

export interface Provider {
  slug: string;
  name: string;
  tagline: string | null;
  city: string | null;
  primary_color: string | null;
  logo_version: string | null;
  /** Active health-certificate sectors (0 = the academy has no such section). */
  health_sectors: number;
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
  /** Recorded course built from a YouTube video. */
  recorded: { video_id: string; channel_url: string | null; channel_name: string | null; starts_at: string | null; day_count: number } | null;
  /** Has days/lessons already (a YouTube schedule can only be added to an empty course). */
  has_content: boolean;
}

/** Where a recorded course's video comes from and when day 1 opens (ISO). */
export interface RecordedSource {
  channel_url: string | null;
  channel_name: string | null;
  starts_at: string | null;
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
  source: RecordedSource | null;
  modules: { id: string; title: string; lessons: MyLesson[] }[];
}

export interface ScheduleSettings {
  split_mode: 'fixed' | 'balanced';
  max_lecture_minutes: number;
  min_lecture_minutes: number;
  break_minutes: number;
  discussion_minutes: number;
  daily_video_minutes: number;
}

export interface SchedulePreview {
  video: { id: string; title: string; channel: string; channel_url: string | null; duration_seconds: number; duration_source: 'youtube' | 'manual' };
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

export interface RecordedCourseDetail extends RecordedSource {
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

/** End-of-day quiz (question bank + a learner's attempt). */
export interface QuizSettings {
  duration_minutes: number;
  question_count: number;
}
/** MCQ: one right option. CHECKBOX: several. SHORT / TEXT: written answers. RATING: 1-5 stars. */
export type QuizQuestionType = 'MCQ' | 'CHECKBOX' | 'SHORT' | 'TEXT' | 'RATING';
/** MCQ: option index. CHECKBOX: option indexes. RATING: 1-5. SHORT / TEXT: the text. */
export type QuizAnswer = string | number | number[];

export interface AdminQuizQuestion {
  id: string;
  code: string;
  body: string;
  type: QuizQuestionType;
  options: string[];
  correct_answer: string;
  correct_options: string[];
  points: number;
  required: boolean;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  day_id: string | null;
}
export interface AdminQuiz {
  settings: QuizSettings;
  days: { id: string; title: string; question_count: number; opens_at: string | null; closes_at: string | null }[];
  shared_count: number;
  questions: AdminQuizQuestion[];
}
export interface QuizAttemptSummary {
  id: string;
  learner_name: string;
  learner_email: string;
  day_title: string;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  text_answers: { question: string; answer: string }[];
}
export interface QuizResultQuestion {
  id: string;
  body: string;
  type: QuizQuestionType;
  options: string[];
  points: number;
  required: boolean;
  your_answer: QuizAnswer | null;
  correct_answer: string;
  /** CHECKBOX: the text of every right option. */
  correct_options: string[];
  /** null for written answers and ratings (not auto-graded). */
  is_correct: boolean | null;
  earned: number | null;
}
export interface QuizResult {
  score: number;
  max_score: number;
  percent: number | null;
  submitted_at: string;
  questions: QuizResultQuestion[];
}
export interface QuizStatus {
  available: boolean;
  /** Where "now" falls in the supervisor's opening/closing times for this day. */
  window: 'not_open' | 'open' | 'closed';
  opens_at: string | null;
  closes_at: string | null;
  duration_minutes: number;
  question_count: number;
  server_now: string;
  attempt:
    | null
    | { state: 'in_progress'; expires_at: string; questions: { id: string; body: string; type: QuizQuestionType; options: string[]; points: number; required: boolean }[] }
    | { state: 'submitted'; result: QuizResult };
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

/** Health-certificates academy: practice question bank per sector. */
export type HealthAccess = 'disabled' | 'open' | 'trial' | 'paid' | 'locked';

export interface HealthSectorSummary {
  id: string;
  name: string;
  title: string;
  question_count: number;
}

export interface HealthStatus {
  access: HealthAccess;
  strict_mode: boolean;
  daily_limit: number;
  questions_per_exam: number;
  trial_ends_at: string | null;
  price: number | null;
  server_now: string;
  sectors: HealthSectorSummary[];
}

export interface HealthQuestion {
  id: string;
  code: string;
  sector_id: string;
  body: string;
  options: string[];
  correct_index: number;
  explanation: string;
  active: boolean;
}

export interface HealthQuestionPage {
  total: number;
  questions: HealthQuestion[];
}

export interface HealthProgress {
  favorites: string[];
  read: string[];
  answered: number;
  correct: number;
  sessions: number;
  history: { id: string; sector_id: string | null; total: number; correct: number; created_at: string }[];
}

export interface AdminHealthSector {
  id: string;
  slug: string;
  name: string;
  title: string;
  sort_order: number;
  active: boolean;
  question_count: number;
  total_count: number;
}

export interface AdminHealth {
  settings: { enabled: boolean; trial_ends_at: string | null; price: number | null; strict_mode: boolean; daily_limit: number; questions_per_exam: number };
  sectors: AdminHealthSector[];
  active_subscribers: number;
  server_now: string;
}

/** Official exams (strict mode). */
export interface ExamQuota {
  limit: number;
  used: number;
  remaining: number;
  next_allowed_at: string | null;
}

export interface ExamStatus {
  quota: ExamQuota;
  questions_per_exam: number;
  history: { id: string; sector_id: string | null; score: number | null; total: number; started_at: string; submitted_at: string | null }[];
}

export interface ExamPaper {
  id: string;
  sector_id: string | null;
  started_at: string;
  questions: { id: string; body: string; options: string[] }[];
}

export interface ExamResult {
  id: string;
  sector_id: string | null;
  score: number;
  total: number;
  percent: number;
  submitted_at: string;
  questions: { id: string; body: string; options: string[]; your_answer: string | null; correct_option: string; correct: boolean; explanation: string }[];
}

export interface PracticeQuestion {
  id: string;
  sector_id: string;
  body: string;
  options: string[];
}

export interface RegisterPolicy {
  require_phone: boolean;
}

/** Platform owner console. */
export interface OwnerFeatures {
  health: boolean;
  recorded: boolean;
  institute: boolean;
}

export interface OwnerTenant {
  id: string;
  slug: string;
  name: string;
  status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED';
  plan_id: string | null;
  plan_name: string | null;
  approved_at: string | null;
  subscription_ends_at: string | null;
  features: OwnerFeatures;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  created_at: string;
}

export interface OwnerOverview {
  total: number;
  pending: number;
  active: number;
  suspended: number;
  expired: number;
  tenants: OwnerTenant[];
}

export interface OwnerPlan {
  id: string;
  name: string;
  max_students: number;
  max_storage_gb: number;
  monthly_price: number;
  tenant_count: number;
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

/**
 * The visitor's address as the reverse proxy saw it. The API rate-limits per tenant and client IP; without this every visitor of an
 * academy would reach it from the web server's own address and share one bucket.
 */
async function clientIp(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const v = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip');
    return v && /^[0-9a-fA-F:.]{3,45}$/.test(v) ? v : null;
  } catch {
    return null; // outside a request (build time, cached fetch): nothing to forward
  }
}

async function request<T>(path: string, scope: Record<string, string>, opts: RequestOptions): Promise<T> {
  const base = process.env.API_URL;
  if (!base) throw new ApiUnavailableError('API_URL is not configured');
  const ip = opts.token ? await clientIp() : null;

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
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
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
/** Institute management (branches, rooms, assets, members). Money is absent for roles that may not see it. */
export interface InstBranch { id: string; name: string; city: string | null; address: string | null; active: boolean }
export interface InstRoom { id: string; branch_id: string; name: string; kind: 'CLASSROOM' | 'LAB' | 'HALL'; area_m2: string; capacity: number; power_kw: string; active: boolean }
export interface InstAsset {
  id: string; branch_id: string; room_id: string | null; name: string; category: string | null; serial_no: string | null;
  purchase_date: string | null; status: 'IN_SERVICE' | 'MAINTENANCE' | 'RETIRED'; notes: string | null;
  purchase_value?: string; salvage_percent?: string; useful_life_months?: number | null;
}
export interface InstMember { id: string; user_id: string; email: string; full_name: string | null; role: string; branch_id: string | null }
export interface InstDepartment { id: string; branch_id: string | null; name: string }
export interface InstStaff { id: string; branch_id: string; department_id: string | null; full_name: string; job_title: string | null; phone: string | null; email: string | null; active: boolean }
export interface InstMaintenance { id: string; asset_id: string; performed_on: string; kind: 'INSPECTION' | 'REPAIR' | 'SERVICE'; notes: string | null; next_due_on: string | null; cost?: string }
export interface InstAttention { today: string; items: { asset_id: string; reasons: ('IN_MAINTENANCE' | 'MAINTENANCE_OVERDUE' | 'END_OF_LIFE' | 'NO_ROOM')[] }[] }
export interface InstSubject { id: string; level_id: string; name: string; hours: number; fee?: string | null }
export interface InstLevel { id: string; program_id: string; name: string; sort_order: number; subjects: InstSubject[] }
export interface InstProgram { id: string; branch_id: string; name: string; description: string | null; admission_requirements: string | null; active: boolean; state_borne_vat: boolean; fee?: string; levels: InstLevel[] }
export interface InstInstructor { id: string; branch_id: string; user_id: string | null; full_name: string; phone: string | null; email: string | null; qualifications: string | null; active: boolean; hourly_rate?: string }
export interface InstStudent { id: string; branch_id: string; program_id: string | null; level_id: string | null; user_id: string | null; full_name: string; phone: string | null; email: string | null; status: 'ACTIVE' | 'GRADUATED' | 'SUSPENDED' | 'WITHDRAWN'; enrolled_on: string | null; citizenship: 'SAUDI' | 'OTHER'; has_national_id: boolean; national_id_last4: string | null }
export interface InstSession { id: string; branch_id: string; subject_id: string; room_id: string; instructor_id: string; starts_at: string; ends_at: string; status: 'SCHEDULED' | 'HELD' | 'CANCELLED'; notes: string | null }
export interface InstRoster { session: InstSession; students: (InstStudent & { attendance: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | null })[] }
export interface FinExpense { id: string; branch_id: string; room_id: string | null; category: string; amount: string; incurred_on: string; vendor: string | null; description: string | null }
export interface FinBill { id: string; branch_id: string; period_start: string; period_end: string; amount: string; kwh: string | null }
export interface FinBudget { id: string; branch_id: string; category: string | null; period: string; amount: string; warn_percent: number; spent: string; remaining: string; percent: number | null; level: 'OK' | 'WARNING' | 'EXCEEDED' }
export interface FinPayment { id: string; invoice_id: string; amount: string; paid_on: string; method: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'; reference: string | null; voided: boolean; void_reason: string | null }
export interface FinInvoice {
  id: string; branch_id: string; student_id: string; description: string; amount: string; discount: string; net: string; vat_treatment: 'NONE' | 'STANDARD' | 'STATE_BORNE'; vat_rate_percent: number; vat: string; total: string; beneficiary_id_last4: string | null; paid: string; outstanding: string; issued_on: string;
  status: 'OPEN' | 'CANCELLED'; overdue: boolean; installments: { due_on: string; amount: string; paid: string; remaining: string; state: 'PAID' | 'PARTIAL' | 'OVERDUE' | 'UPCOMING' }[]; payments: FinPayment[];
}
export interface FinSummary { month: string; branches: { branch_id: string; income: string; spend: string; net: string; by_category: Record<string, string>; closed: boolean }[]; totals: { income: string; spend: string; net: string } }
export interface FinPayout { id: string; branch_id: string; instructor_id: string; month: string; amount: string; dues: string; minutes: number; hourly_rate: string; paid_on: string; method: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER'; reference: string | null; voided: boolean; void_reason: string | null }
export interface FinDues { month: string; total: string; paid: string; outstanding: string; instructors: { instructor_id: string; branch_id: string; name: string; minutes: number; hourly_rate: string; pay: string; paid: string; outstanding: string }[]; payouts: FinPayout[] }
export interface FinVatSummary { month: string; rows: { branch_id: string; treatment: 'NONE' | 'STANDARD' | 'STATE_BORNE'; invoices: number; net_amount: string; vat_amount: string }[] }
export interface FinClosed { id: string; branch_id: string; period: string; closed_by: string; closed_at: string }
export interface CostPolicyParams {
  electricity: { tariffCategory: string; allocation: 'AREA' | 'POWER_HOURS' | 'METER'; vatRatePercent: number; vatRegistered: boolean; vatRecoveryPercent: number; breakerAmps: Record<string, number> };
  depreciation: { start: 'PURCHASE_MONTH' | 'NEXT_MONTH'; defaultLifeMonths: number };
  overhead: { basis: 'AREA' | 'HOURS' };
  occupancy: { availableHoursPerMonth: number };
  revenue: { basis: 'CASH' | 'OVER_TIME' };
}
export interface CostPolicy { id: string; version: number; status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED'; params: CostPolicyParams; note: string | null; approved_at: string | null; created_at: string }
export interface CostPolicies { approved: CostPolicy | null; draft: CostPolicy | null; history: CostPolicy[]; defaults: CostPolicyParams }
export interface CostReading { id: string; branch_id: string; room_id: string; month: string; kwh: string }
export interface CostReport {
  month: string; branch_id: string; policy: { id: string; version: number; approved_at: string | null };
  electricity: { method_used: string; cost: string }; overhead: string; total_room_cost: string; idle_cost: string;
  rooms: { room_id: string; name: string; electricity: string; depreciation: string; direct_expenses: string; overhead: string; total: string; held_minutes: number; cost_per_hour: string | null; occupancy_percent: number }[];
  programs: { program_id: string; name: string; held_minutes: number; facility_cost: string; instructor_cost: string; total_cost: string; revenue: string; profit: string; active_students: number; cost_per_student: string | null }[];
  bill_check: {
    bill_id: string; tariff_id: string | null; failure: string | null; actual: string; difference: string | null; level: 'OK' | 'REVIEW' | null; note: string;
    estimate: { energy: string; fixed: string | null; vat: string; total: string; tiers: { kwh: number; halalas_per_kwh: number; amount: string }[]; warnings: string[] } | null;
  } | null;
  warnings: { code: string; detail?: string }[];
}
export interface InstMe { role: string; branch_id: string | null; can_write: { branch: boolean; member: boolean; room: boolean; asset: boolean; department: boolean; staff: boolean; program: boolean; instructor: boolean; student: boolean; session: boolean; attendance: boolean; expense: boolean; budget: boolean; invoice: boolean; ledger_admin: boolean; cost_policy: boolean; cost_policy_approve: boolean; meter: boolean; dues: boolean }; can_read: { finance: boolean; cost: boolean } }

export const admin = {
  institutePrograms: (slug: string, token: string) => api<{ programs: InstProgram[] }>(slug, '/admin/institute/programs', { token }),
  instituteInstructors: (slug: string, token: string) => api<{ instructors: InstInstructor[] }>(slug, '/admin/institute/instructors', { token }),
  instituteStudents: (slug: string, token: string) => api<{ students: InstStudent[] }>(slug, '/admin/institute/students', { token }),
  instituteSessions: (slug: string, token: string, from?: string, to?: string) =>
    api<{ sessions: InstSession[] }>(slug, `/admin/institute/sessions${from ? `?from=${encodeURIComponent(from)}${to ? `&to=${encodeURIComponent(to)}` : ''}` : ''}`, { token }),
  instituteRoster: (slug: string, token: string, id: string) => api<InstRoster>(slug, `/admin/institute/sessions/${encodeURIComponent(id)}/roster`, { token }),
  finExpenses: (slug: string, token: string, from: string, to: string) => api<{ expenses: FinExpense[] }>(slug, `/admin/institute/finance/expenses?from=${from}&to=${to}`, { token }),
  finBills: (slug: string, token: string) => api<{ bills: FinBill[] }>(slug, '/admin/institute/finance/bills', { token }),
  finBudgets: (slug: string, token: string, month: string) => api<{ month: string; budgets: FinBudget[] }>(slug, `/admin/institute/finance/budgets?month=${month}`, { token }),
  finInvoices: (slug: string, token: string) => api<{ invoices: FinInvoice[] }>(slug, '/admin/institute/finance/invoices', { token }),
  finSummary: (slug: string, token: string, month: string) => api<FinSummary>(slug, `/admin/institute/finance/summary?month=${month}`, { token }),
  finDues: (slug: string, token: string, month: string) => api<FinDues>(slug, `/admin/institute/finance/instructor-dues?month=${month}`, { token }),
  finVat: (slug: string, token: string, month: string) => api<FinVatSummary>(slug, `/admin/institute/finance/vat-summary?month=${month}`, { token }),
  finClosed: (slug: string, token: string) => api<{ closed: FinClosed[] }>(slug, '/admin/institute/finance/closed-periods', { token }),
  costPolicies: (slug: string, token: string) => api<CostPolicies>(slug, '/admin/institute/cost/policy', { token }),
  costReadings: (slug: string, token: string, month: string) => api<{ readings: CostReading[] }>(slug, `/admin/institute/cost/meter-readings?month=${month}`, { token }),
  costReport: (slug: string, token: string, branchId: string, month: string) => api<CostReport>(slug, `/admin/institute/cost/report?branch_id=${encodeURIComponent(branchId)}&month=${month}`, { token }),
  instituteMe: (slug: string, token: string) => api<InstMe>(slug, '/admin/institute/me', { token }),
  instituteBranches: (slug: string, token: string) => api<{ branches: InstBranch[] }>(slug, '/admin/institute/branches', { token }),
  instituteRooms: (slug: string, token: string) => api<{ rooms: InstRoom[] }>(slug, '/admin/institute/rooms', { token }),
  instituteAssets: (slug: string, token: string) => api<{ assets: InstAsset[] }>(slug, '/admin/institute/assets', { token }),
  instituteDepartments: (slug: string, token: string) => api<{ departments: InstDepartment[] }>(slug, '/admin/institute/departments', { token }),
  instituteStaff: (slug: string, token: string) => api<{ staff: InstStaff[] }>(slug, '/admin/institute/staff', { token }),
  instituteAttention: (slug: string, token: string) => api<InstAttention>(slug, '/admin/institute/inventory/attention', { token }),
  instituteMaintenance: (slug: string, token: string, assetId: string) => api<{ maintenance: InstMaintenance[] }>(slug, `/admin/institute/assets/${encodeURIComponent(assetId)}/maintenance`, { token }),
  instituteMembers: (slug: string, token: string) => api<{ members: InstMember[]; roles: string[] }>(slug, '/admin/institute/members', { token }),
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
  quiz: (slug: string, token: string, courseId: string) => api<AdminQuiz>(slug, `/admin/recorded-courses/${encodeURIComponent(courseId)}/quiz`, { token }),
  health: (slug: string, token: string) => api<AdminHealth>(slug, '/admin/health', { token }),
  healthQuestions: (slug: string, token: string, qs: string) => api<HealthQuestionPage>(slug, `/admin/health/questions?${qs}`, { token }),
  quizResults: (slug: string, token: string, courseId: string) => api<QuizAttemptSummary[]>(slug, `/admin/recorded-courses/${encodeURIComponent(courseId)}/quiz/results`, { token }),
};

/** Platform owner reads (the owner token; never cached). */
export const owner = {
  overview: (token: string) => platformApi<OwnerOverview>('/owner/overview', { token }),
  plans: (token: string) => platformApi<OwnerPlan[]>('/owner/plans', { token }),
};

/** Learner portal reads (the learner's own token; never cached). */
export const me = {
  enrollments: (slug: string, token: string) => api<MyEnrollment[]>(slug, '/me/enrollments', { token }),
  course: (slug: string, token: string, courseId: string) => api<MyCourse>(slug, `/me/courses/${encodeURIComponent(courseId)}`, { token }),
  classrooms: (slug: string, token: string) => api<MyClassroom[]>(slug, '/me/classrooms', { token }),
  discussion: (slug: string, token: string, moduleId: string) => api<DiscussionThread[]>(slug, `/me/modules/${encodeURIComponent(moduleId)}/discussion`, { token }),
  health: (slug: string, token: string) => api<HealthStatus>(slug, '/me/health', { token }),
  healthQuestions: (slug: string, token: string, qs: string) => api<HealthQuestionPage>(slug, `/me/health/questions?${qs}`, { token }),
  examStatus: (slug: string, token: string) => api<ExamStatus>(slug, '/me/health/exam/status', { token }),
  healthProgress: (slug: string, token: string) => api<HealthProgress>(slug, '/me/health/progress', { token }),
  quiz: (slug: string, token: string, moduleId: string) => api<QuizStatus>(slug, `/me/modules/${encodeURIComponent(moduleId)}/quiz`, { token }),
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
