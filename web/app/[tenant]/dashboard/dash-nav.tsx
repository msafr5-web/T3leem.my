'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '', label: 'نظرة عامة' },
  { href: '/courses', label: 'الدورات' },
  { href: '/plans', label: 'الخطط التدريبية والتطويرية' },
  { href: '/trainers', label: 'المدربون' },
  { href: '/trainees', label: 'المتدربون' },
  { href: '/classrooms', label: 'الفصول الافتراضية' },
  { href: '/settings', label: 'الإعدادات والهوية' },
];

export function DashNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}/dashboard`;

  return (
    <nav className="dash-nav" aria-label="أقسام لوحة التحكم">
      {ITEMS.map((item) => {
        const href = `${base}${item.href}`;
        const active = item.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
