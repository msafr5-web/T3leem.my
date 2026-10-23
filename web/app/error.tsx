'use client';

import Link from 'next/link';

/** Root error boundary: any unexpected server/render error under the root layout lands here. */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container narrow stack" style={{ paddingBlock: 80, textAlign: 'center' }}>
      <h1>حدث خطأ غير متوقع</h1>
      <p className="muted">نعتذر، لم نتمكن من عرض هذه الصفحة. حاول مرة أخرى، وإن تكرر الخطأ فعُد لاحقاً.</p>
      <div className="row-actions" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={reset}>
          إعادة المحاولة
        </button>
        <Link href="/" className="btn btn-ghost">
          الصفحة الرئيسية
        </Link>
      </div>
    </main>
  );
}
