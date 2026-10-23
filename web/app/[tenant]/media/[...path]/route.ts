import { isValidSlug } from '@/lib/format';

/**
 * Same-origin proxy for protected HLS (playlist, AES key, segments). The video player fetches
 * these URLs directly, so authorization is the signed `?token=` the API issued — this proxy adds
 * nothing but the academy header and keeps the API host private. Only the three expected path
 * shapes are forwarded; anything else is a 404 without touching the API.
 */
const ALLOWED = /^lessons\/[0-9a-f-]{36}\/(?:playlist\.m3u8|key|segments\/seg_\d{4,5}\.ts)$/i;

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; path: string[] }> }): Promise<Response> {
  const { tenant: slug, path } = await params;
  const rel = path.join('/');
  const base = process.env.API_URL;
  if (!isValidSlug(slug) || !ALLOWED.test(rel) || !base) return new Response(null, { status: 404 });

  const search = new URL(req.url).search;
  let upstream: Response;
  try {
    upstream = await fetch(`${base.replace(/\/$/, '')}/api/v1/media/${rel}${search}`, {
      headers: { 'x-tenant-slug': slug },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
  for (const h of ['content-type', 'cache-control', 'content-length']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
