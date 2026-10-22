import type { Metadata } from 'next';
import Link from 'next/link';
import { JoinForm } from './join-form';

export const metadata: Metadata = { title: 'انضم كمزود خدمة تدريب' };

const INCLUDED = [
  'موقع خاص بأكاديميتك باسمها وشعارها وألوانها',
  'لوحة تحكم للدورات والمدربين والمتدربين',
  'خطط تدريبية وتطويرية وفصول افتراضية',
  'دفع إلكتروني وفواتير ضريبية متوافقة مع ZATCA',
];

export default function JoinPage() {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand-mark">
            <span className="brand-dot" aria-hidden="true">ت</span>
            T3leem.my
          </Link>
        </div>
      </header>
      <main className="container">
        <div className="two-col">
          <section className="stack">
            <span className="eyebrow">للمعاهد والشركات ومراكز التدريب</span>
            <h1>انضم كمزود خدمة تدريب</h1>
            <p className="lead muted">أنشئ أكاديميتك في دقيقة، ثم أكمل هويتك وبيانات الفوترة وأضف مدربيك ودوراتك من لوحة التحكم.</p>
            <div className="card">
              <JoinForm />
            </div>
          </section>
          <aside className="card stack sticky" aria-label="ما تحصل عليه">
            <h2 style={{ fontSize: 18 }}>ما تحصل عليه</h2>
            <ul className="stack small" style={{ margin: 0, paddingInlineStart: 18, gap: 8 }}>
              {INCLUDED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="small muted">بيانات كل أكاديمية معزولة تماماً عن الأكاديميات الأخرى على مستوى قاعدة البيانات.</p>
          </aside>
        </div>
      </main>
    </>
  );
}
