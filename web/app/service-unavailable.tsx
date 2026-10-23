import Link from 'next/link';

/**
 * Shown when the API can't be reached (not deployed yet, API_URL missing/wrong, outage).
 * Rendered by layouts directly — a layout's own error.tsx can't catch the layout's errors,
 * so without this an API outage became Next's bare "Application error" page.
 */
export function ServiceUnavailable({ detail }: { detail?: string }) {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand-mark">
            <span className="brand-dot" aria-hidden="true">ت</span>
            T3leem.my
          </Link>
        </div>
      </header>
      <main className="container narrow stack" style={{ paddingBlock: 64, textAlign: 'center' }}>
        <h1>الخدمة غير متاحة مؤقتاً</h1>
        <p className="muted">تعذّر الاتصال بخادم المنصة الآن. لم يُفقد أي شيء، حاول مرة أخرى بعد لحظات.</p>
        <p>
          <Link href="/" className="btn btn-primary">
            العودة إلى الصفحة الرئيسية
          </Link>
        </p>
        {/* Operator hint only outside production builds: never leak config details to visitors. */}
        {detail && process.env.NODE_ENV !== 'production' && (
          <p className="small muted ltr" style={{ textAlign: 'center' }}>
            {detail}
          </p>
        )}
      </main>
    </>
  );
}
