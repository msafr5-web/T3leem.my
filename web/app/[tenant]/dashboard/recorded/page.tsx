import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { formatMinutes, formatNumber } from '@/lib/format';

export default async function RecordedCourses({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const courses = await admin.recordedCourses(slug, token);
  const base = `/${slug}/dashboard/recorded`;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>دورات مسجلة</h1>
          <p className="muted small">
            حوّل فيديو YouTube طويلاً إلى برنامج تدريبي: أيام، وأجزاء قصيرة بين ١٠ و١٥ دقيقة، واستراحات، ونقاش يومي مع المدرب.
          </p>
        </div>
        <Link href={`${base}/new`} className="btn btn-primary">
          دورة مسجلة جديدة
        </Link>
      </div>

      <div className="table-wrap">
        {courses.length === 0 ? (
          <p className="empty">لا توجد دورات مسجلة بعد. ابدأ بلصق رابط فيديو YouTube.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الدورة</th>
                <th className="num">مدة الفيديو</th>
                <th className="num">الأيام</th>
                <th className="num">الأجزاء</th>
                <th className="num">المسجلون</th>
                <th className="num">مشاركات النقاش</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`${base}/${c.id}`}>{c.title}</Link>
                    <div className="small muted">
                      <Link href={`/${slug}/dashboard/courses/${c.id}`}>بيانات الدورة والسعر</Link>
                    </div>
                  </td>
                  <td className="num">{formatMinutes(c.duration_seconds)}</td>
                  <td className="num">{formatNumber(c.day_count)}</td>
                  <td className="num">{formatNumber(c.lecture_count)}</td>
                  <td className="num">{formatNumber(c.enrollment_count)}</td>
                  <td className="num">{formatNumber(c.post_count)}</td>
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
