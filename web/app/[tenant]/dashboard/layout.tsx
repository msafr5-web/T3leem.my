import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin';
import { DashNav } from './dash-nav';

export const metadata: Metadata = { title: 'لوحة التحكم' };

export default async function DashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  await requireAdmin(slug);

  return (
    <div className="dash">
      <DashNav slug={slug} />
      <div className="dash-main">{children}</div>
    </div>
  );
}
