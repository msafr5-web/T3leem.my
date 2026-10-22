'use client';

/** Shown when the API is unreachable (cold start, outage, API_URL not configured yet). */
export default function TenantError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container narrow stack" style={{ paddingBlock: 80, textAlign: 'center' }}>
      <h1>تعذّر تحميل الأكاديمية</h1>
      <p className="muted">لم نتمكن من الاتصال بالخادم الآن. حاول مرة أخرى بعد لحظات.</p>
      <p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          إعادة المحاولة
        </button>
      </p>
    </main>
  );
}
