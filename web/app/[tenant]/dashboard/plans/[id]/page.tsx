import Link from 'next/link';
import { notFound } from 'next/navigation';
import { admin } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { requireAdmin } from '@/lib/admin';
import { addRecordedBatchAction, deleteAction, updatePlanAction } from '@/lib/admin-actions';
import { AdminForm } from '../../admin-form';
import { DeleteButton } from '../../delete-button';
import { PlanFields } from '../plan-fields';
import { BatchRecordedForm } from './batch-recorded-form';

export default async function EditPlan({ params, searchParams }: { params: Promise<{ tenant: string; id: string }>; searchParams: Promise<{ added?: string }> }) {
  const [{ tenant: slug, id }, { added }] = await Promise.all([params, searchParams]);
  const token = await requireAdmin(slug);
  const [plans, courses, trainers] = await Promise.all([admin.plans(slug, token), admin.courses(slug, token), admin.trainers(slug, token)]);
  const plan = plans.find((p) => p.id === id);
  if (!plan) notFound();

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: 28 }}>تعديل الخطة</h1>
        <Link href={`/${slug}/dashboard/plans`} className="btn btn-ghost">رجوع</Link>
      </div>
      {added === '1' && (
        <p className="notice ok" role="status">
          أُضيفت الدورة إلى الخطة ورُتّبت حسب تاريخ بدايتها.
        </p>
      )}

      <section className="card stack" aria-labelledby="order-heading">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h2 id="order-heading" style={{ fontSize: 18 }}>ترتيب الدورات في الخطة</h2>
          <Link href={`/${slug}/dashboard/recorded/new?plan=${plan.id}`} className="btn btn-primary">
            + إضافة دورة مسجّلة (بالخطوات الكاملة)
          </Link>
        </div>
        <p className="small muted">
          تُرتَّب الدورات تلقائياً حسب تاريخ بدايتها كلما أُضيفت دورة أو تغيّر موعد دورة، ولا يُسمح بتداخل أيام دورتين وأوقاتهما في الخطة. الدورات بلا تاريخ تبقى في الآخر.
        </p>
        {plan.courses.length === 0 ? (
          <p className="small muted">لا دورات في هذه الخطة بعد.</p>
        ) : (
          <ol className="small" style={{ margin: 0, paddingInlineStart: 22 }}>
            {plan.courses.map((pc) => {
              const full = courses.find((c) => c.id === pc.id);
              const start = full?.recorded?.starts_at;
              return (
                <li key={pc.id}>
                  {pc.title}{' '}
                  <span className="muted">
                    {start ? `— يبدأ ${formatDateTime(start)} · ${formatNumber(full?.recorded?.day_count ?? 0)} ${full?.recorded?.day_count === 1 ? 'يوم' : 'أيام'}` : '— بلا تاريخ بداية'}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="card">
        <AdminForm action={updatePlanAction.bind(null, slug, plan.id)} submitLabel="حفظ التعديلات">
          <PlanFields courses={courses} plan={plan} />
        </AdminForm>
      </div>
      <section className="card stack" aria-labelledby="batch-heading">
        <h2 id="batch-heading" style={{ fontSize: 18 }}>إضافة دورات مسجّلة دفعة واحدة (بلا تواريخ)</h2>
        <p className="small muted">
          اختر المدرب ثم ألصق روابط YouTube لمحاضراته المسجّلة: تُنشأ دورة مسجّلة لكل رابط (بجدولتها الافتراضية) وتُضاف تلقائياً إلى هذه الخطة بالترتيب. يمكنك لاحقاً تعديل كل دورة وتحديد تاريخ بدايتها.
        </p>
        <BatchRecordedForm action={addRecordedBatchAction.bind(null, slug, plan.id)} trainers={trainers} />
      </section>
      <section className="card stack danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading" style={{ fontSize: 18 }}>حذف الخطة</h2>
        <p className="small muted">تُحذف الخطة فقط، وتبقى دوراتها كما هي.</p>
        <DeleteButton action={deleteAction.bind(null, slug, 'plans', plan.id)} label="حذف الخطة" confirmText={`حذف خطة «${plan.title}»؟`} />
      </section>
    </>
  );
}
