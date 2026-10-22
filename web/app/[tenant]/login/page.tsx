import type { Metadata } from 'next';
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
  const target = safeNextPath(slug, next);
  if (await getSession(slug)) redirect(target);

  return (
    <div className="narrow stack">
      <h1>تسجيل الدخول</h1>
      <p className="muted">ادخل بحسابك في هذه الأكاديمية.</p>
      <div className="card">
        <LoginForm slug={slug} next={target} />
      </div>
      <p className="small muted">
        حساب تجريبي: <span className="ltr">learner@{slug}.test</span> · كلمة المرور <span className="ltr">Demo@2026</span>
      </p>
    </div>
  );
}
