import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, trainerPortal, type TrainerOverview } from '@/lib/api';
import { courseTypeLabel, formatDateTime, formatNumber, meetingProviderLabel } from '@/lib/format';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'لوحة المدرب' };
export const dynamic = 'force-dynamic';

/** A trainer's own page: their courses, live sessions (with join links) and, per course, how their trainees are doing. */
export default async function TrainerHome({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/trainer`)}`);
  if (session.role === 'TENANT_ADMIN') redirect(`/${slug}/dashboard`);
  if (session.role !== 'INSTRUCTOR') redirect(`/${slug}/my`);

  let data: TrainerOverview;
  try {
    data = await trainerPortal.overview(slug, session.token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return (
        <div className="narrow stack">
          <h1>لوحة المدرب</h1>
          <p className="notice error" role="alert">
            حسابك غير مربوط بملف مدرب في هذه الأكاديمية. تواصل مع مدير الأكاديمية.
          </p>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="stack" style={{ gap: 32 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>{data.trainer.full_name}</h1>
        <p className="muted">{data.trainer.specialization ?? 'مدرب'} · لوحتك: دوراتك وجلساتك المباشرة ومتابعة متدربيك.</p>
      </div>

      <section className="stack" aria-labelledby="live-heading">
        <h2 id="live-heading">جلساتي المباشرة القادمة</h2>
        {data.sessions.length === 0 ? (
          <p className="empty">لا جلسات مباشرة قادمة مسندة إليك.</p>
        ) : (
          <div className="grid">
            {data.sessions.map((s) => (
              <div key={s.id} className="card stack" style={{ gap: 6 }}>
                <h3>{s.title}</h3>
                {s.course_title && <p className="small muted">{s.course_title}</p>}
                <p className="small">{formatDateTime(s.starts_at)}</p>
                <div className="badges">
                  <span className="badge">{s.duration_minutes} دقيقة</span>
                  <span className="badge">{meetingProviderLabel[s.provider]}</span>
                </div>
                {s.join_url ? (
                  <a href={s.join_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                    فتح الجلسة
                  </a>
                ) : (
                  <p className="small muted">لم يُضف رابط الجلسة بعد.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="courses-heading">
        <h2 id="courses-heading">دوراتي</h2>
        {data.courses.length === 0 ? (
          <p className="empty">لا دورات مسندة إليك بعد.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الدورة</th>
                  <th>النوع</th>
                  <th>الحالة</th>
                  <th>تبدأ</th>
                  <th className="num">المتدربون</th>
                </tr>
              </thead>
              <tbody>
                {data.courses.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/${slug}/trainer/courses/${c.id}`}>{c.title}</Link>
                      {c.type === 'RECORDED' && (
                        <div className="small">
                          <Link href={`/${slug}/trainer/courses/${c.id}/quiz`}>أسئلة الاختبار</Link>
                        </div>
                      )}
                    </td>
                    <td>{courseTypeLabel[c.type]}</td>
                    <td>{c.is_published ? <span className="badge ok">منشورة</span> : <span className="badge draft">مسودة</span>}</td>
                    <td className="small muted">{c.starts_at ? formatDateTime(c.starts_at) : '—'}</td>
                    <td className="num">{formatNumber(c.enrollment_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
