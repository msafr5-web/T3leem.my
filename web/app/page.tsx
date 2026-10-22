import Link from 'next/link';
import { getProviders, type Provider } from '@/lib/api';
import { safeBrandColor } from '@/lib/format';

// Directory refreshes every minute; the rest of the page is static.
export const revalidate = 60;

/** Shown if the API is unreachable, so the home page never breaks. */
const FALLBACK_PROVIDERS: Provider[] = [
  { slug: 'alfaisal', name: 'أكاديمية الفيصل', tagline: 'تدريب احترافي معتمد في الإدارة والتقنية', city: 'الرياض', primary_color: '#0d6b62' },
  { slug: 'gulf', name: 'معهد الخليج', tagline: 'برامج المحاسبة والمالية للمهنيين', city: 'جدة', primary_color: '#1d4e89' },
];

const STEPS = [
  { title: 'أنشئ أكاديميتك', body: 'حساب خاص بجهتك باسمها وشعارها وألوانها، ورابط مستقل لموقعها.' },
  { title: 'أضف مدربيك ودوراتك', body: 'لكل دورة: المدرب، عدد الساعات، المدة، رقم الترخيص وجهته، ورقم الاعتماد.' },
  { title: 'ابنِ خططك', body: 'اجمع الدورات في خطط تدريبية أو تطويرية بفترة زمنية وإجمالي ساعات واضح.' },
  { title: 'جدول واستقبل المتدربين', body: 'فصول افتراضية مباشرة، تسجيل ودفع إلكتروني، وفاتورة ضريبية تلقائية.' },
];

const FEATURES = [
  { title: 'لوحة تحكم لكل مزود', body: 'مؤشرات الدورات والمتدربين والإيرادات والجلسات القادمة في شاشة واحدة.' },
  { title: 'سجل المدربين', body: 'أضف مدربيك بتخصصاتهم ونبذة عنهم، حتى قبل أن يكون لهم حساب دخول.' },
  { title: 'بيانات الترخيص والاعتماد', body: 'رقم الترخيص وجهته وتاريخ انتهائه، ورقم الاعتماد وعدد الساعات لكل دورة.' },
  { title: 'خطط تدريبية وتطويرية', body: 'مسارات منظمة من عدة دورات، بحالة مسودة أو نشطة، تظهر للمتدربين عند تفعيلها.' },
  { title: 'فصول افتراضية خاصة', body: 'جدولة جلسات Zoom أو Teams بالموعد والسعة والمدرب، وروابط لا تظهر للعامة.' },
  { title: 'دفع وفوترة ZATCA', body: 'مدى وApple Pay وSTC Pay، مع فاتورة ضريبية برمز QR لكل عملية شراء.' },
];

const FAQ = [
  {
    q: 'هل يرى مزود خدمة بيانات مزود آخر؟',
    a: 'لا. كل مزود معزول على مستوى قاعدة البيانات نفسها، فلا يمكن لأي استعلام أن يرجع بيانات جهة أخرى حتى لو حدث خطأ في التطبيق.',
  },
  {
    q: 'هل أحتاج حساباً لكل مدرب؟',
    a: 'لا. يمكنك إضافة المدرب باسمه وتخصصه وربطه بالدورات والفصول، ثم دعوته لاحقاً لحساب دخول إن أردت.',
  },
  {
    q: 'كيف تُعرض بيانات الترخيص للمتدربين؟',
    a: 'تظهر في صفحة كل دورة: رقم الترخيص وجهته وتاريخ انتهائه، ورقم الاعتماد، وعدد الساعات والمدة.',
  },
  {
    q: 'هل الفواتير متوافقة مع هيئة الزكاة والضريبة والجمارك؟',
    a: 'تصدر فاتورة ضريبية مبسطة برمز QR وفق متطلبات ZATCA مع كل عملية شراء، والأسعار تُعرض شاملة ضريبة القيمة المضافة.',
  },
];

async function loadProviders(): Promise<Provider[]> {
  try {
    const providers = await getProviders();
    return providers.length ? providers : FALLBACK_PROVIDERS;
  } catch {
    return FALLBACK_PROVIDERS;
  }
}

