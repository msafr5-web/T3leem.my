import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createTrainerAction, deleteAction } from '@/lib/admin-actions';
import { formatNumber } from '@/lib/format';
import Link from 'next/link';
import { AdminForm } from '../admin-form';
import { DeleteButton } from '../delete-button';
import { TrainerFields } from './trainer-fields';

export default async function DashboardTrainers({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const trainers = await admin.trainers(slug, token);

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>المدربون</h1>
          <p className="muted small">أضف مدربيك بأسمائهم وتخصصاتهم. لا يحتاج المدرب حساب دخول ليُسند إليه دورات أو فصول.</p>
        </div>
        <a href="#add-trainer" className="btn btn-primary">+ إضافة مدرب</a>
      </div>

      <div className="table-wrap">
        {trainers.length === 0 ? (
          <p className="empty">لم تُضف أي مدرب بعد.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>التخصص</th>
                <th>البريد</th>
                <th className="num">الدورات</th>
                <th>حساب دخول</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {trainers.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/${slug}/dashboard/trainers/${t.id}`}>{t.full_name}</Link>
                    {t.bio && <div className="small muted">{t.bio}</div>}
                  </td>
                  <td>{t.specialization ?? '—'}</td>
                  <td className="ltr">{t.email ?? '—'}</td>
                  <td className="num">{formatNumber(t.course_count)}</td>
                  <td>{t.has_account ? <span className="badge ok">نعم</span> : <span className="badge">لا</span>}</td>
                  <td>
                    <div className="row-actions">
                      <Link href={`/${slug}/dashboard/trainers/${t.id}`} className="btn btn-ghost btn-sm">تعديل</Link>
                      {t.course_count === 0 ? (
                        <DeleteButton
                          action={deleteAction.bind(null, slug, 'trainers', t.id)}
                          label="حذف"
                          size="sm"
                          confirmText={`حذف ${t.full_name} نهائياً؟`}
                        />
                      ) : (
                        <span className="small muted" title="انقل دوراته إلى مدرب آخر ثم احذفه">مسند إلى دورات</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card stack" aria-labelledby="add-trainer">
        <h2 id="add-trainer">إضافة مدرب</h2>
        <AdminForm action={createTrainerAction.bind(null, slug)} submitLabel="إضافة المدرب">
          <TrainerFields />
        </AdminForm>
      </section>
    </>
  );
}
