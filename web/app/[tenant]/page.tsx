import type { Metadata } from 'next';
import Link from 'next/link';
import { getCourses, getPlans, getTenant, getTrainers, getUpcomingClassrooms } from '@/lib/api';
import {
  courseTypeLabel,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatNumber,
  formatSar,
  meetingProviderLabel,
  planTypeLabel,
} from '@/lib/format';

type Params = Promise<{ tenant: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tenant: slug } = await params;
  try {
    const t = await getTenant(slug);
    return { title: t.name, description: t.brand_settings?.tagline };
  } catch {
    return {};
  }
}

export default async function AcademyHome({ params }: { params: Params }) {
  const { tenant: slug } = await params;
  const [tenant, courses, plans, trainers, sessions] = await Promise.all([
    getTenant(slug),
    getCourses(slug),
    getPlans(slug),
    getTrainers(slug),
    getUpcomingClassrooms(slug),
  ]);
  const brand = tenant.brand_settings ?? {};
  const totalHours = courses.reduce((sum, c) => sum + (c.training_hours ?? 0), 0);

  return (
    <>
      <section className="hero">
        <span className="eyebrow">{brand.city ? `مزود خدمة تدريب · ${brand.city}` : 'مزود خدمة تدريب'}</span>
        <h1>{tenant.name}</h1>
        {brand.tagline && <p className="lead">{brand.tagline}</p>}
        {brand.about && <p className="muted" style={{ maxWidth: '68ch' }}>{brand.about}</p>}
        <div className="stats" aria-label="أرقام الأكاديمية">
          <div>
            <strong>{formatNumber(courses.length)}</strong>
            <span>دورة متاحة</span>
          </div>
          <div>
            <strong>{formatNumber(totalHours)}</strong>
            <span>ساعة تدريبية</span>
          </div>
          <div>
            <strong>{formatNumber(trainers.length)}</strong>
            <span>مدرب</span>
          </div>
          <div>
            <strong>{formatNumber(plans.length)}</strong>
            <span>خطة تدريبية وتطويرية</span>
          </div>
        </div>
      </section>

      {sessions.length > 0 && (
        <section className="stack" aria-labelledby="sessions-heading">
          <h2 id="sessions-heading">الفصول الافتراضية القادمة</h2>
          <div className="grid">
            {sessions.map((s) => (
              <div key={s.id} className="card session">
                <time dateTime={s.starts_at}>{formatDayMonth(s.starts_at)}</time>
                <div className="stack" style={{ gap: 4 }}>
                  <h3>{s.title}</h3>
                  <p className="small muted">{formatDateTime(s.starts_at)}</p>
                  <div className="badges">
                    <span className="badge">{s.duration_minutes} دقيقة</span>
                    <span className="badge">{meetingProviderLabel[s.provider]}</span>
                    {s.trainer && <span className="badge">{s.trainer.full_name}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <section className="section" aria-labelledby="plans-heading">
          <div className="stack" style={{ gap: 6 }}>
            <h2 id="plans-heading">الخطط التدريبية والتطويرية</h2>
            <p className="muted">مسارات منظمة من عدة دورات لتحقيق هدف مهني محدد.</p>
          </div>
          <div className="grid">
            {plans.map((p) => (
              <article key={p.id} className="card">
                <div className="badges">
                  <span className="chip">{planTypeLabel[p.type]}</span>
                  <span className="badge num">{formatNumber(p.total_hours)} ساعة</span>
                </div>
                <h3>{p.title}</h3>
                {p.description && <p className="small muted">{p.description}</p>}
                {(p.starts_on || p.ends_on) && (
                  <p className="small">
                    من {formatDate(p.starts_on)} إلى {formatDate(p.ends_on)}
                  </p>
                )}
                <ol className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
                  {p.courses.map((c) => (
                    <li key={c.id}>
                      <Link href={`/${slug}/courses/${c.id}`}>{c.title}</Link>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="courses-heading">
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="courses-heading">الدورات</h2>
          <p className="muted">الأسعار شاملة ضريبة القيمة المضافة.</p>
        </div>
        {courses.length === 0 ? (
          <p className="muted">لا توجد دورات منشورة حالياً. عُد قريباً.</p>
        ) : (
          <div className="grid">
            {courses.map((c) => (
              <Link key={c.id} href={`/${slug}/courses/${c.id}`} className="card card-link">
                <div className="meta">
                  <span className={`chip${c.type === 'LIVE' ? ' live' : ''}`}>{courseTypeLabel[c.type]}</span>
                  {c.accreditation_number && <span className="badge ok">معتمدة</span>}
                </div>
                <h3>{c.title}</h3>
                <p className="small muted">{c.trainer_name}</p>
                <div className="badges">
                  {c.training_hours !== null && <span className="badge num">{formatNumber(c.training_hours)} ساعة</span>}
                  {c.duration_days !== null && <span className="badge num">{formatNumber(c.duration_days)} أيام</span>}
                </div>
                <div className="price">
                  <span className="small muted">شامل الضريبة</span>
                  <strong className="num">{formatSar(c.price.total)}</strong>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {trainers.length > 0 && (
        <section className="section" aria-labelledby="trainers-heading">
          <h2 id="trainers-heading">المدربون</h2>
          <div className="grid">
            {trainers.map((t) => (
              <div key={t.id} className="card person">
                <span className="avatar" aria-hidden="true">{t.full_name.replace(/^(د\.|م\.|أ\.)\s*/, '').charAt(0)}</span>
                <div className="stack" style={{ gap: 4 }}>
                  <h3>{t.full_name}</h3>
                  {t.specialization && <p className="small" style={{ color: 'var(--brand)' }}>{t.specialization}</p>}
                  {t.bio && <p className="small muted">{t.bio}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
