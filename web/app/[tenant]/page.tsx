import type { Metadata } from 'next';
import Link from 'next/link';
import { getCourses, getTenant } from '@/lib/api';
import { courseTypeLabel, formatSar } from '@/lib/format';

type Params = Promise<{ tenant: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tenant: slug } = await params;
  try {
    return { title: (await getTenant(slug)).name };
  } catch {
    return {};
  }
}

export default async function AcademyHome({ params }: { params: Params }) {
  const { tenant: slug } = await params;
  const [tenant, courses] = await Promise.all([getTenant(slug), getCourses(slug)]);

  return (
    <>
      <section className="hero">
        <span className="eyebrow">الدورات التدريبية</span>
        <h1>تعلّم مع {tenant.name}</h1>
        <p className="lead">اختر دورة، ادفع بأمان عبر مدى أو البطاقة، وابدأ التعلم فوراً. الأسعار شاملة ضريبة القيمة المضافة.</p>
      </section>

      {courses.length === 0 ? (
        <p className="muted">لا توجد دورات منشورة حالياً. عُد قريباً.</p>
      ) : (
        <div className="grid">
          {courses.map((c) => (
            <Link key={c.id} href={`/${slug}/courses/${c.id}`} className="card card-link">
              <div className="meta">
                <span className={`chip${c.type === 'LIVE' ? ' live' : ''}`}>{courseTypeLabel[c.type]}</span>
                {c.module_count > 0 && (
                  <span className="num">
                    {c.module_count} وحدات · {c.lesson_count} دروس
                  </span>
                )}
              </div>
              <h3>{c.title}</h3>
              <div className="price">
                <span className="small muted">شامل الضريبة</span>
                <strong className="num">{formatSar(c.price.total)}</strong>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
