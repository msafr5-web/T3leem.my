import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import type { Mailer } from '../../shared/services/mailer';
import { HttpError } from '../../shared/utils/http-error';
import type { LoginResult } from './auth.service';
import type { TokenSigner } from './token-signer';

/** The platform owner console is not an academy: its tokens carry this sentinel tenant and id. */
export const PLATFORM_TENANT_ID = '00000000-0000-4000-8000-000000000000';
export const PLATFORM_OWNER_ID = '00000000-0000-4000-8000-0000000000a1';

export const OTP = { ttlMs: 10 * 60_000, maxAttempts: 5, maxSends: 3, resendCooldownMs: 60_000, maxRequestsPerHour: 10 } as const;

export interface OtpChallenge {
  id: string;
  tenantId: string | null;
  email: string;
  userId: string | null;
  codeHash: string;
  attempts: number;
  sends: number;
  lastSentAt: Date;
  expiresAt: Date;
}

export interface OtpRepository {
  create(row: { tenantId: string | null; email: string; userId: string | null; expiresAt: Date }): Promise<string>;
  find(id: string): Promise<OtpChallenge | null>;
  bumpAttempts(id: string): Promise<void>;
  setCode(id: string, codeHash: string, expiresAt: Date, isResend: boolean): Promise<void>;
  /** True only for the caller that really removed the row: a code signs in once. */
  delete(id: string): Promise<boolean>;
  countRecent(tenantId: string | null, email: string, since: Date): Promise<number>;
  purgeExpired(before: Date): Promise<void>;
}

export interface LoginUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string | null;
}

export interface UserLookup {
  findUser(tenantId: string, email: string): Promise<LoginUser | null>;
}

interface Deps {
  repository: OtpRepository;
  users: UserLookup;
  mailer: Mailer;
  signer: TokenSigner;
  /** E-mail addresses allowed into the platform owner console. */
  platformAdmins: string[];
  now?: () => Date;
  generateCode?: () => string;
}

const hashCode = (code: string, id: string) => createHash('sha256').update(`otp:${id}:${code}`).digest();
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const INVALID = () => HttpError.unprocessable('OTP_INVALID', 'The code is wrong or expired');

/**
 * Passwordless sign-in for every role (owner, trainer, trainee) and for the platform owner:
 * the e-mail address is the credential, and a one-time 6-digit code sent to it proves the person
 * holds the mailbox. Unknown addresses get the same answer as known ones so the form cannot be used
 * to find out who has an account.
 */
