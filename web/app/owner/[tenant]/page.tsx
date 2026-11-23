import { PlatformEmblem } from '@/app/brand-mark';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiError, owner, type OwnerTrainee } from '@/lib/api';
import { eraseTraineeAction, ownerLogoutAction } from '@/lib/owner-actions';
import { getOwnerSession } from '@/lib/owner-session';
import { OwnerForm } from '../owner-forms';

export const metadata: Metadata = { title: 'متدربو الأكاديمية · لوحة إدارة المنصة', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nf = new Intl.NumberFormat('ar-SA-u-nu-latn');
const dateFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium', timeZone: 'Asia/Riyadh' });

/** The platform owner's view of one academy's trainees, with the one place where a trainee is erased for good. */
export default async function OwnerAcademyTrainees({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ erased?: string }>;
}) {
  const [{ tenant: tenantId }, { erased }] = await Promise.all([params, searchParams]);
  if (!UUID.test(tenantId)) notFound();
  const session = await getOwnerSession();
  if (!session) redirect('/owner');

  let academy: { name: string; slug: string } | undefined;
  let trainees: OwnerTrainee[];
  try {
    const [overview, list] = await Promise.all([owner.overview(session.token), owner.trainees(session.token, tenantId)]);
    const t = overview.tenants.find((x) => x.id === tenantId);
    academy = t && { name: t.name, slug: t.slug };
    trainees = list;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) redirect('/owner');
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  if (!academy) notFound();

  const done = erased && /^\d+\.\d+$/.test(erased) ? erased.split('.').map(Number) : null;

  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand-mark">
            <PlatformEmblem />
            T3leem.my · الإدارة
          </Link>
          <div className="header-actions">
            <span className="small muted ltr">{session.email}</span>
            <form action={ownerLogoutAction}>
              <button type="submit" className="btn btn-ghost">
                تسجيل الخروج
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="container">
        <div className="stack" style={{ gap: 24 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div className="stack" style={{ gap: 4 }}>
              <h1 style={{ fontSize: 28 }}>
                متدربو «{academy.name}» <span className="small muted ltr">{academy.slug}</span>
              </h1>
              <p className="muted small">{nf.format(trainees.length)} متدرب. المسح النهائي يحذف المتدرب وكل بياناته ولا يمكن التراجع عنه.</p>
            </div>
            <Link href="/owner" className="btn btn-ghost">
              رجوع للأكاديميات
            </Link>
          </div>

          {done && (
            <p className="notice ok" role="status">
              تم المسح النهائي: حُذف المتدرب مع {nf.format(done[0] ?? 0)} تسجيلاً و{nf.format(done[1] ?? 0)} شهادة وكل بياناته.
            </p>
          )}

          <div className="card" style={{ padding: 14 }}>
            <strong>ما الذي يُمسح وما الذي يبقى؟</strong>
            <ul className="small" style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
              <li>يُمسح: الحساب (الاسم والبريد والجوال والرقم الوظيفي)، التسجيلات والتقدم، الاختبارات والنقاش، الشهادات وإدخالاتها في صفحة التحقق، سجلات الحضور، رموز الدخول، وتفاصيل سجل التدقيق القديمة عنه.</li>
              <li>يبقى: الفواتير الضريبية (يلزم نظاماً الاحتفاظ بها)؛ لا تحمل اسماً ولا بيانات اتصال، وينقطع ارتباطها بالتسجيل المحذوف. ويُسجَّل في سجل التدقيق أن المسح تم (بأعداد فقط).</li>
            </ul>
          </div>

          {trainees.length === 0 ? (
            <p className="empty">لا يوجد متدربون في هذه الأكاديمية.</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {trainees.map((t) => (
                <details key={t.id} className="card" style={{ padding: 14 }}>
                  <summary>
                    <strong>{t.full_name ?? t.email}</strong> · <span className="ltr">{t.email}</span>{' '}
                    <span className="small muted">
                      {nf.format(t.enrollment_count)} تسجيل · {nf.format(t.certificate_count)} شهادة · انضم {dateFmt.format(new Date(t.created_at))}
                    </span>
                  </summary>
                  <div className="stack" style={{ marginTop: 14 }}>
                    <p className="small muted">
                      الجوال: <span className="ltr">{t.phone ?? '—'}</span> · الرقم الوظيفي: <span className="ltr">{t.employee_no ?? '—'}</span>
                    </p>
                    <OwnerForm action={eraseTraineeAction.bind(null, tenantId, t.id)} submitLabel="مسح نهائي لكل البيانات" variant="danger">
                      <label htmlFor={`confirm-${t.id}`}>
                        للتأكيد اكتب بريد المتدرب: <span className="ltr">{t.email}</span>
                        <input id={`confirm-${t.id}`} name="confirm_email" type="email" dir="ltr" required autoComplete="off" placeholder={t.email} />
                      </label>
                    </OwnerForm>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
