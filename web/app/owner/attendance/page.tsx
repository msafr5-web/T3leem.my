import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, owner, type OwnerAttendanceSummary } from '@/lib/api';
import { getOwnerSession } from '@/lib/owner-session';
import { OwnerShell } from '../owner-shell';

export const metadata: Metadata = { title: 'تقرير الحضور · لوحة إدارة المنصة', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const nf = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 1 });
const pct = (v: number | null) => (v === null ? '—' : `${nf.format(v)}٪`);

/** Attendance across every live academy, in one table: the platform owner sees what each academy's admin sees. */
export default async function OwnerAttendance() {
  const session = await getOwnerSession();
  if (!session) redirect('/owner');
  let data: OwnerAttendanceSummary;
  try {
    data = await owner.attendance(session.token);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) redirect('/owner');
    throw err;
  }
  const t = data.totals;
  // Academies with no session at all (new sign-ups, not yet set up) are left out of the table; the count shows how many.
  const active = data.academies.filter((a) => a.courses > 0);
  const quiet = data.academies.length - active.length;

  return (
    <OwnerShell email={session.email}>
      <div className="stack" style={{ gap: 24 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 style={{ fontSize: 28 }}>تقرير الحضور عبر الأكاديميات</h1>
            <p className="muted small">
              الأكاديميات الفعّالة فقط. «نسبة الحضور» = حضور (حاضر أو متأخر) ÷ كل خانات المتدربين × الجلسات المنعقدة. «يجتازون» = المتدربون الذين بلغوا حدّ اجتياز دورتهم (الافتراضي ٨٥٪).
            </p>
          </div>
          <Link href="/owner" className="btn btn-ghost">
            رجوع
          </Link>
        </div>

        <div className="hl-stats" role="group" aria-label="الإجمالي">
          <div><strong>{nf.format(t.academies)}</strong><span>أكاديمية</span></div>
          <div><strong>{nf.format(t.courses)}</strong><span>دورة بجلسات</span></div>
          <div><strong>{nf.format(t.held_sessions)}</strong><span>جلسة منعقدة</span></div>
          <div><strong>{nf.format(t.trainees)}</strong><span>متدرب</span></div>
          <div><strong>{pct(t.attendance_percent)}</strong><span>نسبة الحضور الكلية</span></div>
        </div>

        <div className="table-wrap">
          {active.length === 0 ? (
            <p className="empty">لا توجد جلسات في أي أكاديمية بعد.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الأكاديمية</th>
                  <th className="num">الدورات</th>
                  <th className="num">الجلسات المنعقدة</th>
                  <th className="num">المتدربون</th>
                  <th className="num">يجتازون</th>
                  <th className="num">نسبة الحضور</th>
                  <th className="num">تأخر</th>
                  <th className="num">غياب</th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/owner/attendance/${a.id}`}>{a.name}</Link> <span className="small muted ltr">{a.slug}</span>
                    </td>
                    <td className="num">{nf.format(a.courses)}</td>
                    <td className="num">{nf.format(a.held_sessions)}</td>
                    <td className="num">{nf.format(a.trainees)}</td>
                    <td className="num">{a.held_sessions === 0 ? '—' : `${nf.format(a.passing_trainees)} من ${nf.format(a.trainees)}`}</td>
                    <td className="num">{pct(a.attendance_percent)}</td>
                    <td className="num">{nf.format(a.late_slots)}</td>
                    <td className="num">{nf.format(a.absent_slots)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {quiet > 0 && <p className="small muted">{nf.format(quiet)} أكاديمية فعّالة بلا جلسات بعد (غير معروضة).</p>}
      </div>
    </OwnerShell>
  );
}
