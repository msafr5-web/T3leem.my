import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { removeDomainAction, removeLogoAction, setDomainAction, updateBrandingAction, uploadLogoAction, verifyDomainAction } from '@/lib/admin-actions';
import { LogoMark } from '../../../logo-mark';
import { AdminForm } from '../admin-form';
import { DeleteButton } from '../delete-button';

export default async function DashboardSettings({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ saved?: string; welcome?: string }>;
}) {
  const [{ tenant: slug }, { saved, welcome }] = await Promise.all([params, searchParams]);
  const token = await requireAdmin(slug);
  const [b, domain] = await Promise.all([admin.branding(slug, token), admin.domain(slug, token)]);

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 28 }}>الإعدادات والهوية</h1>
        <p className="muted small">
          ما تضبطه هنا يظهر في موقع أكاديميتك <span className="ltr">t3leem.my/{b.slug}</span> وفي دليل مزودي الخدمة.
        </p>
      </div>

      {welcome && (
        <div className="notice ok" role="status">
          <strong>مرحباً بك في T3leem.my!</strong> أكاديميتك جاهزة. الخطوات التالية: ارفع الشعار وأدخل بيانات الفوترة هنا، ثم أضف مدربيك ودوراتك.
        </div>
      )}
      {saved && (
        <p className="notice ok" role="status">
          تم حفظ التغييرات.
        </p>
      )}

      <section className="card stack" aria-labelledby="logo-heading">
        <h2 id="logo-heading" style={{ fontSize: 18 }}>الشعار</h2>
        <div className="person" style={{ alignItems: 'center' }}>
          <LogoMark slug={slug} name={b.name} version={b.logo_version} size={72} />
          <p className="small muted">PNG أو JPEG أو WebP، بحد أقصى ٥١٢ كيلوبايت. يُفضّل شعار مربع بخلفية فاتحة.</p>
        </div>
        <AdminForm action={uploadLogoAction.bind(null, slug)} submitLabel={b.has_logo ? 'استبدال الشعار' : 'رفع الشعار'}>
          <label htmlFor="logo">
            ملف الشعار
            <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required />
          </label>
        </AdminForm>
        {b.has_logo && <DeleteButton action={removeLogoAction.bind(null, slug)} label="إزالة الشعار" confirmText="إزالة شعار الأكاديمية؟" />}
      </section>

      <section className="card stack" aria-labelledby="domain-heading" id="domain">
        <h2 id="domain-heading" style={{ fontSize: 18 }}>النطاق الخاص</h2>
        <p className="small muted">
          اربط نطاقك (مثل <span className="ltr">academy.com.sa</span>) ليفتح موقع أكاديميتك عليه مباشرة. يعمل النطاق بعد إثبات ملكيته عبر سجل DNS.
        </p>
        {!domain.domain ? (
          <AdminForm action={setDomainAction.bind(null, slug)} submitLabel="إضافة النطاق">
            <label htmlFor="domain-input">
              النطاق
              <input id="domain-input" name="domain" type="text" required dir="ltr" placeholder="academy.com.sa" maxLength={253} />
            </label>
          </AdminForm>
        ) : (
          <div className="stack">
            <div className="badges">
              <span className="badge ltr">{domain.domain}</span>
              {domain.verified ? <span className="badge ok">مُفعّل ومُتحقق منه</span> : <span className="badge draft">بانتظار التحقق</span>}
            </div>
            {domain.dns && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>النوع</th>
                      <th>الاسم</th>
                      <th>القيمة</th>
                      <th>الغرض</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>TXT</td>
                      <td className="ltr small">{domain.dns.txt.name}</td>
                      <td className="ltr small" style={{ wordBreak: 'break-all' }}>{domain.dns.txt.value}</td>
                      <td className="small">إثبات الملكية</td>
                    </tr>
                    <tr>
                      <td>CNAME</td>
                      <td className="ltr small">{domain.dns.cname.name}</td>
                      <td className="ltr small">{domain.dns.cname.target}</td>
                      <td className="small">توجيه الزوار إلى المنصة</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div className="row-actions">
              {!domain.verified && <DeleteButton action={verifyDomainAction.bind(null, slug)} label="تحقق الآن" variant="primary" confirmText="هل أضفت سجل TXT في إعدادات DNS لنطاقك؟" />}
              <DeleteButton action={removeDomainAction.bind(null, slug)} label="إزالة النطاق" confirmText={`إزالة النطاق ${domain.domain}؟`} />
            </div>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="identity-heading">
        <h2 id="identity-heading" style={{ fontSize: 18 }}>هوية الأكاديمية وبيانات الفوترة</h2>
        <AdminForm action={updateBrandingAction.bind(null, slug)} submitLabel="حفظ الإعدادات">
          <fieldset className="group">
            <legend>الهوية</legend>
            <div className="form-grid">
              <label htmlFor="name">
                اسم الأكاديمية
                <input id="name" name="name" type="text" required minLength={3} maxLength={120} defaultValue={b.name} />
              </label>
              <label htmlFor="city">
                المدينة
                <input id="city" name="city" type="text" maxLength={60} defaultValue={b.city ?? ''} />
              </label>
              <label htmlFor="tagline" className="full">
                العبارة التعريفية
                <input id="tagline" name="tagline" type="text" maxLength={160} defaultValue={b.tagline ?? ''} placeholder="سطر واحد يظهر تحت اسم الأكاديمية" />
              </label>
              <label htmlFor="about" className="full">
                نبذة عن الأكاديمية
                <textarea id="about" name="about" maxLength={2000} defaultValue={b.about ?? ''} />
              </label>
              <label htmlFor="primary_color">
                اللون الرئيسي
                <input id="primary_color" name="primary_color" type="color" defaultValue={b.primary_color ?? '#0d6b62'} style={{ height: 44, padding: 4 }} />
              </label>
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>بيانات الفوترة الإلكترونية (ZATCA)</legend>
            <p className="small muted">مطلوبة لإصدار الفواتير الضريبية. لا يمكن بيع الدورات قبل إدخال الرقم الضريبي.</p>
            <div className="form-grid">
              <label htmlFor="legal_name">
                الاسم القانوني للمنشأة
                <input id="legal_name" name="legal_name" type="text" maxLength={200} defaultValue={b.legal_name ?? ''} />
              </label>
              <label htmlFor="vat_number">
                الرقم الضريبي
                <input
                  id="vat_number"
                  name="vat_number"
                  type="text"
                  inputMode="numeric"
                  pattern="3[0-9]{13}3"
                  maxLength={15}
                  dir="ltr"
                  defaultValue={b.vat_number ?? ''}
                  placeholder="3XXXXXXXXXXXXX3"
                />
                <span className="hint">١٥ رقماً، يبدأ وينتهي بالرقم ٣.</span>
              </label>
            </div>
          </fieldset>
        </AdminForm>
      </section>
    </>
  );
}
