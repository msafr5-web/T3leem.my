import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AttendanceReport, type AttendanceStatus } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { formatDateTime, formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<AttendanceStatus, [string, string]> = { PRESENT: ['حاضر', 'badge ok'], LATE: ['متأخر', 'badge draft'], ABSENT: ['غائب', 'badge bad'], PENDING: ['—', 'badge'] };

/** One course: a row per trainee, a column per session, then attendance percentage and whether they pass (85%). */
export default async function AttendanceCourse({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const token = await requireAdmin(slug);
  let report: AttendanceReport;
  try {
    report = await admin.attendanceReport(slug, token, id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const held = report.sessions.filter((s) => s.held).length;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>{report.course.title}</h1>
          <p className="muted small">
            {formatNumber(report.sessions.length)} جلسة · {formatNumber(held)} منعقدة · {formatNumber(report.trainees.length)} متدرب · {formatNumber(report.passing_trainees)} يجتازون ({report.rules.pass_percent}٪ فأكثر)
          </p>
        </div>
        <div className="cta-row">
          <a href={`/${slug}/dashboard/attendance/${id}/export`} className="btn btn-primary">
            تنزيل Excel
          </a>
          <Link href={`/${slug}/dashboard/attendance`} className="btn btn-ghost">
            رجوع
          </Link>
        </div>
      </div>

      <div className="table-wrap">
        {report.trainees.length === 0 ? (
          <p className="empty">لا متدربين مسجلين في هذه الدورة.</p>
        ) : (
          <table className="att-matrix">
            <thead>
              <tr>
                <th>المتدرب</th>
                {report.sessions.map((s) => (
                  <th key={s.ref} scope="col">
                    {s.title}
                    <div className="small muted">{formatDateTime(s.starts_at)}</div>
                  </th>
                ))}
                <th className="num">النسبة</th>
                <th>النتيجة</th>
              </tr>
            </thead>
            <tbody>
              {report.trainees.map((t) => (
                <tr key={t.user_id}>
                  <td>
                    {t.name}
                    {!t.admin_enrolled && <div className="small muted">سجّل بنفسه</div>}
                  </td>
                  {report.sessions.map((s) => {
                    const [label, cls] = STATUS[t.statuses[s.ref] ?? 'PENDING'];
                    return (
                      <td key={s.ref}>
                        <span className={cls}>{label}</span>
                      </td>
                    );
                  })}
                  <td className="num">{t.summary.percent === null ? '—' : `${formatNumber(t.summary.percent)}٪`}</td>
                  <td>{t.summary.passes === null ? '—' : t.summary.passes ? <span className="badge ok">يجتاز</span> : <span className="badge bad">لا يجتاز</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="small muted">
        الحضور محسوب على الجلسات المنعقدة فقط. المتأخر يُحسب حاضراً في النسبة. الخروج قبل نهاية الجلسة المباشرة بأكثر من {report.rules.leave_grace_minutes} دقائق يُعدّ غياباً.
      </p>
    </>
  );
}
