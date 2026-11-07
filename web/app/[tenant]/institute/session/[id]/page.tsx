import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { saveAttendanceAction } from '@/lib/institute-actions';
import { ApiError, admin } from '@/lib/api';
import { isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { ActionForm } from '../../../dashboard/health/health-forms';

export const metadata: Metadata = { title: 'حضور الحصة' };

const STATUS = [
  ['PRESENT', 'حاضر'],
  ['LATE', 'متأخر'],
  ['ABSENT', 'غائب'],
  ['EXCUSED', 'غياب بعذر'],
] as const;

export default async function SessionAttendance({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute/session/${id}`)}`);

  let roster;
  try {
    roster = await admin.instituteRoster(slug, session.token, id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  const { session: s, students } = roster;
  const when = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'full', timeStyle: 'short' }).format(new Date(s.starts_at));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>حضور الحصة</h1>
        <p className="muted">{when}</p>
      </div>
      {s.status === 'CANCELLED' ? (
        <p className="notice" role="status">هذه الحصة ملغاة ولا يُسجَّل لها حضور.</p>
      ) : students.length === 0 ? (
        <p className="notice" role="status">لا يوجد طلاب مسجلون في مستوى هذه المادة بعد.</p>
      ) : (
        <section className="card stack">
          <ActionForm action={saveAttendanceAction.bind(null, slug, id)} submitLabel="حفظ الحضور">
            <table className="table">
              <thead><tr><th>الطالب</th><th>الحالة</th></tr></thead>
              <tbody>
                {students.map((st) => (
                  <tr key={st.id}>
                    <td>{st.full_name}{st.status !== 'ACTIVE' ? <span className="muted"> ({st.status === 'SUSPENDED' ? 'موقوف' : st.status === 'GRADUATED' ? 'متخرج' : 'منسحب'})</span> : null}</td>
                    <td>
                      <select name={`att_${st.id}`} defaultValue={st.attendance ?? ''} aria-label={`حالة ${st.full_name}`}>
                        <option value="">لم يُسجَّل</option>
                        {STATUS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ActionForm>
        </section>
      )}
      <div><Link href={`/${slug}/institute/academic`} className="btn btn-ghost">العودة إلى الجدول</Link></div>
    </div>
  );
}
