import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container narrow stack" style={{ paddingBlock: 80, textAlign: 'center' }}>
      <h1>الصفحة غير موجودة</h1>
      <p className="muted">ربما تغيّر الرابط، أو أن الأكاديمية أو الدورة لم تعد متاحة.</p>
      <p>
        <Link href="/" className="btn btn-ghost">
          العودة إلى الصفحة الرئيسية
        </Link>
      </p>
    </main>
  );
}
