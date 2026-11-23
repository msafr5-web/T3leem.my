import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createTrainerAction, deleteAction, grantTrainerAccountAction, revokeTrainerAccountAction } from '@/lib/admin-actions';
import { formatNumber } from '@/lib/format';
import Link from 'next/link';
import { AdminForm } from '../admin-form';
import { DeleteButton } from '../delete-button';
import { TrainerFields } from './trainer-fields';

const ACCOUNT_NOTICE: Record<string, string> = {
  invited: 'أُنشئ حساب الدخول وأُرسلت دعوة إلى بريد المدرب. يدخل من صفحة الدخول بالبريد والرمز.',
  created: 'أُنشئ حساب الدخول، لكن تعذّر إرسال الدعوة. أخبر المدرب أن يدخل من صفحة الدخول بالبريد والرمز.',
  revoked: 'أُلغي حساب دخول المدرب. يبقى المدرب ودوراته كما هي.',
};

export default async function DashboardTrainers({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ account?: string }> }) {
  const [{ tenant: slug }, { account }] = await Promise.all([params, searchParams]);
  const token = await requireAdmin(slug);
  const trainers = await admin.trainers(slug, token);

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>المدربون</h1>
          <p className="muted small">أضف مدربيك بأسمائهم وتخصصاتهم. لا يحتاج المدرب حساب دخول ليُسند إليه دورات أو فصول؛ ومن مُنح حساب دخول (يلزم بريده) يدخل بالبريد ورمز يصله ويرى دوراته وجلساته ومتدربيه.</p>
        </div>
        <a href="#add-trainer" className="btn btn-primary">+ إضافة مدرب</a>
      </div>

      {account && ACCOUNT_NOTICE[account] && (
        <p className="notice ok" role="status">
          {ACCOUNT_NOTICE[account]}
        </p>
      )}

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
                  <td>
                    {t.has_account ? (
                      <div className="stack" style={{ gap: 6 }}>
                        <span className="badge ok">نعم</span>
                        <DeleteButton
                          action={revokeTrainerAccountAction.bind(null, slug, t.id)}
                          label="إلغاء الحساب"
                          size="sm"
                          confirmText={`إلغاء حساب دخول ${t.full_name}؟ يبقى المدرب ودوراته.`}
                        />
                      </div>
                    ) : t.email ? (
                      <div className="stack" style={{ gap: 6 }}>
                        <span className="badge">لا</span>
                        <DeleteButton
                          action={grantTrainerAccountAction.bind(null, slug, t.id)}
                          label="منح حساب دخول"
                          size="sm"
                          variant="primary"
                          confirmText={`منح ${t.full_name} حساب دخول وإرسال دعوة إلى ${t.email}؟`}
                        />
                      </div>
                    ) : (
                      <div className="stack" style={{ gap: 4 }}>
                        <span className="badge">لا</span>
                        <span className="small muted">أضف بريداً للمدرب أولاً</span>
                      </div>
                    )}
                  </td>
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
