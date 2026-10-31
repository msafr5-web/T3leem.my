import type { Metadata } from 'next';
import Link from 'next/link';
import { ApiError, owner, type OwnerFeatures, type OwnerPlan, type OwnerTenant } from '@/lib/api';
import {
  approveTenantAction,
  createPlanAction,
  deletePlanAction,
  extendTenantAction,
  ownerLogoutAction,
  setTenantStatusAction,
  updatePlanAction,
  updateTenantAction,
} from '@/lib/owner-actions';
import { getOwnerSession } from '@/lib/owner-session';
import { SUPPORT_PHONE, WELCOME_MESSAGE, supportLink, waLink } from '@/lib/support';
import { OwnerConfirm, OwnerForm, OwnerLogin } from './owner-forms';

export const metadata: Metadata = { title: 'لوحة إدارة المنصة', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const nf = new Intl.NumberFormat('ar-SA');
const dateFmt = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long', timeZone: 'Asia/Riyadh' });
const STATUS: Record<OwnerTenant['status'], string> = { PROVISIONING: 'بانتظار الاعتماد', ACTIVE: 'فعّالة', SUSPENDED: 'موقوفة' };
const FEATURE_LABEL: Record<keyof OwnerFeatures, string> = { health: 'الشهادات الصحية', recorded: 'الدورات المسجلة والاختبارات' };

/** The datetime-free date input value (Saudi calendar day) of an ISO instant. */
const dayInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 10) : '');

/** The first WhatsApp message to a subscriber: the welcome line plus their subscription details. */
function subscriberMessage(t: OwnerTenant, base: string): string {
  const site = `${base}/${t.slug}`;
  const until = t.subscription_ends_at ? dateFmt.format(new Date(t.subscription_ends_at)) : 'بلا تاريخ انتهاء';
  const lines = [`${WELCOME_MESSAGE} 🌟`, `أكاديمية «${t.name}»`];
  if (t.status === 'ACTIVE') lines.push(`تم اعتماد اشتراكك. الباقة: ${t.plan_name ?? 'الأساسية'}، والاشتراك حتى: ${until}.`, `الموقع: ${site}`, `لوحة التحكم: ${site}/dashboard`, 'للدخول اكتب بريدك فيصلك رمز من ٦ أرقام.');
  else lines.push('استلمنا طلب اشتراكك وسنعتمده قريباً وتصلك التفاصيل هنا وعلى بريدك.');
  lines.push(`للدعم والاستفسار: ${SUPPORT_PHONE}`);
  return lines.join('\n');
}

