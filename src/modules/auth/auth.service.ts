import type { UserRole } from '@prisma/client';
import { HttpError } from '../../shared/utils/http-error';
import type { AuthRepository } from './auth.repository';

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; role: UserRole };
}

export interface AuthServiceDeps {
  repository: AuthRepository;
  /**
   * Accounts have no password any more (sign-in is an e-mailed code). The column stays NOT NULL, so
   * every account gets the hash of a random secret nobody knows.
   */
  unusablePasswordHash: () => Promise<string>;
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * PRD §6 POST /api/v1/auth/register: a new learner joins THIS academy (the tenant from the request).
   * The role is always LEARNER — never taken from input. No session is issued: the new learner signs in
   * with the code e-mailed to the address, which also proves they own it.
   */
  async register(tenantId: string, input: { fullName: string; email: string }): Promise<{ id: string; email: string }> {
    try {
      const user = await this.deps.repository.createLearner(tenantId, {
        email: input.email.trim().toLowerCase(),
        fullName: input.fullName.trim(),
        passwordHash: await this.deps.unusablePasswordHash(),
      });
      return { id: user.id, email: user.email };
    } catch (err) {
      if (isUniqueViolation(err)) throw HttpError.conflict('EMAIL_TAKEN', 'An account with this email already exists in this academy');
      throw err;
    }
  }
}
