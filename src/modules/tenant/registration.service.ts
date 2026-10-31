import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Mailer } from '../../shared/services/mailer';
import { HttpError } from '../../shared/utils/http-error';

export interface RegistrationInput {
  academyName: string;
  slug: string;
  city: string | null;
  adminName: string;
  adminEmail: string;
  /** International format, e.g. +9665XXXXXXXX (kept for the owner's WhatsApp follow-up). */
  phone: string | null;
}

export interface PendingSignup {
  id: string;
  email: string;
  slug: string;
  academyName: string;
  city: string | null;
  adminName: string;
  phone: string | null;
  passwordHash: string;
  codeHash: string;
  attempts: number;
  sends: number;
  lastSentAt: Date;
  expiresAt: Date;
}

export interface RegistrationRepository {
  slugTaken(slug: string): Promise<boolean>;
  /** Stores a sign-up waiting for its code; returns the row id (which salts the code hash). */
  createPending(row: Omit<PendingSignup, 'id' | 'attempts' | 'sends' | 'lastSentAt'>): Promise<string>;
  findPending(id: string): Promise<PendingSignup | null>;
  /** Wrong code: counts the attempt. */
  bumpAttempts(id: string): Promise<void>;
  /** New code for the same sign-up: resets the attempts, counts the send, restarts the clock. */
  setCode(id: string, codeHash: string, expiresAt: Date, isResend: boolean): Promise<void>;
  /** True only for the caller that actually removed the row (a code works once). */
  deletePending(id: string): Promise<boolean>;
  /** Sign-ups started with this e-mail since `since` (throttle). */
  countStarted(email: string, since: Date): Promise<number>;
  purgeExpired(before: Date): Promise<void>;
  /** Creates the tenant and its first TENANT_ADMIN atomically. */
  register(input: RegistrationInput & { passwordHash: string }): Promise<{ tenantId: string }>;
}

/**
 * Words that must never become academy slugs: they collide with platform routes
 * (t3leem.my/<slug>) or subdomains, or invite impersonation of the platform itself.
 */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'billing', 'dashboard', 'docs', 'help', 'join', 'login', 'logout', 'mail',
  'platform', 'register', 'root', 'signup', 'static', 'status', 'support', 'system', 'www', 't3leem', 'rukn-admin',
  '_next', 'owner', 'favicon', 'robots', 'sitemap', 'verify', 'certificates', 'webhooks',
]);

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

export const SIGNUP_CODE = { ttlMs: 15 * 60_000, maxAttempts: 5, maxSends: 3, resendCooldownMs: 60_000, maxStartsPerHour: 5 } as const;

const hashCode = (code: string, id: string) => createHash('sha256').update(`${id}:${code}`).digest();
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

interface Deps {
  repository: RegistrationRepository;
  hashPassword: (password: string) => Promise<string>;
  enabled: boolean;
  mailer: Mailer;
  /** Public web URL, for the links in the e-mail. */
  webUrl: string;
  /** Platform owner addresses: told about every new sign-up waiting for approval. */
  ownerEmails?: string[];
  now?: () => Date;
  /** Injectable for tests; the default is a CSPRNG 6-digit code. */
  generateCode?: () => string;
}

interface MailTarget {
  email: string;
  adminName: string;
  academyName: string;
  slug: string;
  city: string | null;
}

/**
 * Self-service onboarding for a new service provider (academy), in two steps:
 * `start` e-mails a 6-digit code to the admin address; `verify` creates the academy only when the
 * code comes back, so the address is proven to belong to whoever is registering.
 */
