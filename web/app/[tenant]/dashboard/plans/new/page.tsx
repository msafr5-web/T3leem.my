import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createPlanAction } from '@/lib/admin-actions';
import { AdminForm } from '../../admin-form';
import { PlanFields } from '../plan-fields';

export default async function NewPlan({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const courses = await admin.courses(slug, token);

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: 28 }}>خطة جديدة</h1>
        <Link href={`/${slug}/dashboard/plans`} className="btn btn-ghost">إلغاء</Link>
      </div>
      <div className="card">
        <AdminForm action={createPlanAction.bind(null, slug)} submitLabel="إنشاء الخطة">
          <PlanFields courses={courses} />
        </AdminForm>
      </div>
    </>
  );
}
