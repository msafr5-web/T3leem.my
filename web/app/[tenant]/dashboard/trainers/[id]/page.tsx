import Link from 'next/link';
import { notFound } from 'next/navigation';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { deleteAction, updateTrainerAction } from '@/lib/admin-actions';
import { AdminForm } from '../../admin-form';
import { DeleteButton } from '../../delete-button';
import { TrainerFields } from '../trainer-fields';

export default async function EditTrainer({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const token = await requireAdmin(slug);
  const trainer = (await admin.trainers(slug, token)).find((t) => t.id === id);
  if (!trainer) notFound();

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>تعديل المدرب</h1>
          <p className="muted small">مسند إلى {trainer.course_count} دورة</p>
        </div>
        <Link href={`/${slug}/dashboard/trainers`} className="btn btn-ghost">رجوع</Link>
      </div>
      <div className="card">
        <AdminForm action={updateTrainerAction.bind(null, slug, trainer.id)} submitLabel="حفظ التعديلات">
          <TrainerFields trainer={trainer} />
        </AdminForm>
      </div>
      <section className="card stack danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading" style={{ fontSize: 18 }}>حذف المدرب</h2>
        <p className="small muted">لا يمكن حذف مدرب مسند إلى دورات. انقل دوراته إلى مدرب آخر أولاً. الفصول المرتبطة به تبقى بدون مدرب.</p>
        <DeleteButton action={deleteAction.bind(null, slug, 'trainers', trainer.id)} label="حذف المدرب" confirmText={`حذف ${trainer.full_name} نهائياً؟`} />
      </section>
    </>
  );
}
