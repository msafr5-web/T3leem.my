import { NextResponse, type NextRequest } from 'next/server';
import { isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Downloads the course's attendance sheet. A route handler so the browser gets a real file while the admin token stays server-side. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  if (!isValidSlug(slug) || !UUID.test(id)) return new NextResponse('Not found', { status: 404 });
  const session = await getSession(slug);
  if (!session || session.role !== 'TENANT_ADMIN') return new NextResponse('Forbidden', { status: 403 });
  const base = process.env.API_URL;
  if (!base) return new NextResponse('API unavailable', { status: 503 });
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/api/v1/admin/attendance/courses/${id}/export`, {
      headers: { 'x-tenant-slug': slug, Authorization: `Bearer ${session.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new NextResponse('API unavailable', { status: 503 });
  }
  if (!res.ok) return new NextResponse('Could not export', { status: res.status === 404 ? 404 : 502 });
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="attendance.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
