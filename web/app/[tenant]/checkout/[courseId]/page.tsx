import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiError, getCourse, type CourseDetail } from '@/lib/api';
import { formatSar } from '@/lib/format';
import { getSession } from '@/lib/session';
import { CheckoutForm } from './checkout-form';

export const metadata: Metadata = { title: 'إتمام الشراء' };

export default async function CheckoutPage({ params }: { params: Promise<{ tenant: string; courseId: string }> }) {
  const { tenant: slug, courseId } = await params;
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/checkout/${courseId}`)}`);

  let course: CourseDetail;
  try {
    course = await getCourse(slug, courseId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }

  return (
    <div className="narrow stack">
      <Link href={`/${slug}/courses/${course.id}`} className="small">
        → العودة إلى الدورة
      </Link>
      <h1>إتمام الشراء</h1>
      <div className="card stack">
        <h2>{course.title}</h2>
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
            <span>المبلغ المستحق</span>
            <span>{formatSar(course.price.total)}</span>
          </div>
        </div>
      </div>
      <div className="card">
        <CheckoutForm slug={slug} courseId={course.id} totalLabel={formatSar(course.price.total)} />
      </div>
    </div>
  );
}
