import 'server-only';
import { cookies } from 'next/headers';

/**
 * The platform owner's session: its own httpOnly cookie, scoped to /owner so it is never sent to an
 * academy page (and an academy session is never sent here).
 */
const NAME = 't3_owner';
const secureCookies = process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

export interface OwnerSession {
  token: string;
  email: string;
}

export async function getOwnerSession(): Promise<OwnerSession | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<OwnerSession>;
    return typeof s.token === 'string' && typeof s.email === 'string' ? (s as OwnerSession) : null;
  } catch {
    return null;
  }
}

export async function setOwnerSession(session: OwnerSession, maxAgeSeconds: number): Promise<void> {
  (await cookies()).set(NAME, JSON.stringify(session), { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/owner', maxAge: maxAgeSeconds });
}

export async function clearOwnerSession(): Promise<void> {
  (await cookies()).set(NAME, '', { path: '/owner', maxAge: 0 });
}
