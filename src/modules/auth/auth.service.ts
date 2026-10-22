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
}

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
}
