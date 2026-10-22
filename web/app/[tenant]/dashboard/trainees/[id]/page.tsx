import Link from 'next/link';
import { notFound } from 'next/navigation';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { deleteAction, updateTraineeAction } from '@/lib/admin-actions';
import { formatDate } from '@/lib/format';
import { AdminForm } from '../../admin-form';
import { DeleteButton } from '../../delete-button';

export default async function EditTrainee({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const token = await requireAdmin(slug);
  const trainee = (await admin.trainees(slug, token)).find((t) => t.id === id);
  if (!trainee) notFound();

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>بيانات المتدرب</h1>
          <p className="muted small ltr" style={{ textAlign: 'right' }}>{trainee.email}</p>
        </div>
        <Link href={`/${slug}/dashboard/trainees`} className="btn btn-ghost">رجوع</Link>
      </div>
      <dl className="facts">
        <div>
          <dt>الدورات المسجلة</dt>
          <dd>{trainee.enrollment_count}</dd>
        </div>
        <div>
          <dt>تاريخ الانضمام</dt>
          <dd>{formatDate(trainee.created_at)}</dd>
        </div>
      </dl>
      <div className="card">
        <AdminForm action={updateTraineeAction.bind(null, slug, trainee.id)} submitLabel="حفظ">
          <label htmlFor="full_name">
            الاسم الكامل
            <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={120} defaultValue={trainee.full_name ?? ''} />
          </label>
        </AdminForm>
      </div>
      <section className="card stack danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading" style={{ fontSize: 18 }}>حذف الحساب</h2>
        <p className="small muted">لا يمكن حذف متدرب لديه تسجيلات، لأن فواتيره الضريبية يجب أن تبقى محفوظة.</p>
        <DeleteButton action={deleteAction.bind(null, slug, 'trainees', trainee.id)} label="حذف حساب المتدرب" confirmText="حذف حساب هذا المتدرب نهائياً؟" />
      </section>
    </>
  );
}
