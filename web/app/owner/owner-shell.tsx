import { PlatformEmblem } from '@/app/brand-mark';
import Link from 'next/link';
import { ownerLogoutAction } from '@/lib/owner-actions';

/** The platform owner's page frame: header with the signed-in e-mail and sign-out. */
export function OwnerShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand-mark">
            <PlatformEmblem />
            T3leem.my · الإدارة
          </Link>
          <div className="header-actions">
            <span className="small muted ltr">{email}</span>
            <form action={ownerLogoutAction}>
              <button type="submit" className="btn btn-ghost">
                تسجيل الخروج
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
