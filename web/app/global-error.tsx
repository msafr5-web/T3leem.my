'use client';

/**
 * Last-resort boundary for errors in the ROOT layout itself (replaces it, so it must render
 * <html>/<body> and can't rely on globals.css). Inline styles keep it readable either way.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, fontFamily: 'system-ui, Tahoma, sans-serif', background: '#f5f7f7', color: '#14211f' }}>
        <main style={{ maxWidth: 440, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 26 }}>المنصة غير متاحة مؤقتاً</h1>
          <p style={{ color: '#5a6b68', lineHeight: 1.8 }}>حدث خطأ أثناء تحميل الموقع. حاول مرة أخرى بعد لحظات.</p>
          <button
            type="button"
            onClick={reset}
            style={{ background: '#0d6b62', color: '#fff', border: 0, borderRadius: 8, padding: '10px 18px', fontSize: 16, cursor: 'pointer' }}
          >
            إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
