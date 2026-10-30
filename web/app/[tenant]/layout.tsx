import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiUnavailableError, getTenant, isMissingTenant, me, type Tenant } from '@/lib/api';
import { logoutAction } from '@/lib/actions';
import { isValidSlug, safeBrandColor } from '@/lib/format';
import { getSession } from '@/lib/session';
import { LogoMark } from '../logo-mark';
import { ServiceUnavailable } from '../service-unavailable';

/** White-label shell: every page under /[tenant] renders with that academy's name and color. */
export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  if (!isValidSlug(slug)) notFound();

  let tenant: Tenant;
  try {
    tenant = await getTenant(slug);
  } catch (err) {
    if (isMissingTenant(err)) notFound();
    // API unreachable: render the outage page here. Throwing would NOT reach ./error.tsx —
    // a segment's error boundary only wraps its page, not its own layout.
    if (err instanceof ApiUnavailableError) return <ServiceUnavailable detail={err.message} />;
    throw err;
  }

  const session = await getSession(slug);
  const brand = safeBrandColor(tenant.brand_settings?.primaryColor);
  // The health-certificates link only appears where the academy has switched the section on and added sectors.
  let showHealth = false;
  if (session) {
    try {
      const h = await me.health(slug, session.token);
      showHealth = h.access !== 'disabled' && h.sectors.length > 0;
    } catch {
      showHealth = false;
    }
  }

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
                {showHealth && <Link href={`/${slug}/health`} className="btn btn-ghost">الشهادات الصحية</Link>}
                {session.role === 'TENANT_ADMIN' ? (
                  <Link href={`/${slug}/dashboard`} className="btn btn-primary">لوحة التحكم</Link>
                ) : (
                  <Link href={`/${slug}/my`} className="btn btn-primary">دوراتي</Link>
                )}
                <span className="small muted ltr">{session.email}</span>
                <form action={logoutAction.bind(null, slug)}>
                  <button type="submit" className="btn btn-ghost">تسجيل الخروج</button>
                </form>
              </>
            ) : (
              <>
                <Link href={`/${slug}/login`} className="btn btn-ghost">تسجيل الدخول</Link>
                <Link href={`/${slug}/register`} className="btn btn-primary">حساب جديد</Link>
              </>
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
