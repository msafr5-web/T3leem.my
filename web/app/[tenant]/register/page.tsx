import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/format';
import { api, type RegisterPolicy } from '@/lib/api';
import { getSession } from '@/lib/session';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'إنشاء حساب متدرب' };

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ next?: string }> }) {
  const [{ tenant: slug }, { next }] = await Promise.all([params, searchParams]);
  const target = next ? safeNextPath(slug, next) : '';
  if (await getSession(slug)) redirect(target || `/${slug}/my`);
  // Some academies (the health academy) also ask for a phone number.
  const policy = await api<RegisterPolicy>(slug, '/auth/register-policy').catch(() => ({ require_phone: false }));

  return (
    <div className="narrow stack">
      <h1>إنشاء حساب متدرب</h1>
      <p className="muted">حساب واحد لتصفح الدورات وشرائها ومتابعة تقدمك وشهاداتك في هذه الأكاديمية.</p>
      <div className="card">
        <RegisterForm slug={slug} next={target} requirePhone={policy.require_phone} />
      </div>
      <p className="small muted">
        لديك حساب؟ <Link href={`/${slug}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>سجّل الدخول</Link>
      </p>
    </div>
  );
}
