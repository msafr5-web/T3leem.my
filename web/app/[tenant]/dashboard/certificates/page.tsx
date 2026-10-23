import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { formatDate } from '@/lib/format';

export default async function DashboardCertificates({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const certificates = await admin.certificates(slug, token);

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 28 }}>الشهادات الصادرة</h1>
        <p className="muted small">تُصدر الشهادة تلقائياً عند إكمال المتدرب جميع دروس الدورة، ويمكن لأي جهة التحقق منها برمزها أو رمز QR.</p>
      </div>
      <div className="table-wrap">
        {certificates.length === 0 ? (
          <p className="empty">لم تُصدر أي شهادة بعد.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>رمز التحقق</th>
                <th>المتدرب</th>
                <th>الدورة</th>
                <th>تاريخ الإصدار</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((c) => (
                <tr key={c.code}>
                  <td>
                    <Link href={`/verify/${c.code}`} className="ltr">
                      {c.code}
                    </Link>
                  </td>
                  <td>{c.learner_name}</td>
                  <td>{c.course_title}</td>
                  <td className="small muted">{formatDate(c.issued_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
