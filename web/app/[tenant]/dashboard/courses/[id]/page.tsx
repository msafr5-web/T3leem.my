import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AdminCourse } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { deleteAction, updateCourseAction } from '@/lib/admin-actions';
import { DeleteButton } from '../../delete-button';
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
          <Link href={`/${slug}/dashboard/courses/${course.id}/content`} className="btn btn-primary">إدارة المحتوى والفيديو</Link>
          {course.is_published && (
            <Link href={`/${slug}/courses/${course.id}`} className="btn btn-ghost">عرض صفحة الدورة</Link>
          )}
          <Link href={`/${slug}/dashboard/courses`} className="btn btn-ghost">رجوع</Link>
        </div>
      </div>
      <div className="card">
        <CourseForm action={updateCourseAction.bind(null, slug, course.id)} trainers={trainers} course={course} />
      </div>
      <section className="card stack danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading" style={{ fontSize: 18 }}>حذف الدورة</h2>
        <p className="small muted">لا يمكن حذف دورة فيها متدربون مسجلون (فواتيرهم يجب أن تبقى). ألغِ نشرها بدلاً من ذلك.</p>
        <DeleteButton action={deleteAction.bind(null, slug, 'courses', course.id)} label="حذف الدورة" confirmText={`حذف «${course.title}» نهائياً؟`} />
      </section>
    </>
  );
}
