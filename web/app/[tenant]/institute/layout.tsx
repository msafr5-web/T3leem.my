import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { IxNav, type IxNavGroup } from './ix-nav';
import './ix.css';
import { getInstituteMe } from './ix-data';

/**
 * Workspace shell of the institute module: a sidebar with what this person's role may open, and the page on the right.
 * The pages do their own sign-in and permission handling; this only decides which entries to show.
 */
export default async function InstituteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const session = isValidSlug(slug) ? await getSession(slug) : null;
  let finance = false;
  let cost = false;
  let setup = true;
  let signedIn = false;
  if (session) {
    try {
      const me = await getInstituteMe(slug, session.token);
      signedIn = true;
      finance = me.can_read.finance;
      cost = me.can_read.cost;
      setup = true;
    } catch (err) {
      // not allowed or module off: show the page's own message without a sidebar of dead links
      if (!(err instanceof ApiError)) throw err;
    }
  }
  if (!signedIn) return <>{children}</>;

  const base = `/${slug}/institute`;
  const groups: IxNavGroup[] = [
    { name: 'نظرة عامة', items: [{ href: base, label: 'لوحة اليوم', icon: 'overview' }] },
    { name: 'العمل اليومي', items: [{ href: `${base}/academic`, label: 'الطلاب والجدول', icon: 'academic' }, ...(finance ? [{ href: `${base}/finance`, label: 'المالية', icon: 'finance' }] : [])] },
    ...(cost ? [{ name: 'التحليل', items: [{ href: `${base}/cost`, label: 'التكاليف والربحية', icon: 'cost' }] }] : []),
    ...(setup ? [{ name: 'الإعداد', items: [{ href: `${base}/setup`, label: 'الفروع والقاعات والأصول', icon: 'setup' }] }] : []),
  ];

  return (
    <div className="ix">
      <aside className="ix-side">
        <div className="ix-side-title">
          <strong>إدارة المعهد</strong>
          <span>الفروع والطلاب والمال</span>
        </div>
        <IxNav groups={groups} />
        <div className="ix-side-foot">
          <Link href={`/${slug}/dashboard`}>العودة إلى لوحة التحكم</Link>
        </div>
      </aside>
      <div className="ix-main">{children}</div>
    </div>
  );
}
