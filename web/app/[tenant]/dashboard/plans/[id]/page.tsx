import Link from 'next/link';
import { notFound } from 'next/navigation';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { deleteAction, updatePlanAction } from '@/lib/admin-actions';
import { AdminForm } from '../../admin-form';
import { DeleteButton } from '../../delete-button';
import { PlanFields } from '../plan-fields';

export default async function EditPlan({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const token = await requireAdmin(slug);
  const [plans, courses] = await Promise.all([admin.plans(slug, token), admin.courses(slug, token)]);
  const plan = plans.find((p) => p.id === id);
  if (!plan) notFound();

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: 28 }}>تعديل الخطة</h1>
        <Link href={`/${slug}/dashboard/plans`} className="btn btn-ghost">رجوع</Link>
      </div>
      <div className="card">
        <AdminForm action={updatePlanAction.bind(null, slug, plan.id)} submitLabel="حفظ التعديلات">
          <PlanFields courses={courses} plan={plan} />
        </AdminForm>
      </div>
      <section className="card stack danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading" style={{ fontSize: 18 }}>حذف الخطة</h2>
        <p className="small muted">تُحذف الخطة فقط، وتبقى دوراتها كما هي.</p>
        <DeleteButton action={deleteAction.bind(null, slug, 'plans', plan.id)} label="حذف الخطة" confirmText={`حذف خطة «${plan.title}»؟`} />
      </section>
    </>
  );
}
