import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/api';
import { isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { HealthStudy } from './health-study';

export const metadata: Metadata = { title: 'الشهادات الصحية' };

const dateFmt = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long', timeZone: 'Asia/Riyadh' });

export default async function HealthPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/health`)}`);

  const status = await me.health(slug, session.token);

  if (status.access === 'disabled' || status.sectors.length === 0) {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <h1>الشهادات الصحية</h1>
        <div className="card empty">هذا القسم غير متاح حالياً.</div>
      </div>
    );
  }

  if (status.access === 'locked') {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <h1>الشهادات الصحية</h1>
        <div className="card stack">
          <h2>انتهت الفترة التجريبية</h2>
          <p>
            للاستمرار في التدريب على أسئلة الشهادة الصحية
            {status.price ? ` يلزم الاشتراك (${new Intl.NumberFormat('ar-SA').format(status.price)} ريال).` : '.'} تواصل مع الأكاديمية لتفعيل اشتراكك.
          </p>
          <div>
            <Link href={`/${slug}`} className="btn btn-ghost">
              العودة إلى الرئيسية
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const progress = await me.healthProgress(slug, session.token);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>الشهادات الصحية</h1>
        <p className="muted">تدرّب على أسئلة اختبار الشهادة الصحية حسب قطاعك: جلسات عشوائية، وشرح بعد كل إجابة، ومفضلة وسجل تقدّم.</p>
        {status.access === 'trial' && status.trial_ends_at && (
          <div className="notice" role="status">
            فترة تجريبية مجانية حتى {dateFmt.format(new Date(status.trial_ends_at))}
            {status.price ? `، ثم اشتراك ${new Intl.NumberFormat('ar-SA').format(status.price)} ريال.` : '.'}
          </div>
        )}
      </div>
      <HealthStudy slug={slug} sectors={status.sectors} progress={progress} />
    </div>
  );
}
