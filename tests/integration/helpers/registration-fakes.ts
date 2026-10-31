import { randomUUID } from 'node:crypto';
import type { Mailer, MailMessage } from '../../../src/shared/services/mailer';
import { RegistrationService, type PendingSignup, type RegistrationInput, type RegistrationRepository } from '../../../src/modules/tenant/registration.service';

/** In-memory RegistrationRepository: pending sign-ups + the tenants created from them. */
export class InMemoryRegistrationRepository implements RegistrationRepository {
  pending = new Map<string, PendingSignup>();
  registered: (Omit<RegistrationInput, 'password'> & { passwordHash: string })[] = [];
  takenSlugs = new Set<string>(['rukn', 'masar']);
  /** Make `register` throw once (e.g. a lost race). */
  failRegisterWith: Error | null = null;

  async slugTaken(slug: string) {
    return this.takenSlugs.has(slug);
  }
  async createPending(row: Omit<PendingSignup, 'id' | 'attempts' | 'sends' | 'lastSentAt'>) {
    const id = randomUUID();
    this.pending.set(id, { ...row, id, attempts: 0, sends: 1, lastSentAt: new Date(0) });
    return id;
  }
  async findPending(id: string) {
    const p = this.pending.get(id);
    return p ? { ...p } : null;
  }
  async bumpAttempts(id: string) {
    const p = this.pending.get(id);
    if (p) p.attempts++;
  }
  async setCode(id: string, codeHash: string, expiresAt: Date, isResend: boolean) {
    const p = this.pending.get(id);
    if (!p) return;
    Object.assign(p, { codeHash, expiresAt, attempts: 0, lastSentAt: this.clock(), sends: p.sends + (isResend ? 1 : 0) });
  }
  async deletePending(id: string) {
    return this.pending.delete(id);
  }
  async countStarted(email: string) {
    return this.started.filter((e) => e === email).length;
  }
  async purgeExpired() {}
  async register(input: Omit<RegistrationInput, 'password'> & { passwordHash: string }) {
    if (this.failRegisterWith) {
      const err = this.failRegisterWith;
      this.failRegisterWith = null;
      throw err;
    }
    this.registered.push(input);
    this.takenSlugs.add(input.slug);
    return { tenantId: 'new-tenant-id' };
  }

  /** E-mails of every start, for the hourly throttle (the real table counts rows by created_at). */
  started: string[] = [];
  clock: () => Date = () => new Date();
}

export class CapturingMailer implements Mailer {
  sent: MailMessage[] = [];
  /** Make the next send fail. */
  failNext = false;
  async send(m: MailMessage) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('smtp down');
    }
    this.sent.push(m);
  }
  /** The 6-digit code in the last message. */
  get lastCode(): string {
    return /(\d{6})/.exec(this.sent[this.sent.length - 1]?.text ?? '')?.[1] ?? '';
  }
}

export function buildRegistrationFakes(opts: { enabled?: boolean; now?: () => Date } = {}) {
  const repository = new InMemoryRegistrationRepository();
  const mailer = new CapturingMailer();
  const clock = { now: new Date('2026-11-01T10:00:00Z') };
  const now = opts.now ?? (() => clock.now);
  repository.clock = now;
  // Count a start when the row is created, like the real table does.
  const createPending = repository.createPending.bind(repository);
  repository.createPending = async (row) => {
    repository.started.push(row.email);
    return createPending(row);
  };
  const service = new RegistrationService({
    repository,
    hashPassword: async (p) => `hashed:${p}`,
    enabled: opts.enabled ?? true,
    mailer,
    webUrl: 'https://t3leem.my',
    now,
  });
  return { repository, mailer, service, clock };
}
