import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AdminCourse } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { updateCourseAction } from '@/lib/admin-actions';
import { CourseForm } from '../course-form';

export default async function EditCourse({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const token = await requireAdmin(slug);

  let course: AdminCourse;
  try {
    course = await admin.course(slug, token, id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  const trainers = await admin.trainers(slug, token);

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>تعديل الدورة</h1>
          <p className="muted small">{course.enrollment_count} متدرب مسجّل</p>
        </div>
        <div className="cta-row">
          {course.is_published && (
            <Link href={`/${slug}/courses/${course.id}`} className="btn btn-ghost">عرض صفحة الدورة</Link>
          )}
          <Link href={`/${slug}/dashboard/courses`} className="btn btn-ghost">رجوع</Link>
        </div>
      </div>
      <div className="card">
        <CourseForm action={updateCourseAction.bind(null, slug, course.id)} trainers={trainers} course={course} />
      </div>
    </>
  );
}