export class OtpLoginService {
  private readonly now: () => Date;
  private readonly generateCode: () => string;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
    this.generateCode = deps.generateCode ?? (() => String(randomInt(100_000, 1_000_000)));
  }

  private assertAvailable(): void {
    if (!this.deps.signer.available) throw new HttpError(503, 'LOGIN_UNAVAILABLE', 'Login is not configured on this server');
  }

  private async mail(email: string, name: string, code: string, label: string): Promise<void> {
    const minutes = OTP.ttlMs / 60_000;
    const text = [
      `مرحباً ${name}،`,
      '',
      `رمز الدخول إلى ${label}: ${code}`,
      `الرمز صالح ${minutes} دقائق ويُستعمل مرة واحدة، ولا تشاركه مع أحد.`,
      '',
      'إن لم تطلب الدخول فتجاهل هذه الرسالة؛ لا يدخل أحد حسابك دون هذا الرمز.',
    ].join('\n');
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1b1f1e;max-width:480px">
<p>مرحباً ${escapeHtml(name)}،</p>
<p>رمز الدخول إلى ${escapeHtml(label)}:</p>
<p dir="ltr" style="font-size:32px;letter-spacing:8px;font-weight:700;background:#f1f5f4;border-radius:8px;padding:12px 16px;text-align:center">${escapeHtml(code)}</p>
<p style="color:#555">الرمز صالح ${minutes} دقائق ويُستعمل مرة واحدة، ولا تشاركه مع أحد.</p>
<p style="color:#555">إن لم تطلب الدخول فتجاهل هذه الرسالة؛ لا يدخل أحد حسابك دون هذا الرمز.</p></div>`;
    try {
      await this.deps.mailer.send({ to: email, subject: `رمز الدخول ${code} — ${label}`, text, html });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, 'MAIL_UNAVAILABLE', 'The login code could not be e-mailed');
    }
  }

  private async issue(tenantId: string | null, email: string, userId: string | null, name: string, label: string): Promise<{ challengeId: string; expiresInSec: number }> {
    const now = this.now();
    if ((await this.deps.repository.countRecent(tenantId, email, new Date(now.getTime() - 3_600_000))) >= OTP.maxRequestsPerHour) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in requests; try again later');
    }
    await this.deps.repository.purgeExpired(new Date(now.getTime() - 24 * 3_600_000));
    const code = this.generateCode();
    const expiresAt = new Date(now.getTime() + OTP.ttlMs);
    const id = await this.deps.repository.create({ tenantId, email, userId, expiresAt });
    await this.deps.repository.setCode(id, hashCode(code, id).toString('hex'), expiresAt, false);
    try {
      await this.mail(email, name, code, label);
    } catch (err) {
      await this.deps.repository.delete(id);
      throw err;
    }
    return { challengeId: id, expiresInSec: OTP.ttlMs / 1000 };
  }

  /** Step 1 for an academy: e-mails a code if the address has an account there (same answer either way). */
  async requestForTenant(tenantId: string, tenantName: string, rawEmail: string): Promise<{ challengeId: string; expiresInSec: number }> {
    this.assertAvailable();
    const email = rawEmail.trim().toLowerCase();
    const user = await this.deps.users.findUser(tenantId, email);
    if (!user) return { challengeId: randomUUID(), expiresInSec: OTP.ttlMs / 1000 };
    return this.issue(tenantId, email, user.id, user.fullName?.trim() || email, tenantName);
  }

  /** Step 1 for the platform owner console: only listed addresses get a code. */
  async requestForPlatform(rawEmail: string): Promise<{ challengeId: string; expiresInSec: number }> {
    this.assertAvailable();
    const email = rawEmail.trim().toLowerCase();
    if (!this.deps.platformAdmins.includes(email)) return { challengeId: randomUUID(), expiresInSec: OTP.ttlMs / 1000 };
    return this.issue(null, email, PLATFORM_OWNER_ID, 'مالك المنصة', 'لوحة إدارة T3leem.my');
  }

  /** A fresh code for the same challenge (cooldown and a cap on sends). Unknown ids answer the same as known ones. */
  async resend(scope: string | null, challengeId: string, label: string): Promise<{ expiresInSec: number }> {
    const c = await this.deps.repository.find(challengeId);
    const now = this.now();
    const same = { expiresInSec: OTP.ttlMs / 1000 };
    if (!c || c.tenantId !== scope || c.expiresAt <= now) return same;
    if (c.sends >= OTP.maxSends) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'No more codes can be sent; sign in again');
    if (now.getTime() - c.lastSentAt.getTime() < OTP.resendCooldownMs) throw new HttpError(429, 'RESEND_TOO_SOON', 'Wait a minute before asking for another code');
    const code = this.generateCode();
    const expiresAt = new Date(now.getTime() + OTP.ttlMs);
    await this.deps.repository.setCode(c.id, hashCode(code, c.id).toString('hex'), expiresAt, true);
    await this.mail(c.email, c.email, code, label);
    return same;
  }

  /** Step 2: the right code signs the user in. Every failure looks the same except the lock-out. */
  async verify(scope: string | null, challengeId: string, code: string): Promise<LoginResult> {
    this.assertAvailable();
    const c = await this.deps.repository.find(challengeId);
    if (!c || c.tenantId !== scope || c.expiresAt <= this.now() || !c.userId) throw INVALID();
    if (c.attempts >= OTP.maxAttempts) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes; request a new one');

    const expected = Buffer.from(c.codeHash, 'hex');
    const given = hashCode(code.trim(), c.id);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.deps.repository.bumpAttempts(c.id);
      throw INVALID();
    }
    if (!(await this.deps.repository.delete(c.id))) throw INVALID();

    if (scope === null) {
      // Re-check the allow-list at sign-in time, so removing an address takes effect immediately.
      if (!this.deps.platformAdmins.includes(c.email)) throw INVALID();
      return {
        accessToken: this.deps.signer.sign({ userId: PLATFORM_OWNER_ID, tenantId: PLATFORM_TENANT_ID, role: 'SUPER_ADMIN' }),
        expiresIn: this.deps.signer.ttlSeconds,
        user: { id: PLATFORM_OWNER_ID, email: c.email, role: 'SUPER_ADMIN' },
      };
    }
    const user = await this.deps.users.findUser(scope, c.email);
    if (!user) throw INVALID();
    return {
      accessToken: this.deps.signer.sign({ userId: user.id, tenantId: scope, role: user.role }),
      expiresIn: this.deps.signer.ttlSeconds,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
