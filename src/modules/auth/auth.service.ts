import type { UserRole } from '@prisma/client';
import { HttpError } from '../../shared/utils/http-error';
import type { AuthRepository } from './auth.repository';

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; role: UserRole };
}

/** Sign-up rules an academy can switch on (the health academy requires a phone number). */
export interface RegistrationPolicy {
  requirePhone: boolean;
}

export interface AuthServiceDeps {
  repository: AuthRepository;
  /**
   * Accounts have no password any more (sign-in is an e-mailed code). The column stays NOT NULL, so
   * every account gets the hash of a random secret nobody knows.
   */
  unusablePasswordHash: () => Promise<string>;
  /** Per-academy sign-up rules; defaults to "phone optional". */
  policy?: (tenantId: string) => Promise<RegistrationPolicy>;
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async registrationPolicy(tenantId: string): Promise<RegistrationPolicy> {
    return this.deps.policy ? this.deps.policy(tenantId) : { requirePhone: false };
  }

  /**
   * PRD §6 POST /api/v1/auth/register: a new learner joins THIS academy (the tenant from the request).
   * The role is always LEARNER — never taken from input. No session is issued: the new learner signs in
   * with the code e-mailed to the address, which also proves they own it. E-mail and phone are each unique
   * per academy, so one person cannot open two accounts with the same number.
   */
  async register(tenantId: string, input: { fullName: string; email: string; phone?: string | null }): Promise<{ id: string; email: string }> {
    const phone = input.phone && input.phone.trim() ? input.phone.trim() : null;
    if (!phone && (await this.registrationPolicy(tenantId)).requirePhone) {
      throw HttpError.unprocessable('PHONE_REQUIRED', 'A phone number is required to register in this academy');
    }
    try {
      const user = await this.deps.repository.createLearner(tenantId, {
        email: input.email.trim().toLowerCase(),
        fullName: input.fullName.trim(),
        phone,
        passwordHash: await this.deps.unusablePasswordHash(),
      });
      return { id: user.id, email: user.email };
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Prisma does not reliably say WHICH unique rule was hit, so ask the database.
        if (phone && (await this.deps.repository.phoneTaken(tenantId, phone))) throw HttpError.conflict('PHONE_TAKEN', 'An account with this phone number already exists in this academy');
        throw HttpError.conflict('EMAIL_TAKEN', 'An account with this email already exists in this academy');
      }
      throw err;
    }
  }
}
