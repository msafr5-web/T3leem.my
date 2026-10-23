import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyCertificate } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { PrintButton } from './print-button';

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  return { title: `التحقق من الشهادة ${decodeURIComponent(code).toUpperCase()}`, robots: { index: false } };
}

/**
 * PRD §6 public certificate verification (QR target). Anyone holding the code can confirm the
 * certificate is genuine, who it was issued to, for which course and by which academy.
 */
export default async function VerifyCertificate({ params }: { params: Params }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).trim().toUpperCase();
  const cert = await verifyCertificate(code);
  const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3001').replace(/\/$/, '');

  return (
    <>
      <header className="site-header no-print">
        <div className="container">
          <Link href="/" className="brand-mark">
            <span className="brand-dot" aria-hidden="true">ت</span>
            T3leem.my
          </Link>
          <Link href="/verify" className="btn btn-ghost">
            التحقق من شهادة أخرى
          </Link>
        </div>
      </header>
      <main className="container stack" style={{ gap: 24 }}>
        {!cert ? (
          <div className="narrow stack" style={{ textAlign: 'center', paddingBlock: 40 }}>
            <h1>لا توجد شهادة بهذا الرمز</h1>
            <p className="muted">
              تأكد من كتابة الرمز كما هو على الشهادة، مثل <span className="ltr">T3L-7K2M-Q9XD</span>.
            </p>
            <p>
              <Link href="/verify" className="btn btn-primary">
                إعادة المحاولة
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="notice ok no-print" role="status">
              <strong>شهادة صحيحة.</strong> صادرة من {cert.academy.name} بتاريخ {formatDate(cert.issued_at)}.
            </div>

            <article className="certificate" aria-label="الشهادة">
              <p style={{ letterSpacing: '0.08em', color: '#b08d3c', fontWeight: 700 }}>{cert.academy.name}</p>
              <h1>شهادة إتمام</h1>
              <p>تشهد {cert.academy.name} بأن</p>
              <p className="learner">{cert.learner_name}</p>
              <p>قد أتمّ بنجاح متطلبات الدورة التدريبية</p>
              <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)' }}>{cert.course_title}</h2>
              <div className="meta-row">
                {cert.training_hours !== null && <span>عدد الساعات: {formatNumber(cert.training_hours)} ساعة</span>}
                <span>المدرب: {cert.trainer_name}</span>
                <span>تاريخ الإصدار: {formatDate(cert.issued_at)}</span>
              </div>
              {(cert.accreditation_number || cert.license_number) && (
                <div className="meta-row">
                  {cert.license_number && (
                    <span>
                      رقم الترخيص: <span className="ltr">{cert.license_number}</span>
                    </span>
                  )}
                  {cert.accreditation_number && (
                    <span>
                      رقم الاعتماد: <span className="ltr">{cert.accreditation_number}</span>
                    </span>
                  )}
                </div>
              )}
              <div className="qr-wrap">
                <div
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: await QRCode.toString(`${base}/verify/${cert.code}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) }}
                />
                <span>رمز التحقق</span>
                <strong className="ltr">{cert.code}</strong>
                <span className="ltr">{base.replace(/^https?:\/\//, '')}/verify</span>
              </div>
            </article>

            <div className="row-actions no-print" style={{ justifyContent: 'center' }}>
              <PrintButton />
              <Link href={`/${cert.academy.slug}`} className="btn btn-ghost">
                زيارة {cert.academy.name}
              </Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}
