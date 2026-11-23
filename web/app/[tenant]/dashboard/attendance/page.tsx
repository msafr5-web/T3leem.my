import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Attendance and check-out per course: sessions held, and how many trainees reach the 85% attendance mark. */
export default async function DashboardAttendance({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const courses = await admin.attendanceCourses(slug, token);

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 28 }}>الحضور والانصراف</h1>
        <p className="muted small">
          يسجّل المتدرب حضوره في كل جلسة برمز يصله على بريده. <strong>متأخر</strong> إن مضى أكثر من ١٠٪ من مدة الجلسة، و<strong>غائب</strong> إن لم يسجّل أو خرج قبل النهاية (أو لم يُكمل دروس اليوم في الدورة المسجلة).
          يجتاز الدورة من بلغ حضوره ٨٥٪ من الجلسات المنعقدة. تصلك رسالة بريدية إن لم يسجّل متدرب حضوره بعد ٢٥ دقيقة من بدء الجلسة.
        </p>
      </div>

      <div className="table-wrap">
        {courses.length === 0 ? (
          <p className="empty">لا توجد جلسات بعد. تظهر الجلسات من الفصول الافتراضية المرتبطة بدورة، ومن أيام الدورات المسجلة التي لها تاريخ بداية.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الدورة</th>
                <th className="num">الجلسات</th>
                <th className="num">المنعقدة</th>
                <th className="num">المتدربون</th>
                <th className="num">يجتازون الحضور</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.course_id}>
                  <td>
                    <Link href={`/${slug}/dashboard/attendance/${c.course_id}`}>{c.title}</Link>
                  </td>
                  <td className="num">{formatNumber(c.sessions)}</td>
                  <td className="num">{formatNumber(c.held)}</td>
                  <td className="num">{formatNumber(c.trainees)}</td>
                  <td className="num">{c.held === 0 ? '—' : `${formatNumber(c.passing_trainees)} من ${formatNumber(c.trainees)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
