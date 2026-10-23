import type { UserRole } from '@prisma/client';
import { HttpError } from '../../shared/utils/http-error';
import type { AuthRepository } from './auth.repository';
import type { TokenSigner } from './token-signer';

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; role: UserRole };
}

export interface AuthServiceDeps {
  repository: AuthRepository;
  signer: TokenSigner;
  verifyPassword: (password: string, stored: string) => Promise<boolean>;
  /** A valid hash of a random password, verified when the email doesn't exist. */
  dummyHash: Promise<string>;
  hashPassword?: (password: string) => Promise<string>;
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(tenantId: string, email: string, password: string): Promise<LoginResult> {
    const { repository, signer, verifyPassword, dummyHash } = this.deps;
    if (!signer.available) {
      throw new HttpError(503, 'LOGIN_UNAVAILABLE', 'Login is not configured on this server');
    }

    const user = await repository.findByEmail(tenantId, email.trim().toLowerCase());

    // Always run the (deliberately slow) hash check, even for unknown emails, so response
    // time doesn't reveal which emails are registered in this academy.
    const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    if (!user || !valid) {
      // One message for both cases: no account enumeration.
      throw HttpError.unauthorized('Incorrect email or password');
    }

    return {
      accessToken: signer.sign({ userId: user.id, tenantId, role: user.role }),
      expiresIn: signer.ttlSeconds,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  /**
   * PRD §6 POST /api/v1/auth/register: a new learner joins THIS academy (the tenant from the
   * request). The role is always LEARNER — never taken from input — and they're signed in.
   */
  async register(tenantId: string, input: { fullName: string; email: string; password: string }): Promise<LoginResult> {
    const { repository, signer, hashPassword } = this.deps;
    if (!signer.available || !hashPassword) {
      throw new HttpError(503, 'REGISTRATION_UNAVAILABLE', 'Registration is not configured on this server');
    }
    let user: { id: string; email: string; role: UserRole };
    try {
      user = await repository.createLearner(tenantId, {
        email: input.email.trim().toLowerCase(),
        fullName: input.fullName.trim(),
        passwordHash: await hashPassword(input.password),
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw HttpError.conflict('EMAIL_TAKEN', 'An account with this email already exists in this academy');
      throw err;
    }
    return {
      accessToken: signer.sign({ userId: user.id, tenantId, role: user.role }),
      expiresIn: signer.ttlSeconds,
      user,
    };
  }
}
