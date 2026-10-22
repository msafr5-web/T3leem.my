import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createCourseAction } from '@/lib/admin-actions';
import { CourseForm } from '../course-form';

export default async function NewCourse({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const trainers = await admin.trainers(slug, token);

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: 28 }}>دورة جديدة</h1>
        <Link href={`/${slug}/dashboard/courses`} className="btn btn-ghost">إلغاء</Link>
      </div>
      {trainers.length === 0 ? (
        <div className="card empty">
          أضف مدرباً أولاً حتى تتمكن من إسناد الدورة إليه. <Link href={`/${slug}/dashboard/trainers`}>إضافة مدرب</Link>
        </div>
      ) : (
        <div className="card">
          <CourseForm action={createCourseAction.bind(null, slug)} trainers={trainers} />
        </div>
      )}
    </>
  );
}
