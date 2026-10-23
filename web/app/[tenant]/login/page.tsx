import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/format';
import { getSession } from '@/lib/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ tenant: slug }, { next }] = await Promise.all([params, searchParams]);
  // Empty when login was opened directly: the action then picks the role's home page.
  const target = next ? safeNextPath(slug, next) : '';
  if (await getSession(slug)) redirect(target || `/${slug}`);

  return (
    <div className="narrow stack">
      <h1>تسجيل الدخول</h1>
      <p className="muted">ادخل بحسابك في هذه الأكاديمية.</p>
      <div className="card">
        <LoginForm slug={slug} next={target} />
      </div>
      <p className="small">
        ليس لديك حساب؟ <Link href={`/${slug}/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>أنشئ حساب متدرب</Link>
      </p>
      <div className="creds" aria-label="حسابات تجريبية">
        <span className="muted">مدير المزود</span>
        <span className="ltr">admin@{slug}.test</span>
        <span className="muted">متدرب</span>
        <span className="ltr">{slug === 'rukn' ? 'student' : 'learner'}@{slug}.test</span>
        <span className="muted">كلمة المرور</span>
        <span className="ltr">Demo@2026</span>
      </div>
    </div>
  );
}
