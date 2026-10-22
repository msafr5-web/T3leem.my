import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createTraineeAction } from '@/lib/admin-actions';
import { formatDate, formatNumber } from '@/lib/format';
import { AdminForm } from '../admin-form';

export default async function DashboardTrainees({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const trainees = await admin.trainees(slug, token);

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 28 }}>المتدربون</h1>
        <p className="muted small">متدربو أكاديميتك فقط. يمكنك إنشاء حساب لمتدرب وإرسال بيانات الدخول إليه.</p>
      </div>

      <div className="table-wrap">
        {trainees.length === 0 ? (
          <p className="empty">لا يوجد متدربون بعد.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البريد</th>
                <th className="num">الدورات المسجلة</th>
                <th>تاريخ الانضمام</th>
              </tr>
            </thead>
            <tbody>
              {trainees.map((t) => (
                <tr key={t.id}>
                  <td>{t.full_name ?? '—'}</td>
                  <td className="ltr">{t.email}</td>
                  <td className="num">{formatNumber(t.enrollment_count)}</td>
                  <td className="small muted">{formatDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card stack" aria-labelledby="add-trainee">
        <h2 id="add-trainee">إضافة متدرب</h2>
        <AdminForm action={createTraineeAction.bind(null, slug)} submitLabel="إنشاء الحساب">
          <div className="form-grid">
            <label htmlFor="full_name">
              الاسم الكامل
              <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={120} />
            </label>
            <label htmlFor="email">
              البريد الإلكتروني
              <input id="email" name="email" type="email" required dir="ltr" />
            </label>
            <label htmlFor="password">
              كلمة مرور مؤقتة
              <input id="password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" dir="ltr" />
              <span className="hint">٨ أحرف على الأقل. شاركها مع المتدرب بطريقة آمنة.</span>
            </label>
          </div>
        </AdminForm>
      </section>
    </>
  );
}
