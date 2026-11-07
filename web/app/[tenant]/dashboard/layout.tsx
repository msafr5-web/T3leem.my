import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { IxNav, type IxNavGroup } from '../institute/ix-nav';
import '../institute/ix.css';

export const metadata: Metadata = { title: 'لوحة التحكم' };

/** Workspace shell of the academy dashboard: the same sidebar and content frame as the institute workspace. */
export default async function DashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  await requireAdmin(slug);
  const b = `/${slug}/dashboard`;
  const groups: IxNavGroup[] = [
    { name: 'نظرة عامة', items: [{ href: b, label: 'لوحة التحكم', icon: 'overview' }] },
    {
      name: 'التدريب',
      items: [
        { href: `${b}/courses`, label: 'الدورات', icon: 'courses' },
        { href: `${b}/recorded`, label: 'دورات مسجلة', icon: 'video' },
        { href: `${b}/plans`, label: 'الخطط التدريبية والتطويرية', icon: 'plans' },
        { href: `${b}/classrooms`, label: 'الفصول الافتراضية', icon: 'live' },
      ],
    },
    {
      name: 'الأشخاص والشهادات',
      items: [
        { href: `${b}/trainers`, label: 'المدربون', icon: 'people' },
        { href: `${b}/trainees`, label: 'المتدربون', icon: 'people' },
        { href: `${b}/certificates`, label: 'الشهادات الصادرة', icon: 'cert' },
        { href: `${b}/health`, label: 'الشهادات الصحية', icon: 'health' },
      ],
    },
    {
      name: 'المنصة',
      items: [
        { href: `/${slug}/institute`, label: 'إدارة المعهد', icon: 'setup' },
        { href: `${b}/settings`, label: 'الإعدادات والهوية', icon: 'settings' },
      ],
    },
  ];

  return (
    <div className="ix">
      <aside className="ix-side">
        <div className="ix-side-title">
          <strong>لوحة التحكم</strong>
          <span>الدورات والمتدربون والشهادات</span>
        </div>
        <IxNav groups={groups} label="أقسام لوحة التحكم" />
        <div className="ix-side-foot">
          <Link href={`/${slug}`}>عرض موقع الأكاديمية</Link>
        </div>
      </aside>
      <div className="ix-main">{children}</div>
    </div>
  );
}
