import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getCourse, type CourseDetail } from '@/lib/api';
import { courseTypeLabel, formatDate, formatNumber, formatSar, lessonTypeLabel } from '@/lib/format';
import { getSession } from '@/lib/session';

type Params = Promise<{ tenant: string; courseId: string }>;

async function loadCourse(slug: string, courseId: string): Promise<CourseDetail> {
  try {
    return await getCourse(slug, courseId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tenant, courseId } = await params;
  try {
    const c = await getCourse(tenant, courseId);
    return { title: c.title, description: c.description ?? undefined };
  } catch {
    return {};
  }
}

export default async function CoursePage({ params }: { params: Params }) {
  const { tenant: slug, courseId } = await params;
  const [course, session] = await Promise.all([loadCourse(slug, courseId), getSession(slug)]);

  const checkoutPath = `/${slug}/checkout/${course.id}`;
  const buyHref = session ? checkoutPath : `/${slug}/login?next=${encodeURIComponent(checkoutPath)}`;

  const facts: { label: string; value: string | null }[] = [
    { label: 'عدد الساعات التدريبية', value: course.training_hours !== null ? `${formatNumber(course.training_hours)} ساعة` : null },
    { label: 'مدة الدورة', value: course.duration_days !== null ? `${formatNumber(course.duration_days)} أيام` : null },
    { label: 'رقم الترخيص', value: course.license.number },
    { label: 'جهة الترخيص', value: course.license.authority },
    { label: 'صلاحية الترخيص حتى', value: course.license.expires_on ? formatDate(course.license.expires_on) : null },
    { label: 'رقم الاعتماد', value: course.accreditation_number },
  ];

  return (
    <div className="two-col">
      <article className="stack" style={{ gap: 24 }}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="badges">
            <span className={`chip${course.type === 'LIVE' ? ' live' : ''}`}>{courseTypeLabel[course.type]}</span>
            {course.accreditation_number && <span className="badge ok">دورة معتمدة</span>}
          </div>
          <h1>{course.title}</h1>
          {course.description && <p className="lead muted" style={{ fontSize: 17 }}>{course.description}</p>}
        </div>

        <section className="stack" aria-labelledby="facts-heading">
          <h2 id="facts-heading">بيانات الدورة</h2>
          <dl className="facts">
            {facts
              .filter((f) => f.value)
              .map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd className={/^[A-Z0-9-]+$/.test(f.value ?? '') ? 'ltr' : undefined} style={{ textAlign: 'right' }}>
                    {f.value}
                  </dd>
                </div>
              ))}
          </dl>
        </section>

        <section className="card person" aria-labelledby="trainer-heading">
          <span className="avatar" aria-hidden="true">{course.trainer.full_name.replace(/^(د\.|م\.|أ\.)\s*/, '').charAt(0)}</span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="small muted" id="trainer-heading">المدرب</span>
            <h3>{course.trainer.full_name}</h3>
            {course.trainer.specialization && <p className="small" style={{ color: 'var(--brand)' }}>{course.trainer.specialization}</p>}
            {course.trainer.bio && <p className="small muted">{course.trainer.bio}</p>}
          </div>
        </section>

        <section className="outline card" aria-labelledby="outline-heading">
          <h2 id="outline-heading">محتوى الدورة</h2>
          {course.modules.length === 0 ? (
            <p className="muted">سيُنشر المحتوى التفصيلي قريباً.</p>
          ) : (
            course.modules.map((m, i) => (
              <div key={m.id} className="stack" style={{ gap: 6 }}>
                <h3>
                  <span className="muted num">الوحدة {i + 1}: </span>
                  {m.title}
                </h3>
                <ol>
                  {m.lessons.map((l) => (
                    <li key={l.id}>
                      <span>{l.title}</span>
                      <span className="small muted">{lessonTypeLabel[l.content_type]}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
        </section>
      </article>

      <aside className="card sticky" aria-label="السعر والشراء">
        <div className="breakdown num">
          <div>
            <span className="muted">سعر الدورة</span>
            <span>{formatSar(course.price.net)}</span>
          </div>
          <div>
            <span className="muted">ضريبة القيمة المضافة ١٥٪</span>
            <span>{formatSar(course.price.vat)}</span>
          </div>
          <div className="total">
            <span>الإجمالي</span>
            <span>{formatSar(course.price.total)}</span>
          </div>
        </div>
        <Link href={buyHref} className="btn btn-primary btn-block">
          {session ? 'اشترِ الدورة' : 'سجّل الدخول للشراء'}
        </Link>
        <p className="small muted">تصدر فاتورة ضريبية إلكترونية معتمدة من ZATCA مع كل عملية شراء.</p>
      </aside>
    </div>
  );
}
