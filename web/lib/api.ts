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
  brand_settings: { primaryColor?: string; logoUrl?: string | null; locale?: string } | null;
}

export interface CourseSummary {
  id: string;
  title: string;
  type: 'RECORDED' | 'LIVE';
  price: Price;
  module_count: number;
  lesson_count: number;
}

export interface CourseDetail extends CourseSummary {
  modules: { id: string; title: string; lessons: { id: string; title: string; content_type: 'VIDEO' | 'ZOOM' | 'PDF' }[] }[];
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
  method?: 'GET' | 'POST';
  token?: string;
  body?: unknown;
  /** Seconds to cache a GET in Next's data cache; omit for no caching. */
  revalidate?: number;
}

type Envelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

export async function api<T>(slug: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const base = process.env.API_URL;
  if (!base) throw new ApiUnavailableError('API_URL is not configured');

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'x-tenant-slug': slug,
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
  if (!payload.success) throw new ApiError(res.status, payload.error.code, payload.error.message);
  return payload.data;
}

export const getTenant = (slug: string) => api<Tenant>(slug, '/tenant', { revalidate: 60 });
export const getCourses = (slug: string) => api<CourseSummary[]>(slug, '/courses', { revalidate: 60 });
export const getCourse = (slug: string, id: string) => api<CourseDetail>(slug, `/courses/${encodeURIComponent(id)}`, { revalidate: 60 });

/** Tenant-not-found and bad-slug both mean "no such academy" for page routing. */
export const isMissingTenant = (err: unknown) =>
  err instanceof ApiError && ['TENANT_CONTEXT_MISSING', 'INVALID_TENANT_SLUG', 'TENANT_INACTIVE'].includes(err.code);
