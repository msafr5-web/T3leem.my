import Link from 'next/link';

const DEMO_ACADEMIES = [
  { slug: 'alfaisal', name: 'أكاديمية الفيصل', blurb: 'إدارة المشاريع والأمن السيبراني', color: '#0d6b62' },
  { slug: 'gulf', name: 'معهد الخليج', blurb: 'المحاسبة والمالية', color: '#1d4e89' },
];

const FEATURES = [
  { title: 'هوية كل معهد', body: 'نطاق وشعار وألوان خاصة بكل أكاديمية، على منصة واحدة.' },
  { title: 'بيانات معزولة', body: 'قاعدة البيانات نفسها تمنع أي معهد من رؤية بيانات معهد آخر.' },
  { title: 'فوترة ZATCA', body: 'فاتورة ضريبية برمز QR مع كل عملية شراء، وفق متطلبات المرحلة الثانية.' },
  { title: 'بث مباشر ومحتوى محمي', body: 'جلسات Zoom وفيديو مشفّر لا يمكن تنزيله.' },
];

export default function PlatformHome() {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <span className="brand-mark">
            <span className="brand-dot" aria-hidden="true">ت</span>
            T3leem.my
          </span>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <span className="eyebrow">منصة التدريب السحابية</span>
          <h1>أكاديميتك الرقمية بهويتك أنت</h1>
          <p className="lead">
            T3leem.my تتيح لمعاهد التدريب والشركات إطلاق أكاديمية إلكترونية كاملة: دورات مسجلة وبث مباشر، دفع إلكتروني،
            فواتير معتمدة من ZATCA، وشهادات قابلة للتحقق.
          </p>
        </section>

        <section className="stack" aria-labelledby="demo-heading">
          <h2 id="demo-heading">جرّب أكاديمية تجريبية</h2>
          <div className="grid">
            {DEMO_ACADEMIES.map((a) => (
              <Link key={a.slug} href={`/${a.slug}`} className="card card-link" style={{ ['--brand' as string]: a.color }}>
                <span className="brand-mark">
                  <span className="brand-dot" aria-hidden="true">{a.name.charAt(0)}</span>
                  {a.name}
                </span>
                <p className="muted">{a.blurb}</p>
                <span className="small ltr" style={{ textAlign: 'right' }}>t3leem.my/{a.slug}</span>
              </Link>
            ))}
          </div>
          <div className="creds" aria-label="بيانات الدخول التجريبية">
            <span className="muted">البريد</span>
            <span className="ltr">learner@alfaisal.test</span>
            <span className="muted">كلمة المرور</span>
            <span className="ltr">Demo@2026</span>
          </div>
        </section>

        <section className="stack" style={{ marginTop: 48 }} aria-labelledby="features-heading">
          <h2 id="features-heading">ما الذي تقدمه المنصة</h2>
          <div className="features">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature">
                <h3>{f.title}</h3>
                <p className="muted small">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">بيئة تجريبية · لا تتم أي عمليات دفع حقيقية</div>
      </footer>
    </>
  );
}
