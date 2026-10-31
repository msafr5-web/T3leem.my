import Link from 'next/link';
import { PlatformEmblem, PlatformLogo } from '@/app/brand-mark';
import { getProviders, type Provider } from '@/lib/api';
import { safeBrandColor } from '@/lib/format';
import { SUPPORT_PHONE, WELCOME_MESSAGE, supportLink } from '@/lib/support';
import { LogoMark } from './logo-mark';

// Directory refreshes every minute; the rest of the page is static.
export const revalidate = 60;

/** Shown if the API is unreachable, so the home page never breaks. */
const FALLBACK_PROVIDERS: Provider[] = [
  { slug: 'rukn', name: 'أكاديمية ركن', tagline: 'تدريب احترافي معتمد في الإدارة والتقنية', city: 'الرياض', primary_color: '#0d6b62', logo_version: null, health_sectors: 0 },
  { slug: 'masar', name: 'المسار للتدريب المالي', tagline: 'برامج المحاسبة والمالية للمهنيين', city: 'جدة', primary_color: '#1d4e89', logo_version: null, health_sectors: 0 },
];

const STEPS = [
  { title: 'أنشئ أكاديميتك', body: 'سجّل بريدك وجوالك، ويصلك رمز تحقق، وتعتمد الإدارة اشتراكك بباقتك ومدتك.' },
  { title: 'أضف مدربيك ودوراتك', body: 'لكل دورة: المدرب، عدد الساعات، المدة، رقم الترخيص وجهته، ورقم الاعتماد.' },
  { title: 'ابنِ خططك', body: 'اجمع الدورات في خطط تدريبية أو تطويرية بفترة زمنية وإجمالي ساعات واضح.' },
  { title: 'استقبل المتدربين', body: 'فصول افتراضية مباشرة، تسجيل ودفع إلكتروني، وفاتورة ضريبية تلقائية.' },
];

type IconName = 'dashboard' | 'users' | 'badge' | 'calendar' | 'plan' | 'receipt' | 'shield' | 'key';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'dashboard', title: 'لوحة تحكم لكل مزود', body: 'مؤشرات الدورات والمتدربين والإيرادات والجلسات القادمة في شاشة واحدة.' },
  { icon: 'users', title: 'سجل المدربين', body: 'أضف مدربيك بتخصصاتهم ونبذة عنهم، حتى قبل أن يكون لهم حساب دخول.' },
  { icon: 'badge', title: 'الترخيص والاعتماد', body: 'رقم الترخيص وجهته وتاريخ انتهائه، ورقم الاعتماد وعدد الساعات لكل دورة.' },
  { icon: 'plan', title: 'خطط تدريبية وتطويرية', body: 'مسارات منظمة من عدة دورات، بحالة مسودة أو نشطة، تظهر للمتدربين عند تفعيلها.' },
  { icon: 'calendar', title: 'فصول افتراضية خاصة', body: 'جدولة جلسات Zoom أو Teams بالموعد والسعة والمدرب، وروابط لا تظهر للعامة.' },
  { icon: 'receipt', title: 'دفع وفوترة ZATCA', body: 'مدى وApple Pay وSTC Pay، مع فاتورة ضريبية برمز QR لكل عملية شراء.' },
  { icon: 'shield', title: 'عزل كامل للبيانات', body: 'بيانات كل مزود معزولة على مستوى قاعدة البيانات نفسها عن بقية المزودين.' },
  { icon: 'key', title: 'دخول آمن برمز', body: 'لا كلمات مرور تُسرق: رمز من ٦ أرقام يصل إلى بريد المستخدم في كل دخول.' },
];

