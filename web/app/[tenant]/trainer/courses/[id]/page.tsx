import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiError, trainerPortal, type TrainerCourseTrainees } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'متدربو الدورة' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = { ACTIVE: 'فعّال', SUSPENDED: 'موقوف', EXPIRED: 'منتهٍ' } as const;

/** Read-only: how the trainees of one of the trainer's courses are progressing (names and progress only). */
export default async function TrainerCourse({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/trainer/courses/${id}`)}`);
  if (session.role !== 'INSTRUCTOR') redirect(session.role === 'TENANT_ADMIN' ? `/${slug}/dashboard` : `/${slug}/my`);

  let data: TrainerCourseTrainees;
  try {
    data = await trainerPortal.courseTrainees(slug, session.token, id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  const done = data.trainees.filter((t) => t.completion_status === 'COMPLETED').length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>{data.title}</h1>
          <p className="muted small">
            {formatNumber(data.trainees.length)} متدرب · {formatNumber(done)} أتمّوا الدورة
          </p>
        </div>
        <Link href={`/${slug}/trainer`} className="btn btn-ghost">
          رجوع
        </Link>
      </div>
      <div className="table-wrap">
        {data.trainees.length === 0 ? (
          <p className="empty">لا متدربين مسجلين في هذه الدورة بعد.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المتدرب</th>
                <th className="num">التقدم</th>
                <th>الحالة</th>
                <th>تاريخ التسجيل</th>
              </tr>
            </thead>
            <tbody>
              {data.trainees.map((t, i) => (
                <tr key={i}>
                  <td>{t.name}</td>
                  <td className="num">{formatNumber(t.progress_percentage)}%</td>
                  <td>{t.completion_status === 'COMPLETED' ? <span className="badge ok">أتمّ الدورة</span> : <span className="badge">{STATUS[t.status]}</span>}</td>
                  <td className="small muted">{formatDate(t.enrolled_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
