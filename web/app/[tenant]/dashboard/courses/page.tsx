import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { courseTypeLabel, formatDate, formatNumber, formatSar } from '@/lib/format';

export default async function DashboardCourses({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const courses = await admin.courses(slug, token);
  const base = `/${slug}/dashboard/courses`;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>الدورات</h1>
          <p className="muted small">بيانات الترخيص والاعتماد والساعات لكل دورة. المسودات لا تظهر للمتدربين.</p>
        </div>
        <Link href={`${base}/new`} className="btn btn-primary">دورة جديدة</Link>
      </div>

      <div className="table-wrap">
        {courses.length === 0 ? (
          <p className="empty">لا توجد دورات بعد.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الدورة</th>
                <th>المدرب</th>
                <th className="num">الساعات</th>
                <th className="num">المدة</th>
                <th>الترخيص</th>
                <th>الاعتماد</th>
                <th className="num">السعر</th>
                <th className="num">المسجلون</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`${base}/${c.id}`}>{c.title}</Link>
                    <div className="small muted">{courseTypeLabel[c.type]}</div>
                  </td>
                  <td>{c.trainer.full_name}</td>
                  <td className="num">{c.training_hours !== null ? formatNumber(c.training_hours) : '—'}</td>
                  <td className="num">{c.duration_days !== null ? `${formatNumber(c.duration_days)} أيام` : '—'}</td>
                  <td>
                    <span className="ltr">{c.license.number ?? '—'}</span>
                    {c.license.expires_on && <div className="small muted">حتى {formatDate(c.license.expires_on)}</div>}
                  </td>
                  <td className="ltr">{c.accreditation_number ?? '—'}</td>
                  <td className="num">{formatSar(c.price.total)}</td>
                  <td className="num">{formatNumber(c.enrollment_count)}</td>
                  <td>{c.is_published ? <span className="badge ok">منشورة</span> : <span className="badge draft">مسودة</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