const FAQ = [
  {
    q: 'هل يرى مزود خدمة بيانات مزود آخر؟',
    a: 'لا. كل مزود معزول على مستوى قاعدة البيانات نفسها، فلا يمكن لأي استعلام أن يرجع بيانات جهة أخرى حتى لو حدث خطأ في التطبيق.',
  },
  {
    q: 'كيف أدخل إلى حسابي؟',
    a: 'اكتب بريدك الإلكتروني في صفحة الدخول فيصلك رمز من ٦ أرقام صالح ١٠ دقائق. لا توجد كلمة مرور، والدخول بالطريقة نفسها للمالك والمدرب والمتدرب.',
  },
  {
    q: 'هل أحتاج حساباً لكل مدرب؟',
    a: 'لا. يمكنك إضافة المدرب باسمه وتخصصه وربطه بالدورات والفصول، ثم دعوته لاحقاً لحساب دخول إن أردت.',
  },
  {
    q: 'متى تُفعَّل أكاديميتي بعد التسجيل؟',
    a: 'بعد تأكيد بريدك يصل طلبك إلى إدارة المنصة، وتعتمده بتحديد الباقة ومدة الاشتراك، وتصلك رسالة على بريدك فور الاعتماد.',
  },
  {
    q: 'هل الفواتير متوافقة مع هيئة الزكاة والضريبة والجمارك؟',
    a: 'تصدر فاتورة ضريبية مبسطة برمز QR وفق متطلبات ZATCA مع كل عملية شراء، والأسعار تُعرض شاملة ضريبة القيمة المضافة.',
  },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" />,
    users: <path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13Zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.700-3.500-7-3.500Z" />,
    badge: <path d="M12 2 4 5v6c0 5 3.400 9.300 8 11 4.600-1.700 8-6 8-11V5l-8-3Zm-1.200 14L7 12.200l1.400-1.400 2.400 2.400 4.800-4.800L17 9.800 10.800 16Z" />,
    calendar: <path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm-2 8h14v10H5V10Zm2 2v2h4v-2H7Z" />,
    plan: <path d="M4 5h16v3H4V5Zm0 5.500h10v3H4v-3ZM4 16h16v3H4v-3Z" />,
    receipt: <path d="M6 2h12a1 1 0 0 1 1 1v19l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1Zm2 5v2h8V7H8Zm0 4v2h8v-2H8Z" />,
    shield: <path d="M12 2 4 5v6c0 5 3.400 9.300 8 11 4.600-1.700 8-6 8-11V5l-8-3Zm0 4a3 3 0 0 1 3 3v1h1v6H8v-6h1V9a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v1h2V9a1 1 0 0 0-1-1Z" />,
    key: <path d="M7 14a5 5 0 1 1 4.900-6H22v4h-2v3h-3v-3h-5.100A5 5 0 0 1 7 14Zm0-7a2 2 0 1 0 2 2 2 2 0 0 0-2-2Z" />,
  };
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

async function loadProviders(): Promise<Provider[]> {
  try {
    const providers = await getProviders();
    return providers.length ? providers : FALLBACK_PROVIDERS;
  } catch {
    return FALLBACK_PROVIDERS;
  }
}

const nf = new Intl.NumberFormat('ar-SA');

