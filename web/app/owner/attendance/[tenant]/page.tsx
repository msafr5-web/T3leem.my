import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiError, owner, type OwnerAttendanceCourses } from '@/lib/api';
import { getOwnerSession } from '@/lib/owner-session';
import { OwnerShell } from '../../owner-shell';

export const metadata: Metadata = { title: 'حضور أكاديمية · لوحة إدارة المنصة', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nf = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 1 });
const pct = (v: number | null) => (v === null ? '—' : `${nf.format(v)}٪`);

/** One academy's courses with their attendance (read-only; the academy's admin manages the details). */
export default async function OwnerAcademyAttendance({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!UUID.test(tenant)) notFound();
  const session = await getOwnerSession();
  if (!session) redirect('/owner');
  let data: OwnerAttendanceCourses;
  try {
    data = await owner.attendanceCourses(session.token, tenant);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) redirect('/owner');
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <OwnerShell email={session.email}>
      <div className="stack" style={{ gap: 24 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 style={{ fontSize: 28 }}>
              حضور «{data.academy.name}» <span className="small muted ltr">{data.academy.slug}</span>
            </h1>
            <p className="muted small">دورات الأكاديمية التي لها جلسات (فصول افتراضية مرتبطة بدورة، وأيام الدورات المسجلة ذات تاريخ البداية).</p>
          </div>
          <Link href="/owner/attendance" className="btn btn-ghost">
            رجوع للأكاديميات
          </Link>
        </div>
        <div className="table-wrap">
          {data.courses.length === 0 ? (
            <p className="empty">لا جلسات في هذه الأكاديمية بعد.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الدورة</th>
                  <th className="num">الجلسات</th>
                  <th className="num">المنعقدة</th>
                  <th className="num">المتدربون</th>
                  <th className="num">يجتازون</th>
                  <th className="num">نسبة الحضور</th>
                </tr>
              </thead>
              <tbody>
                {data.courses.map((c) => (
                  <tr key={c.course_id}>
                    <td>{c.title}</td>
                    <td className="num">{nf.format(c.sessions)}</td>
                    <td className="num">{nf.format(c.held)}</td>
                    <td className="num">{nf.format(c.trainees)}</td>
                    <td className="num">{c.held === 0 ? '—' : `${nf.format(c.passing_trainees)} من ${nf.format(c.trainees)}`}</td>
                    <td className="num">{pct(c.attendance_percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </OwnerShell>
  );
}
