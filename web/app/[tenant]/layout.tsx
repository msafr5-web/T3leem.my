import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenant, isMissingTenant, type Tenant } from '@/lib/api';
import { logoutAction } from '@/lib/actions';
import { isValidSlug, safeBrandColor } from '@/lib/format';
import { getSession } from '@/lib/session';
import { LogoMark } from '../logo-mark';

/** White-label shell: every page under /[tenant] renders with that academy's name and color. */
export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  if (!isValidSlug(slug)) notFound();

  let tenant: Tenant;
  try {
    tenant = await getTenant(slug);
  } catch (err) {
    if (isMissingTenant(err)) notFound();
    throw err; // API outage -> error.tsx
  }

  const session = await getSession(slug);
  const brand = safeBrandColor(tenant.brand_settings?.primaryColor);

  return (
    <div style={brand ? ({ ['--brand' as string]: brand } as React.CSSProperties) : undefined}>
      <header className="site-header">
        <div className="container">
          <Link href={`/${slug}`} className="brand-mark">
            <LogoMark slug={slug} name={tenant.name} version={tenant.logo_version} size={36} />
            {tenant.name}
          </Link>
          <div className="header-actions">
            {session ? (
              <>
                {session.role === 'TENANT_ADMIN' && (
                  <Link href={`/${slug}/dashboard`} className="btn btn-primary">لوحة التحكم</Link>
                )}
                <span className="small muted ltr">{session.email}</span>
                <form action={logoutAction.bind(null, slug)}>
                  <button type="submit" className="btn btn-ghost">تسجيل الخروج</button>
                </form>
              </>
            ) : (
              <Link href={`/${slug}/login`} className="btn btn-ghost">تسجيل الدخول</Link>
            )}
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
      <footer className="site-footer">
        <div className="container">
          {tenant.name} · تعمل على <Link href="/">T3leem.my</Link>
        </div>
      </footer>
    </div>
  );
}