export default async function PlatformHome() {
  const providers = await loadProviders();
  const healthProviders = providers.filter((p) => p.health_sectors > 0);
  const healthSectors = healthProviders.reduce((n, p) => n + p.health_sectors, 0);

  return (
    <div className="hm">
      <header className="hm-header">
        <div className="container hm-header-in">
          <Link href="/" className="brand-mark">
            <PlatformEmblem />
            <span className="ltr">T3leem.my</span>
          </Link>
          <nav className="hm-nav" aria-label="أقسام الصفحة">
            <a href="#providers">مزودو الخدمة</a>
            {healthProviders.length > 0 && <a href="#health">الشهادات الصحية</a>}
            <a href="#how">كيف تعمل</a>
            <a href="#features">المزايا</a>
            <a href="#faq">الأسئلة الشائعة</a>
            <a href={supportLink(WELCOME_MESSAGE)} target="_blank" rel="noopener noreferrer">الدعم</a>
          </nav>
          <div className="hm-header-cta">
            <Link href="/rukn/login" className="btn btn-ghost">دخول</Link>
            <Link href="/join" className="btn btn-primary">انضم كمزود خدمة</Link>
          </div>
        </div>
      </header>

      <section className="hm-hero">
        <div className="hm-pixels" aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </div>
        <div className="container hm-hero-in">
          <div className="hm-hero-text">
            <span className="hm-eyebrow">منصة سحابية لمقدمي خدمات التدريب</span>
            <h1>
              أكاديمية رقمية <span className="hm-accent">كاملة</span> لكل جهة تدريب
            </h1>
            <p className="hm-lead">
              تمنح T3leem.my كل مزود خدمة تدريب موقعاً خاصاً بهويته: دورات مرخصة بساعاتها وأرقام اعتمادها، وخطط تدريبية، وفصول افتراضية، ودفع وفوترة ضريبية، من لوحة تحكم واحدة.
            </p>
            <div className="cta-row">
              <Link href="/join" className="btn btn-primary hm-btn-lg">أنشئ أكاديميتك الآن</Link>
              <a href="#providers" className="btn btn-ghost hm-btn-lg">تصفح مزودي الخدمة</a>
            </div>
            <ul className="hm-trust" aria-label="مزايا المنصة">
              <li>عزل كامل للبيانات</li>
              <li>فواتير متوافقة مع ZATCA</li>
              <li>دخول آمن برمز OTP</li>
            </ul>
          </div>
          <div className="hm-hero-art">
            <div className="hm-logo-card">
              <PlatformLogo width={420} />
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <div className="hm-stats" role="group" aria-label="أرقام المنصة">
          <div><strong>{nf.format(providers.length)}</strong><span>أكاديمية على المنصة</span></div>
          <div><strong>{nf.format(healthSectors || 6)}</strong><span>قطاعات للشهادات الصحية</span></div>
          <div><strong>٦ أرقام</strong><span>رمز الدخول إلى بريدك</span></div>
          <div><strong>١٥٪</strong><span>ضريبة القيمة المضافة في كل فاتورة</span></div>
        </div>
      </div>

      {healthProviders.length > 0 && (
        <section id="health" className="hm-section" aria-labelledby="health-heading">
          <div className="container">
            <div className="hm-health">
              <div className="hm-health-text">
                <span className="hm-eyebrow hm-eyebrow-light">جديد</span>
                <h2 id="health-heading">الشهادات الصحية</h2>
                <p>
                  تدرّب على أسئلة اختبار الشهادة الصحية حسب قطاعك: الأغذية والمطاعم، الحلاقة والتجميل، الخدمات والمغاسل، الفنادق، النوادي والترفيه، ومكافحة الآفات. اختبارات عشوائية بدرجات وسجل محاولات.
                </p>
                <ul>
                  <li>أسئلة كل قطاع منفصلة وبترتيب عشوائي</li>
                  <li>شرح لكل إجابة بعد التسليم</li>
                  <li>تأكيد الهوية برمز يصل إلى بريدك قبل كل اختبار</li>
                </ul>
              </div>
              <div className="hm-health-cards">
                {healthProviders.map((p) => (
                  <Link key={p.slug} href={`/${p.slug}/health`} className="hm-health-card">
                    <span className="brand-mark">
                      <LogoMark slug={p.slug} name={p.name} version={p.logo_version} size={40} />
                      {p.name}
                    </span>
                    <span className="small">{nf.format(p.health_sectors)} قطاعات · ابدأ التدريب ←</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section id="providers" className="hm-section" aria-labelledby="providers-heading">
        <div className="container">
          <div className="hm-head">
            <h2 id="providers-heading">مزودو الخدمة على المنصة</h2>
            <p className="muted">لكل مزود موقعه ودوراته ومدربوه وخططه. اختر جهة لتصفح برامجها.</p>
          </div>
          <div className="hm-grid">
            {providers.map((p) => {
              const color = safeBrandColor(p.primary_color);
              return (
                <Link
                  key={p.slug}
                  href={`/${p.slug}`}
                  className="hm-provider"
                  style={color ? ({ ['--brand' as string]: p.primary_color } as React.CSSProperties) : undefined}
                >
                  <span className="hm-provider-bar" aria-hidden="true" />
                  <span className="brand-mark">
                    <LogoMark slug={p.slug} name={p.name} version={p.logo_version} size={44} />
                    {p.name}
                  </span>
                  {p.tagline && <p className="muted">{p.tagline}</p>}
                  <div className="badges">
                    {p.city && <span className="badge">{p.city}</span>}
                    {p.health_sectors > 0 && <span className="badge ok">شهادات صحية</span>}
                    <span className="badge ltr">t3leem.my/{p.slug}</span>
                  </div>
                  <span className="hm-more">زيارة الأكاديمية ←</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section id="how" className="hm-section hm-band" aria-labelledby="how-heading">
        <div className="container">
          <div className="hm-head">
            <h2 id="how-heading">كيف يعمل مزود الخدمة على المنصة</h2>
            <p className="muted">من إنشاء الحساب إلى أول متدرب في أربع خطوات.</p>
          </div>
          <ol className="hm-steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="features" className="hm-section" aria-labelledby="features-heading">
        <div className="container">
          <div className="hm-head">
            <h2 id="features-heading">ما يحصل عليه كل مزود</h2>
            <p className="muted">كل ما تحتاجه جهة التدريب لإدارة برامجها وبيعها وتوثيقها.</p>
          </div>
          <div className="hm-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="hm-feature">
                <span className="hm-icon"><Icon name={f.icon} /></span>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="hm-section" aria-labelledby="faq-heading">
        <div className="container hm-faq-wrap">
          <div className="hm-head">
            <h2 id="faq-heading">الأسئلة الشائعة</h2>
            <p className="muted">إجابات سريعة عن أكثر ما يُسأل عنه.</p>
          </div>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="hm-cta" aria-labelledby="cta-heading">
        <div className="container hm-cta-in">
          <div>
            <h2 id="cta-heading">ابدأ أكاديميتك اليوم</h2>
            <p>سجّل بياناتك وأكّد بريدك، ونراجع طلبك ونفعّل اشتراكك. أي استفسار؟ نحن على واتساب.</p>
          </div>
          <div className="cta-row">
            <Link href="/join" className="btn hm-btn-white hm-btn-lg">انضم كمزود خدمة</Link>
            <a href={supportLink(WELCOME_MESSAGE)} target="_blank" rel="noopener noreferrer" className="btn hm-btn-outline hm-btn-lg">راسلنا على واتساب</a>
          </div>
        </div>
      </section>

      <footer className="hm-footer">
        <div className="container hm-footer-in">
          <div className="hm-footer-brand">
            <span className="brand-mark">
              <PlatformEmblem size={44} />
              <span className="ltr">T3leem.my</span>
            </span>
            <p className="muted small">منصة سحابية لإطلاق أكاديميات التدريب الرقمية بهوية كل معهد.</p>
          </div>
          <nav aria-label="روابط">
            <h3>روابط</h3>
            <a href="#providers">مزودو الخدمة</a>
            <a href="#how">كيف تعمل</a>
            <a href="#faq">الأسئلة الشائعة</a>
            <Link href="/join">انضم كمزود خدمة</Link>
          </nav>
          <div>
            <h3>الدعم والاستفسار</h3>
            <a href={supportLink(WELCOME_MESSAGE)} target="_blank" rel="noopener noreferrer">
              واتساب <span dir="ltr">{SUPPORT_PHONE}</span>
            </a>
            <Link href="/owner">دخول إدارة المنصة</Link>
          </div>
        </div>
        <div className="container hm-copy">© {new Date().getFullYear()} T3leem.my · جميع الحقوق محفوظة</div>
      </footer>
    </div>
  );
}
