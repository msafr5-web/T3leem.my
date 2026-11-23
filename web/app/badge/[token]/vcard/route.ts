import { NextResponse } from 'next/server';

/** Forwards the API's vCard so the browser downloads it from the site's own address. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const base = process.env.API_URL;
  if (!base || !/^[A-Za-z0-9_-]{22,64}$/.test(token)) return new NextResponse('Not found', { status: 404 });
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/badges/${token}/vcard`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(await res.text(), {
      headers: { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': 'attachment; filename="badge.vcf"', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new NextResponse('Unavailable', { status: 503 });
  }
}
