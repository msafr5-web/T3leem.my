import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/api';
import { formatDateTime, formatNumber, meetingProviderLabel } from '@/lib/format';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'دوراتي' };

export default async function MyCourses({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/my`)}`);

  const [enrollments, sessions] = await Promise.all([me.enrollments(slug, session.token), me.classrooms(slug, session.token)]);

  return (
    <div className="stack" style={{ gap: 32 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>دوراتي</h1>
        <p className="muted">تابع تقدمك، واحضر جلساتك المباشرة، واطّلع على شهاداتك.</p>
      </div>

      {sessions.length > 0 && (
        <section className="stack" aria-labelledby="live-heading">
          <h2 id="live-heading">جلساتي المباشرة القادمة</h2>
          <div className="grid">
            {sessions.map((s) => (
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
                    الانضمام إلى الجلسة
                  </a>
                ) : (
                  <span className="small muted">سيُضاف رابط الانضمام قبل الموعد.</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack" aria-labelledby="courses-heading">
        <h2 id="courses-heading">الدورات المسجّل فيها</h2>
        {enrollments.length === 0 ? (
          <div className="card empty">
            لم تسجّل في أي دورة بعد. <Link href={`/${slug}`}>تصفح الدورات</Link>
          </div>
        ) : (
          <div className="grid">
            {enrollments.map((e) => (
              <article key={e.enrollment_id} className="card">
                <div className="badges">
                  {e.completion_status === 'COMPLETED' ? <span className="badge ok">مكتملة</span> : <span className="badge">قيد التعلم</span>}
                  <span className="badge num">{formatNumber(e.lesson_count)} دروس</span>
                </div>
                <h3>{e.course_title}</h3>
                <p className="small muted">{e.trainer_name}</p>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(e.progress)} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة الإنجاز">
                  <span style={{ width: `${Math.min(100, e.progress)}%` }} />
                </div>
                <p className="small num">{formatNumber(e.progress)}٪ مكتمل</p>
                <div className="row-actions">
                  <Link href={`/${slug}/learn/${e.course_id}`} className="btn btn-primary">
                    {e.progress > 0 ? 'متابعة التعلم' : 'ابدأ التعلم'}
                  </Link>
                  {e.certificate_code && (
                    <Link href={`/verify/${e.certificate_code}`} className="btn btn-ghost">
                      الشهادة
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
