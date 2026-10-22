import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getCourse, type CourseDetail } from '@/lib/api';
import { courseTypeLabel, formatSar, lessonTypeLabel } from '@/lib/format';
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
    return { title: (await getCourse(tenant, courseId)).title };
  } catch {
    return {};
  }
}

export default async function CoursePage({ params }: { params: Params }) {
  const { tenant: slug, courseId } = await params;
  const [course, session] = await Promise.all([loadCourse(slug, courseId), getSession(slug)]);

  const checkoutPath = `/${slug}/checkout/${course.id}`;
  const buyHref = session ? checkoutPath : `/${slug}/login?next=${encodeURIComponent(checkoutPath)}`;

  return (
    <div className="two-col">
      <article className="stack">
        <div className="meta" style={{ display: 'flex', gap: 8 }}>
          <span className={`chip${course.type === 'LIVE' ? ' live' : ''}`}>{courseTypeLabel[course.type]}</span>
        </div>
        <h1>{course.title}</h1>

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