export default async function PlatformHome() {
  const providers = await loadProviders();

  return (
    <>
      <header className="site-header">
        <div className="container">
          <span className="brand-mark">
            <span className="brand-dot" aria-hidden="true">ت</span>
            T3leem.my
          </span>
          <nav className="header-actions small" aria-label="أقسام الصفحة">
            <a href="#providers">مزودو الخدمة</a>
            <a href="#how">كيف تعمل</a>
            <a href="#features">المزايا</a>
            <a href="#faq">الأسئلة الشائعة</a>
          </nav>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <span className="eyebrow">منصة سحابية لمقدمي خدمات التدريب</span>
          <h1>أكاديمية رقمية كاملة لكل جهة تدريب</h1>
          <p className="lead">
            T3leem.my تمنح كل مزود خدمة تدريب حساباً خاصاً بهويته: يضيف مدربيه ودوراته المرخصة بساعاتها وأرقام اعتمادها، ويبني خططه
            التدريبية والتطويرية، ويدير متدربيه وفصوله الافتراضية من لوحة تحكم واحدة.
          </p>
          <div className="cta-row">
            <a href="#providers" className="btn btn-primary">تصفح مزودي الخدمة</a>
            <a href="#how" className="btn btn-ghost">كيف تعمل المنصة</a>
          </div>
        </section>

        <section id="providers" className="section" aria-labelledby="providers-heading">
          <div className="section-head">
            <div className="stack" style={{ gap: 6 }}>
              <h2 id="providers-heading">مزودو الخدمة على المنصة</h2>
              <p className="muted">لكل مزود موقعه ودوراته ومدربوه وخططه. اختر جهة لتصفح برامجها.</p>
            </div>
          </div>
          <div className="grid">
            {providers.map((p) => (
              <Link
                key={p.slug}
                href={`/${p.slug}`}
                className="card card-link"
                style={safeBrandColor(p.primary_color) ? ({ ['--brand' as string]: p.primary_color } as React.CSSProperties) : undefined}
              >
                <span className="brand-mark">
                  <span className="brand-dot" aria-hidden="true">{p.name.charAt(0)}</span>
                  {p.name}
                </span>
                {p.tagline && <p className="muted">{p.tagline}</p>}
                <div className="badges">
                  {p.city && <span className="badge">{p.city}</span>}
                  <span className="badge ltr">t3leem.my/{p.slug}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section id="how" className="section" aria-labelledby="how-heading">
          <div className="stack" style={{ gap: 6 }}>
            <h2 id="how-heading">كيف يعمل مزود الخدمة على المنصة</h2>
            <p className="muted">من إنشاء الحساب إلى أول متدرب في أربع خطوات.</p>
          </div>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p className="muted small">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="section" aria-labelledby="features-heading">
          <h2 id="features-heading">ما يحصل عليه كل مزود</h2>
          <div className="features">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature">
                <h3>{f.title}</h3>
                <p className="muted small">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="trainees-heading">
          <div className="two-col even">
            <div className="stack">
              <h2 id="trainees-heading">وللمتدربين</h2>
              <p className="muted">
                يتصفح المتدرب دورات كل جهة مع بيانات ترخيصها واعتمادها وعدد ساعاتها، ويشتري بأمان، ويحصل على فاتورة ضريبية فورية، ويحضر
                الفصول الافتراضية في مواعيدها.
              </p>
            </div>
            <div className="card stack" style={{ gap: 10 }}>
              <h3>جرّب المنصة بحسابات تجريبية</h3>
              <div className="creds" style={{ display: 'grid' }}>
                <span className="muted">لوحة تحكم المزود</span>
                <span className="ltr">admin@alfaisal.test</span>
                <span className="muted">متدرب</span>
                <span className="ltr">student@alfaisal.test</span>
                <span className="muted">كلمة المرور</span>
                <span className="ltr">Demo@2026</span>
              </div>
              <Link href="/alfaisal/login" className="btn btn-primary">الدخول إلى أكاديمية الفيصل</Link>
            </div>
          </div>
        </section>

        <section id="faq" className="section" aria-labelledby="faq-heading">
          <h2 id="faq-heading">الأسئلة الشائعة</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>T3leem.my · منصة التدريب السحابية</span>
          <span>بيئة تجريبية · لا تتم أي عمليات دفع حقيقية</span>
        </div>
      </footer>
    </>
  );
}
