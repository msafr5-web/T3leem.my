import { NextResponse, type NextRequest } from 'next/server';

/**
 * Custom academy domains (PRD §6 "النطاق"): a request to academy.com.sa is served from
 * /<slug>/... without the visitor ever seeing the platform URL. Only domains the academy has
 * VERIFIED via DNS resolve (the API enforces that); anything unknown passes through untouched.
 */
const platformHosts = new Set(
  (process.env.PLATFORM_HOSTS ?? 'localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

// Small per-instance cache so every request doesn't round-trip to the API.
const cache = new Map<string, { slug: string | null; until: number }>();
const TTL_MS = 60_000;

async function slugFor(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && hit.until > Date.now()) return hit.slug;
  let slug: string | null = null;
  const base = process.env.API_URL;
  if (base) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/platform/domains/${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) slug = ((await res.json()) as { data?: { slug?: string } }).data?.slug ?? null;
    } catch {
      slug = null;
    }
  }
  cache.set(host, { slug, until: Date.now() + TTL_MS });
  return slug;
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (!host || platformHosts.has(host) || host.endsWith('.vercel.app')) return NextResponse.next();

  const slug = await slugFor(host);
  if (!slug) return NextResponse.next();

  const url = req.nextUrl.clone();
  // Already prefixed (e.g. internal links that include the slug): leave as is.
  if (url.pathname === `/${slug}` || url.pathname.startsWith(`/${slug}/`)) return NextResponse.next();
  url.pathname = `/${slug}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals and static files.
  matcher: ['/((?!_next/|favicon.ico|robots.txt).*)'],
};