export class RegistrationService {
  private readonly now: () => Date;
  private readonly generateCode: () => string;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
    this.generateCode = deps.generateCode ?? (() => String(randomInt(100_000, 1_000_000)));
  }

  private async assertSlugFree(slug: string): Promise<void> {
    if (RESERVED_SLUGS.has(slug)) throw HttpError.unprocessable('SLUG_RESERVED', 'This address is reserved; choose another');
    if (await this.deps.repository.slugTaken(slug)) throw HttpError.conflict('SLUG_TAKEN', 'This address is already used by another academy');
  }

  private async sendCode(p: MailTarget, code: string): Promise<void> {
    const site = `${this.deps.webUrl.replace(/\/$/, '')}/${p.slug}`;
    const minutes = SIGNUP_CODE.ttlMs / 60_000;
    const text = [
      `مرحباً ${p.adminName}،`,
      '',
      `رمز التحقق لإنشاء أكاديميتك على T3leem.my: ${code}`,
      `الرمز صالح ${minutes} دقيقة، ولا تشاركه مع أحد.`,
      '',
      'بيانات الأكاديمية المطلوب إنشاؤها:',
      `• الاسم: ${p.academyName}`,
      `• رابط الموقع: ${site}`,
      `• لوحة التحكم: ${site}/dashboard`,
      ...(p.city ? [`• المدينة: ${p.city}`] : []),
      `• بريد المسؤول: ${p.email}`,
      '',
      'إن لم تطلب إنشاء هذه الأكاديمية فتجاهل هذه الرسالة، ولن يُنشأ شيء.',
    ].join('\n');
    const row = (k: string, v: string) => `<tr><td style="padding:4px 12px;color:#555">${k}</td><td style="padding:4px 12px"><strong>${v}</strong></td></tr>`;
    const link = (url: string) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1b1f1e;max-width:520px">
<p>مرحباً ${escapeHtml(p.adminName)}،</p>
<p>رمز التحقق لإنشاء أكاديميتك على T3leem.my:</p>
<p dir="ltr" style="font-size:32px;letter-spacing:8px;font-weight:700;background:#f1f5f4;border-radius:8px;padding:12px 16px;text-align:center">${escapeHtml(code)}</p>
<p style="color:#555">الرمز صالح ${minutes} دقيقة، ولا تشاركه مع أحد.</p>
<p>بيانات الأكاديمية المطلوب إنشاؤها:</p>
<table style="border-collapse:collapse">${row('الاسم', escapeHtml(p.academyName))}${row('رابط الموقع', link(site))}${row('لوحة التحكم', link(`${site}/dashboard`))}${p.city ? row('المدينة', escapeHtml(p.city)) : ''}${row('بريد المسؤول', escapeHtml(p.email))}</table>
<p style="color:#555">إن لم تطلب إنشاء هذه الأكاديمية فتجاهل هذه الرسالة، ولن يُنشأ شيء.</p></div>`;
    try {
      await this.deps.mailer.send({ to: p.email, subject: `رمز التحقق ${code} لإنشاء أكاديمية «${p.academyName}»`, text, html });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, 'MAIL_UNAVAILABLE', 'The verification e-mail could not be sent');
    }
  }

  /** Tells the platform owner a new academy is waiting for approval. Best effort: the sign-up is already saved. */
  private async notifyOwners(p: PendingSignup): Promise<void> {
    const owners = this.deps.ownerEmails ?? [];
    if (owners.length === 0) return;
    const base = this.deps.webUrl.replace(/\/$/, '');
    const lines = [
      `طلب اشتراك جديد بانتظار الاعتماد: «${p.academyName}»`,
      `• الرابط المطلوب: ${base}/${p.slug}`,
      `• المسؤول: ${p.adminName} (${p.email})`,
      ...(p.phone ? [`• الجوال: ${p.phone}`] : []),
      ...(p.city ? [`• المدينة: ${p.city}`] : []),
      '',
      `اعتمد الطلب وحدّد الباقة والمدة من لوحة الإدارة: ${base}/owner`,
    ];
    try {
      await this.deps.mailer.send({
        to: owners.join(','),
        subject: `طلب اشتراك جديد: ${p.academyName}`,
        text: lines.join('\n'),
        html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8">${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>`,
      });
    } catch {
      // ignored on purpose
    }
  }

  /** Step 1: validate, store the pending sign-up and e-mail the code. Nothing is created yet. */
  async start(input: RegistrationInput): Promise<{ pendingId: string; email: string; expiresInSec: number }> {
    if (!this.deps.enabled) throw HttpError.forbidden('Provider sign-up is closed; contact the platform team');
    const slug = input.slug.trim().toLowerCase();
    const email = input.adminEmail.trim().toLowerCase();
    await this.assertSlugFree(slug);

    const now = this.now();
    if ((await this.deps.repository.countStarted(email, new Date(now.getTime() - 3_600_000))) >= SIGNUP_CODE.maxStartsPerHour) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-up attempts for this e-mail; try again later');
    }
    await this.deps.repository.purgeExpired(new Date(now.getTime() - 24 * 3_600_000));

    const code = this.generateCode();
    const expiresAt = new Date(now.getTime() + SIGNUP_CODE.ttlMs);
    const target: MailTarget = { email, adminName: input.adminName.trim(), academyName: input.academyName.trim(), slug, city: input.city };
    const phone = input.phone && input.phone.trim() ? input.phone.trim() : null;
    // The row id salts the code hash, so the row is created first and the hash is filled in right after.
    // Accounts have no password (sign-in is an e-mailed code); the column still needs a hash of a secret nobody knows.
    const id = await this.deps.repository.createPending({ ...target, phone, passwordHash: await this.deps.hashPassword(randomBytes(24).toString('hex')), codeHash: '', expiresAt });
    await this.deps.repository.setCode(id, hashCode(code, id).toString('hex'), expiresAt, false);
    try {
      await this.sendCode(target, code);
    } catch (err) {
      await this.deps.repository.deletePending(id);
      throw err;
    }
    return { pendingId: id, email, expiresInSec: SIGNUP_CODE.ttlMs / 1000 };
  }

  /** A fresh code for the same pending sign-up (cooldown and a cap on sends). */
  async resend(pendingId: string): Promise<{ expiresInSec: number }> {
    const p = await this.deps.repository.findPending(pendingId);
    const now = this.now();
    if (!p || p.expiresAt <= now) throw HttpError.unprocessable('CODE_EXPIRED', 'The code expired; start again');
    if (p.sends >= SIGNUP_CODE.maxSends) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'No more codes can be sent for this sign-up; start again');
    if (now.getTime() - p.lastSentAt.getTime() < SIGNUP_CODE.resendCooldownMs) throw new HttpError(429, 'RESEND_TOO_SOON', 'Wait a minute before asking for another code');
    const code = this.generateCode();
    const expiresAt = new Date(now.getTime() + SIGNUP_CODE.ttlMs);
    await this.deps.repository.setCode(p.id, hashCode(code, p.id).toString('hex'), expiresAt, true);
    await this.sendCode(p, code);
    return { expiresInSec: SIGNUP_CODE.ttlMs / 1000 };
  }

  /** Step 2: the right code creates the academy and its first admin. */
  async verify(pendingId: string, code: string): Promise<{ tenantId: string; slug: string }> {
    const p = await this.deps.repository.findPending(pendingId);
    if (!p || p.expiresAt <= this.now()) throw HttpError.unprocessable('CODE_EXPIRED', 'The code expired; start again');
    if (p.attempts >= SIGNUP_CODE.maxAttempts) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes; start again');

    const expected = Buffer.from(p.codeHash, 'hex');
    const given = hashCode(code.trim(), p.id);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.deps.repository.bumpAttempts(p.id);
      throw HttpError.unprocessable('CODE_INVALID', 'The code is wrong');
    }

    // A code works once: only the request that really removes the row may create the academy.
    if (!(await this.deps.repository.deletePending(p.id))) throw HttpError.unprocessable('CODE_EXPIRED', 'The code was already used; start again');
    await this.assertSlugFree(p.slug);
    try {
      const { tenantId } = await this.deps.repository.register({ academyName: p.academyName, slug: p.slug, city: p.city, adminName: p.adminName, adminEmail: p.email, phone: p.phone, passwordHash: p.passwordHash });
      await this.notifyOwners(p);
      return { tenantId, slug: p.slug };
    } catch (err) {
      // Lost a race with a concurrent sign-up for the same slug.
      if (isUniqueViolation(err)) throw HttpError.conflict('SLUG_TAKEN', 'This address is already used by another academy');
      throw err;
    }
  }
}
