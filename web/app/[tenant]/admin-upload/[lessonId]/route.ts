import { isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * PUT /<slug>/admin-upload/<lessonId> — streams a lesson video from the admin's browser to the
 * API without buffering it here (Server Actions cap bodies at ~1 MB; videos are far larger).
 * The admin token stays in the httpOnly cookie; the API re-checks role, tenant and file bytes.
 */
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);

export async function PUT(req: Request, { params }: { params: Promise<{ tenant: string; lessonId: string }> }): Promise<Response> {
  const { tenant: slug, lessonId } = await params;
  const base = process.env.API_URL;
  if (!isValidSlug(slug) || !/^[0-9a-f-]{36}$/i.test(lessonId) || !base) return Response.json({ error: 'not found' }, { status: 404 });

  const session = await getSession(slug);
  if (!session || session.role !== 'TENANT_ADMIN') return Response.json({ error: 'غير مصرح' }, { status: 403 });

  const type = req.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!VIDEO_TYPES.has(type) || !req.body) return Response.json({ error: 'ارفع ملف فيديو MP4 أو MOV أو WebM أو MKV.' }, { status: 422 });

  const headers: Record<string, string> = { 'x-tenant-slug': slug, Authorization: `Bearer ${session.token}`, 'Content-Type': type };
  const length = req.headers.get('content-length');
  if (length) headers['Content-Length'] = length;

  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/api/v1/admin/lessons/${lessonId}/video`, {
      method: 'PUT',
      headers,
      body: req.body,
      // Required by Node's fetch to stream a request body.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const payload = await upstream.json().catch(() => null);
    return Response.json(payload ?? {}, { status: upstream.status });
  } catch {
    return Response.json({ error: 'تعذّر الاتصال بالخادم.' }, { status: 502 });
  }
}
