import 'server-only';
import { cookies } from 'next/headers';

/**
 * One session per academy: the cookie is scoped to the academy's path (/rukn), so a
 * login at one academy is never sent to another. httpOnly keeps the token out of reach of
 * page scripts (XSS can't steal it); SameSite=Lax blocks cross-site form posts.
 */
export interface Session {
  token: string;
  email: string;
  role: string;
}

const cookieName = (slug: string) => `t3_session_${slug}`;

/**
 * Secure cookies are only sent over HTTPS. Default: on in production. A server reached by a
 * bare IP over plain HTTP (before a domain + TLS certificate exist) must set COOKIE_SECURE=false,
 * otherwise the browser silently drops the session cookie and login appears to do nothing.
 */
const secureCookies = process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

export async function getSession(slug: string): Promise<Session | null> {
  const raw = (await cookies()).get(cookieName(slug))?.value;
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Partial<Session>;
    if (typeof session.token !== 'string' || typeof session.email !== 'string' || typeof session.role !== 'string') return null;
    return session as Session;
  } catch {
    return null;
  }
}

export async function setSession(slug: string, session: Session, maxAgeSeconds: number): Promise<void> {
  (await cookies()).set(cookieName(slug), JSON.stringify(session), {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: `/${slug}`,
    maxAge: maxAgeSeconds,
  });
}

export async function clearSession(slug: string): Promise<void> {
  (await cookies()).set(cookieName(slug), '', { path: `/${slug}`, maxAge: 0 });
}
