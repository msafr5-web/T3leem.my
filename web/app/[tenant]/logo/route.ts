import { isValidSlug } from '@/lib/format';

/**
 * GET /<slug>/logo — proxies the academy's logo from the API so the browser loads it from this
 * origin (the API URL stays server-side). The API already verified the bytes are PNG/JPEG/WebP;
 * the content type is re-checked here so nothing else can ever be served from this path.
 */
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }): Promise<Response> {
  const { tenant: slug } = await params;
  const base = process.env.API_URL;
  if (!isValidSlug(slug) || !base) return new Response(null, { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(`${base.replace(/\/$/, '')}/api/v1/tenant/logo`, {
      headers: { 'x-tenant-slug': slug },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !ALLOWED.has(type)) return new Response(null, { status: 404 });

  return new Response(await upstream.arrayBuffer(), {
    headers: {
      'Content-Type': type,
      // URLs carry ?v=<version>, so a new upload changes the URL; long caching is safe.
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
