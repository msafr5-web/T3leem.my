'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PATHS: Record<string, string> = {
  overview: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  academic: 'M3 9l9-5 9 5-9 5-9-5z M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5',
  finance: 'M3 7h15a3 3 0 013 3v7a3 3 0 01-3 3H6a3 3 0 01-3-3V7z M3 7l3-3h11 M16 14h2',
  cost: 'M5 20V10 M12 20V4 M19 20v-7',
  setup: 'M4 21V5l8-3 8 3v16 M9 21v-5h6v5 M9 9h.01 M9 13h.01 M15 9h.01 M15 13h.01',
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.overview} />
    </svg>
  );
}

export interface IxNavGroup {
  name: string;
  items: { href: string; label: string; icon: string }[];
}

/** Sidebar navigation of the institute workspace; the current page is announced with aria-current. */
export function IxNav({ groups }: { groups: IxNavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="ix-nav" aria-label="أقسام إدارة المعهد">
      {groups.map((g) => (
        <div key={g.name} className="ix-group">
          <span className="ix-group-name">{g.name}</span>
          {g.items.map((item) => {
            // "/institute" is only the overview itself; the other entries own their sub-paths
            const exact = item.icon === 'overview';
            const active = exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
