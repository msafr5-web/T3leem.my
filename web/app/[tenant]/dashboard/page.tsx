import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { formatDateTime, formatNumber, formatSar, meetingProviderLabel } from '@/lib/format';

export default async function DashboardOverview({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const o = await admin.overview(slug, token);
  const base = `/${slug}/dashboard`;

  const tiles = [
    { label: 'إجمالي الإيرادات', value: formatSar(o.revenue_total) },
    { label: 'التسجيلات', value: formatNumber(o.counts.enrollments) },
    { label: 'المتدربون', value: formatNumber(o.counts.trainees), href: `${base}/trainees` },
    { label: 'الدورات المنشورة', value: `${formatNumber(o.counts.published_courses)} / ${formatNumber(o.counts.courses)}`, href: `${base}/courses` },
    { label: 'المدربون', value: formatNumber(o.counts.trainers), href: `${base}/trainers` },
    { label: 'الخطط النشطة', value: formatNumber(o.counts.active_plans), href: `${base}/plans` },
  ];

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: 28 }}>نظرة عامة</h1>
        <div className="cta-row">
          <Link href={`${base}/courses/new`} className="btn btn-primary">دورة جديدة</Link>
          <Link href={`${base}/classrooms`} className="btn btn-ghost">جدولة فصل افتراضي</Link>
        </div>
      </div>

      <div className="tiles">
        {tiles.map((t) => {
          const body = (
            <>
              <span>{t.label}</span>
              <strong className="num">{t.value}</strong>
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="tile card-link">
              {body}
            </Link>
          ) : (
            <div key={t.label} className="tile">
              {body}
            </div>
          );
        })}
      </div>

      <div className="two-col even">
        <section className="stack" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading">الفصول الافتراضية القادمة</h2>
          {o.upcoming_classrooms.length === 0 ? (
            <div className="card empty">
              لا توجد جلسات مجدولة. <Link href={`${base}/classrooms`}>جدول أول فصل</Link>
            </div>
          ) : (
            o.upcoming_classrooms.map((c) => (
              <div key={c.id} className="card stack" style={{ gap: 4 }}>
                <h3>{c.title}</h3>
                <p className="small muted">{formatDateTime(c.starts_at)}</p>
                <div className="badges">
                  <span className="badge">{c.duration_minutes} دقيقة</span>
                  <span className="badge">{meetingProviderLabel[c.provider]}</span>
                  {c.trainer && <span className="badge">{c.trainer.full_name}</span>}
                  {c.capacity && <span className="badge">السعة {formatNumber(c.capacity)}</span>}
                </div>
              </div>
            ))
          )}
        </section>

        <section className="stack" aria-labelledby="recent-heading">
          <h2 id="recent-heading">أحدث التسجيلات</h2>
          {o.recent_enrollments.length === 0 ? (
            <div className="card empty">لم يسجّل أي متدرب بعد.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المتدرب</th>
                    <th>الدورة</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {o.recent_enrollments.map((e) => (
                    <tr key={e.id}>
                      <td>{e.trainee_name}</td>
                      <td>{e.course_title}</td>
                      <td className="small muted">{formatDateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
