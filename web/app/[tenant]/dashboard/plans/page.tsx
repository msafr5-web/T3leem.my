import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { formatDate, formatNumber, planStatusLabel, planTypeLabel } from '@/lib/format';

export default async function DashboardPlans({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const plans = await admin.plans(slug, token);

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>الخطط التدريبية والتطويرية</h1>
          <p className="muted small">الخطط النشطة تظهر للمتدربين في صفحة أكاديميتك، والمسودات تبقى داخل لوحة التحكم.</p>
        </div>
        <Link href={`/${slug}/dashboard/plans/new`} className="btn btn-primary">خطة جديدة</Link>
      </div>

      {plans.length === 0 ? (
        <div className="card empty">لا توجد خطط بعد.</div>
      ) : (
        <div className="grid">
          {plans.map((p) => (
            <article key={p.id} className="card">
              <div className="badges">
                <span className="chip">{planTypeLabel[p.type]}</span>
                <span className={`badge ${p.status === 'ACTIVE' ? 'ok' : p.status === 'DRAFT' ? 'draft' : ''}`}>{planStatusLabel[p.status]}</span>
                <span className="badge num">{formatNumber(p.total_hours)} ساعة</span>
              </div>
              <h3>{p.title}</h3>
              {p.description && <p className="small muted">{p.description}</p>}
              <p className="small">
                {formatDate(p.starts_on)} ← {formatDate(p.ends_on)}
              </p>
              <ol className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
                {p.courses.map((c) => (
                  <li key={c.id}>
                    {c.title}
                    {!c.is_published && <span className="badge draft" style={{ marginInlineStart: 6 }}>غير منشورة</span>}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
