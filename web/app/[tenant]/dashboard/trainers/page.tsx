import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createTrainerAction } from '@/lib/admin-actions';
import { formatNumber } from '@/lib/format';
import { AdminForm } from '../admin-form';

export default async function DashboardTrainers({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const trainers = await admin.trainers(slug, token);

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 28 }}>المدربون</h1>
        <p className="muted small">أضف مدربيك بأسمائهم وتخصصاتهم. لا يحتاج المدرب حساب دخول ليُسند إليه دورات أو فصول.</p>
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
              </tr>
            </thead>
            <tbody>
              {trainers.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.full_name}
                    {t.bio && <div className="small muted">{t.bio}</div>}
                  </td>
                  <td>{t.specialization ?? '—'}</td>
                  <td className="ltr">{t.email ?? '—'}</td>
                  <td className="num">{formatNumber(t.course_count)}</td>
                  <td>{t.has_account ? <span className="badge ok">نعم</span> : <span className="badge">لا</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card stack" aria-labelledby="add-trainer">
        <h2 id="add-trainer">إضافة مدرب</h2>
        <AdminForm action={createTrainerAction.bind(null, slug)} submitLabel="إضافة المدرب">
          <div className="form-grid">
            <label htmlFor="full_name">
              الاسم الكامل
              <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={120} placeholder="مثال: د. سارة الغامدي" />
            </label>
            <label htmlFor="specialization">
              التخصص
              <input id="specialization" name="specialization" type="text" maxLength={200} />
            </label>
            <label htmlFor="email">
              البريد الإلكتروني <span className="hint">(اختياري)</span>
              <input id="email" name="email" type="email" dir="ltr" />
            </label>
            <label htmlFor="bio" className="full">
              نبذة
              <textarea id="bio" name="bio" maxLength={2000} />
            </label>
          </div>
        </AdminForm>
      </section>
    </>
  );
}
