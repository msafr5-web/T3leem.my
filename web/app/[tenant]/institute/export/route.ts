import { NextResponse, type NextRequest } from 'next/server';
import { isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Downloads the institute assets workbook (or the import template with ?template=1). A route handler, not a
 * server action, so the browser gets a real file download while the token stays server-side. Open to every
 * signed-in institute role: the API limits the rows to the caller's branch and drops money columns when needed.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  if (!isValidSlug(slug)) return new NextResponse('Not found', { status: 404 });
  const session = await getSession(slug);
  if (!session) return new NextResponse('Forbidden', { status: 403 });
  const base = process.env.API_URL;
  if (!base) return new NextResponse('API unavailable', { status: 503 });

  const template = req.nextUrl.searchParams.get('template') === '1';
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/api/v1/admin/institute/assets-export${template ? '?template=1' : ''}`, {
      headers: { 'x-tenant-slug': slug, Authorization: `Bearer ${session.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new NextResponse('API unavailable', { status: 503 });
  }
  if (!res.ok) return new NextResponse('Could not export', { status: res.status === 403 || res.status === 404 ? res.status : 502 });
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${template ? 'institute-assets-template' : 'institute-assets'}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
