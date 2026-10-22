import 'server-only';
import { redirect } from 'next/navigation';
import { getSession } from './session';

/**
 * Dashboard page guard: returns the admin's token or redirects. The API re-checks the role and
 * tenant on every call, so this is a UX guard (no flash of a page the user can't use), not the
 * security boundary.
 */
export async function requireAdmin(slug: string): Promise<string> {
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/dashboard`)}`);
  if (session.role !== 'TENANT_ADMIN') redirect(`/${slug}`);
  return session.token;
}
