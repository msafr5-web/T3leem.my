import { HttpError } from '../../shared/utils/http-error';

export interface RegistrationInput {
  academyName: string;
  slug: string;
  city: string | null;
  adminName: string;
  adminEmail: string;
  password: string;
}

export interface RegistrationRepository {
  slugTaken(slug: string): Promise<boolean>;
  /** Creates the tenant and its first TENANT_ADMIN atomically. */
  register(input: Omit<RegistrationInput, 'password'> & { passwordHash: string }): Promise<{ tenantId: string }>;
}

/**
 * Words that must never become academy slugs: they collide with platform routes
 * (t3leem.my/<slug>) or subdomains, or invite impersonation of the platform itself.
 */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'billing', 'dashboard', 'docs', 'help', 'join', 'login', 'logout', 'mail',
  'platform', 'register', 'root', 'signup', 'static', 'status', 'support', 'system', 'www', 't3leem', 'rukn-admin',
  '_next', 'favicon', 'robots', 'sitemap', 'health',
]);

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

/** Self-service onboarding for a new service provider (academy). */
export class RegistrationService {
  constructor(
    private readonly repository: RegistrationRepository,
    private readonly hashPassword: (password: string) => Promise<string>,
    private readonly enabled: boolean,
  ) {}

  async register(input: RegistrationInput): Promise<{ tenantId: string; slug: string }> {
    if (!this.enabled) throw HttpError.forbidden('Provider sign-up is closed; contact the platform team');

    const slug = input.slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(slug)) throw HttpError.unprocessable('SLUG_RESERVED', 'This address is reserved; choose another');
    if (await this.repository.slugTaken(slug)) throw HttpError.conflict('SLUG_TAKEN', 'This address is already used by another academy');

    const passwordHash = await this.hashPassword(input.password);
    try {
      const { tenantId } = await this.repository.register({
        academyName: input.academyName.trim(),
        slug,
        city: input.city,
        adminName: input.adminName.trim(),
        adminEmail: input.adminEmail.trim().toLowerCase(),
        passwordHash,
      });
      return { tenantId, slug };
    } catch (err) {
      // Lost a race with a concurrent sign-up for the same slug.
      if (isUniqueViolation(err)) throw HttpError.conflict('SLUG_TAKEN', 'This address is already used by another academy');
      throw err;
    }
  }
}
