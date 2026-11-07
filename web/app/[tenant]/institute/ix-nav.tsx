'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PATHS: Record<string, string> = {
  overview: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  academic: 'M3 9l9-5 9 5-9 5-9-5z M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5',
  finance: 'M3 7h15a3 3 0 013 3v7a3 3 0 01-3 3H6a3 3 0 01-3-3V7z M3 7l3-3h11 M16 14h2',
  cost: 'M5 20V10 M12 20V4 M19 20v-7',
  courses: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5z M8 7h7 M8 11h7',
  video: 'M3 6h12v12H3z M15 10l6-3v10l-6-3',
  plans: 'M9 4h6v3H9z M6 5h12v16H6z M9 12h6 M9 16h4',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6z M3 20c0-3 3-5 6-5s6 2 6 5 M17 11a2.5 2.5 0 100-5 M18 15c2 .4 3 2 3 4',
  live: 'M4 6h16v10H4z M8 20h8 M12 16v4',
  cert: 'M12 3l2.5 2 3.2-.3.8 3.1 2.8 1.6-1.2 3 1.2 3-2.8 1.6-.8 3.1-3.2-.3L12 21l-2.5-2-3.2.3-.8-3.1L2.7 14.6l1.2-3-1.2-3 2.8-1.6.8-3.1 3.2.3z',
  health: 'M12 21s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 6-8 11-8 11z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v0l-2 1 1 3 2-.5L7.5 17.5 7 19.5l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z',
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
export function IxNav({ groups, label = 'أقسام إدارة المعهد', exactIcon = 'overview' }: { groups: IxNavGroup[]; label?: string; exactIcon?: string }) {
  const pathname = usePathname();
  return (
    <nav className="ix-nav" aria-label={label}>
      {groups.map((g) => (
        <div key={g.name} className="ix-group">
          <span className="ix-group-name">{g.name}</span>
          {g.items.map((item) => {
            // "/institute" is only the overview itself; the other entries own their sub-paths
            const exact = item.icon === exactIcon;
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
