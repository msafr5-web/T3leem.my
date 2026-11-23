import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getTenant, myBadge } from '@/lib/api';
import { badgeAction } from '@/lib/actions';
import { getSession } from '@/lib/session';
import { BadgeShare } from './badge-share';

export const metadata: Metadata = { title: 'بطاقتي الرقمية', robots: { index: false } };

export default async function MyCard({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/my/card`)}`);
  const [badge, tenant] = await Promise.all([myBadge(slug, session.token), getTenant(slug)]);
  const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  const url = badge.token ? `${base}/badge/${badge.token}` : null;
  const on = badge.enabled && url;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 4 }}>
        <Link href={`/${slug}/my`} className="small">← دوراتي</Link>
        <h1>بطاقتي الرقمية</h1>
        <p className="muted">صفحة عامة اختيارية تعرض اسمك وجهة تدريبك وشهاداتك الموثّقة فقط، لا بريدك ولا هاتفك ولا رقم هويتك. شاركها برمز QR أو رابط أو بالتقريب (NFC)، وأوقفها متى شئت.</p>
      </div>

      {on ? (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <strong>{tenant.name}</strong>
          <div
            style={{ width: 200, height: 200 }}
            role="img"
            aria-label="رمز QR لرابط بطاقتك"
            dangerouslySetInnerHTML={{ __html: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) }}
          />
          <BadgeShare url={url} vcardUrl={`/badge/${badge.token}/vcard`} />
          <p className="small muted ltr" style={{ wordBreak: 'break-all' }}>{url}</p>
        </div>
      ) : (
        <div className="card empty">البطاقة غير مفعّلة. لا أحد يستطيع رؤية بياناتك قبل أن تفعّلها.</div>
      )}

      <div className="row-actions">
        {on ? (
          <>
            <form action={badgeAction.bind(null, slug, 'regenerate')}><button className="btn btn-ghost" type="submit">رابط جديد (يُبطل القديم)</button></form>
            <form action={badgeAction.bind(null, slug, 'disable')}><button className="btn btn-ghost" type="submit">إيقاف البطاقة</button></form>
          </>
        ) : (
          <form action={badgeAction.bind(null, slug, 'enable')}><button className="btn btn-primary" type="submit">تفعيل بطاقتي</button></form>
        )}
      </div>
    </div>
  );
}
