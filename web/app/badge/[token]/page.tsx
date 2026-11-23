import { PlatformEmblem } from '@/app/brand-mark';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ApiUnavailableError, publicBadge } from '@/lib/api';
import { ServiceUnavailable } from '../../service-unavailable';
import { formatDate } from '@/lib/format';

type Params = Promise<{ token: string }>;
export const metadata: Metadata = { title: 'بطاقة متدرب', robots: { index: false, follow: false } };

/** Public badge page: only what the trainee chose to publish (name, academy, verifiable certificates). */
export default async function BadgePage({ params }: { params: Params }) {
  const { token } = await params;
  let badge: Awaited<ReturnType<typeof publicBadge>>;
  try {
    badge = await publicBadge(decodeURIComponent(token));
  } catch (err) {
    if (err instanceof ApiUnavailableError) return <ServiceUnavailable detail={err.message} />;
    throw err;
  }
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand-mark"><PlatformEmblem />T3leem.my</Link>
        </div>
      </header>
      <main className="container stack narrow" style={{ gap: 24 }}>
        {!badge ? (
          <div className="stack" style={{ textAlign: 'center', paddingBlock: 40 }}>
            <h1>البطاقة غير متاحة</h1>
            <p className="muted">الرابط غير صحيح أو أوقف صاحب البطاقة مشاركتها.</p>
          </div>
        ) : (
          <>
            <section className="card stack" style={{ textAlign: 'center' }}>
              <span className="badge">متدرب</span>
              <h1>{badge.name}</h1>
              <p className="muted">{badge.academy.name}</p>
              <p><a className="btn btn-ghost" href={`/badge/${encodeURIComponent(token)}/vcard`} download>حفظ في جهات الاتصال</a></p>
            </section>
            <section className="stack" aria-labelledby="certs">
              <h2 id="certs">الشهادات الموثّقة</h2>
              {badge.certificates.length === 0 ? (
                <p className="muted">لا شهادات بعد.</p>
              ) : (
                badge.certificates.map((c) => (
                  <div className="card" key={c.code}>
                    <strong>{c.course_title}</strong>
                    <p className="small muted">صدرت {formatDate(c.issued_at)}</p>
                    <Link href={`/verify/${c.code}`} className="btn btn-ghost">تحقق من الشهادة</Link>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