function Features({ t, plans }: { t?: OwnerTenant; plans: OwnerPlan[] }) {
  return (
    <>
      <label>
        الباقة
        <select name="plan_id" defaultValue={t?.plan_id ?? ''}>
          <option value="">بلا باقة محددة</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {nf.format(p.max_students)} متدرب · {nf.format(p.monthly_price)} ريال/شهر
            </option>
          ))}
        </select>
      </label>
      <fieldset className="group" style={{ padding: 10 }}>
        <legend className="small">الصلاحيات (الوحدات المتاحة للأكاديمية)</legend>
        {(Object.keys(FEATURE_LABEL) as (keyof OwnerFeatures)[]).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" name={`f_${k}`} defaultChecked={t ? t.features[k] : true} />
            {FEATURE_LABEL[k]}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export default async function OwnerPage() {
  const session = await getOwnerSession();

  const shell = (children: React.ReactNode) => (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand-mark">
            <span className="brand-dot" aria-hidden="true">ت</span>
            T3leem.my · الإدارة
          </Link>
          {session && (
            <div className="header-actions">
              <span className="small muted ltr">{session.email}</span>
              <form action={ownerLogoutAction}>
                <button type="submit" className="btn btn-ghost">
                  تسجيل الخروج
                </button>
              </form>
            </div>
          )}
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );

  if (!session) {
    return shell(
      <div className="narrow stack">
        <h1>لوحة إدارة المنصة</h1>
        <p className="muted">للمالك فقط: ادخل بالبريد الرسمي ورمز الدخول.</p>
        <div className="card">
          <OwnerLogin />
        </div>
      </div>,
    );
  }

  let data: Awaited<ReturnType<typeof owner.overview>>;
  let plans: OwnerPlan[];
  try {
    [data, plans] = await Promise.all([owner.overview(session.token), owner.plans(session.token)]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return shell(
        <div className="narrow stack">
          <h1>انتهت الجلسة</h1>
          <form action={ownerLogoutAction}>
            <button type="submit" className="btn btn-primary">
              تسجيل الدخول من جديد
            </button>
          </form>
        </div>,
      );
    }
    throw err;
  }

  const base = (process.env.PUBLIC_WEB_URL ?? 'https://t3leem.my').replace(/\/$/, '');
  const pending = data.tenants.filter((t) => t.status === 'PROVISIONING');
  const others = data.tenants.filter((t) => t.status !== 'PROVISIONING');
  const now = Date.now();

  return shell(
    <div className="stack" style={{ gap: 28 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>لوحة إدارة المنصة</h1>
          <p className="muted">الأكاديميات والاشتراكات والباقات والصلاحيات.</p>
        </div>
        <a className="btn btn-ghost" href={supportLink()} target="_blank" rel="noopener noreferrer">
          واتساب الدعم <span dir="ltr">{SUPPORT_PHONE}</span>
        </a>
      </div>

      <div className="hl-stats" role="group" aria-label="ملخص">
        <div><strong>{nf.format(data.total)}</strong><span>أكاديمية</span></div>
        <div><strong>{nf.format(data.pending)}</strong><span>بانتظار الاعتماد</span></div>
        <div><strong>{nf.format(data.active)}</strong><span>فعّالة</span></div>
        <div><strong>{nf.format(data.expired)}</strong><span>انتهى اشتراكها</span></div>
        <div><strong>{nf.format(data.suspended)}</strong><span>موقوفة</span></div>
      </div>

      <section className="stack" aria-labelledby="pending-h">
        <h2 id="pending-h">طلبات بانتظار الاعتماد ({nf.format(pending.length)})</h2>
        {pending.length === 0 && <div className="card empty">لا توجد طلبات جديدة.</div>}
        {pending.map((t) => (
          <article key={t.id} className="card stack">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3>{t.name}</h3>
                <p className="small muted">
                  <span dir="ltr">t3leem.my/{t.slug}</span> · {dateFmt.format(new Date(t.created_at))}
                </p>
                <p className="small">
                  {t.owner_name} · <span dir="ltr">{t.owner_email}</span> · <span dir="ltr">{t.owner_phone ?? 'بلا جوال'}</span>
                </p>
              </div>
              {t.owner_phone && (
                <a className="btn btn-ghost" href={waLink(t.owner_phone, subscriberMessage(t, base))} target="_blank" rel="noopener noreferrer">
                  رسالة ترحيب على واتساب
                </a>
              )}
            </div>
            <OwnerForm action={approveTenantAction.bind(null, t.id)} submitLabel="اعتماد الاشتراك">
              <Features t={t} plans={plans} />
              <label>
                مدة الاشتراك (شهور) <span className="hint">(٠ = بلا تاريخ انتهاء)</span>
                <input type="number" name="months" min={0} max={120} defaultValue={12} required />
              </label>
            </OwnerForm>
          </article>
        ))}
      </section>

      <section className="stack" aria-labelledby="all-h">
        <h2 id="all-h">الأكاديميات ({nf.format(others.length)})</h2>
        {others.map((t) => {
          const expired = t.status === 'ACTIVE' && t.subscription_ends_at !== null && new Date(t.subscription_ends_at).getTime() < now;
          return (
            <details key={t.id} className="card" style={{ padding: 14 }}>
              <summary>
                <strong>{t.name}</strong> · <span dir="ltr">{t.slug}</span> ·{' '}
                <span className={`badge${t.status === 'ACTIVE' && !expired ? ' ok' : ''}`}>{expired ? 'انتهى الاشتراك' : STATUS[t.status]}</span>{' '}
                <span className="small muted">
                  {t.plan_name ?? 'بلا باقة'} · {t.subscription_ends_at ? `حتى ${dateFmt.format(new Date(t.subscription_ends_at))}` : 'بلا تاريخ انتهاء'}
                </span>
              </summary>
              <div className="stack" style={{ marginTop: 14 }}>
                <p className="small">
                  {t.owner_name} · <span dir="ltr">{t.owner_email}</span> · <span dir="ltr">{t.owner_phone ?? 'بلا جوال'}</span>
                </p>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <a className="btn btn-ghost" href={`/${t.slug}`} target="_blank" rel="noopener noreferrer">
                    فتح الموقع
                  </a>
                  {t.owner_phone && (
                    <a className="btn btn-ghost" href={waLink(t.owner_phone, subscriberMessage(t, base))} target="_blank" rel="noopener noreferrer">
                      إرسال بيانات الاشتراك على واتساب
                    </a>
                  )}
                  {t.status === 'ACTIVE' ? (
                    <OwnerConfirm action={setTenantStatusAction.bind(null, t.id, 'SUSPENDED')} label="إيقاف الأكاديمية" confirmText={`إيقاف «${t.name}»؟ سيتوقف دخول مستخدميها فوراً.`} />
                  ) : (
                    <OwnerConfirm action={setTenantStatusAction.bind(null, t.id, 'ACTIVE')} label="تفعيل الأكاديمية" confirmText={`تفعيل «${t.name}»؟`} variant="primary" />
                  )}
                </div>
                <OwnerForm action={extendTenantAction.bind(null, t.id)} submitLabel="تمديد الاشتراك" className="row" variant="ghost">
                  <input type="number" name="months" min={1} max={120} defaultValue={12} aria-label="عدد شهور التمديد" style={{ maxWidth: 110 }} required />
                  <span className="small muted">شهراً من نهاية الاشتراك الحالي (أو من اليوم إن كان منتهياً)</span>
                </OwnerForm>
                <OwnerForm action={updateTenantAction.bind(null, t.id)} submitLabel="حفظ الباقة والصلاحيات">
                  <Features t={t} plans={plans} />
                  <label>
                    نهاية الاشتراك <span className="hint">(اتركه فارغاً لبلا تاريخ انتهاء)</span>
                    <input type="date" name="ends_at" defaultValue={dayInput(t.subscription_ends_at)} />
                  </label>
                </OwnerForm>
              </div>
            </details>
          );
        })}
      </section>

      <section className="stack" aria-labelledby="plans-h">
        <h2 id="plans-h">الباقات</h2>
        {plans.map((p) => (
          <details key={p.id} className="card" style={{ padding: 14 }}>
            <summary>
              <strong>{p.name}</strong> · {nf.format(p.max_students)} متدرب · {nf.format(p.max_storage_gb)} جيجابايت · {nf.format(p.monthly_price)} ريال/شهر · <span className="small muted">{nf.format(p.tenant_count)} أكاديمية</span>
            </summary>
            <div className="stack" style={{ marginTop: 14 }}>
              <OwnerForm action={updatePlanAction.bind(null, p.id)} submitLabel="حفظ الباقة">
                <PlanFields p={p} />
              </OwnerForm>
              <OwnerConfirm action={deletePlanAction.bind(null, p.id)} label="حذف الباقة" confirmText={`حذف باقة «${p.name}»؟`} />
            </div>
          </details>
        ))}
        <details className="card" style={{ padding: 14 }}>
          <summary>
            <strong>إضافة باقة جديدة</strong>
          </summary>
          <div style={{ marginTop: 14 }}>
            <OwnerForm action={createPlanAction} submitLabel="إضافة الباقة">
              <PlanFields />
            </OwnerForm>
          </div>
        </details>
      </section>
    </div>,
  );
}

function PlanFields({ p }: { p?: OwnerPlan }) {
  return (
    <>
      <label>
        اسم الباقة
        <input type="text" name="name" defaultValue={p?.name} required minLength={2} maxLength={60} />
      </label>
      <label>
        الحد الأقصى للمتدربين
        <input type="number" name="max_students" defaultValue={p?.max_students ?? 100} min={1} required />
      </label>
      <label>
        مساحة التخزين (جيجابايت)
        <input type="number" name="max_storage_gb" defaultValue={p?.max_storage_gb ?? 10} min={1} required />
      </label>
      <label>
        السعر الشهري (ريال)
        <input type="number" name="monthly_price" defaultValue={p?.monthly_price ?? 0} min={0} step="0.01" required />
      </label>
    </>
  );
}
