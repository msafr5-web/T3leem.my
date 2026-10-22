import { AuthService } from '../../src/modules/auth/auth.service';
import type { TokenSigner } from '../../src/modules/auth/token-signer';
import { JwtTokenSigner } from '../../src/modules/auth/token-signer';
import { CourseCatalogService } from '../../src/modules/lms/courses/course.service';
import type { CourseCatalogRepository } from '../../src/modules/lms/courses/course.repository';
import { HttpError } from '../../src/shared/utils/http-error';

const TENANT = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';

describe('AuthService', () => {
  const signer: TokenSigner = { available: true, ttlSeconds: 900, sign: jest.fn(() => 'signed.jwt') };

  const setup = (overrides: Partial<ConstructorParameters<typeof AuthService>[0]> = {}) => {
    const verifyPassword = jest.fn(async (pw: string, stored: string) => stored === 'good-hash' && pw === 'pw');
    const repository = {
      findByEmail: jest.fn(async (_t: string, email: string) =>
        email === 'a@b.test' ? { id: 'u1', email, role: 'LEARNER' as const, passwordHash: 'good-hash' } : null,
      ),
    };
    const service = new AuthService({ repository, signer, verifyPassword, dummyHash: Promise.resolve('dummy-hash'), ...overrides });
    return { service, repository, verifyPassword };
  };

  it('normalizes the email and signs a token on success', async () => {
    const { service, repository } = setup();
    await expect(service.login(TENANT, ' A@B.test ', 'pw')).resolves.toEqual({
      accessToken: 'signed.jwt',
      expiresIn: 900,
      user: { id: 'u1', email: 'a@b.test', role: 'LEARNER' },
    });
    expect(repository.findByEmail).toHaveBeenCalledWith(TENANT, 'a@b.test');
    expect(signer.sign).toHaveBeenCalledWith({ userId: 'u1', tenantId: TENANT, role: 'LEARNER' });
  });

  it('still runs the hash check for unknown emails (constant-time-ish), then 401', async () => {
    const { service, verifyPassword } = setup();
    await expect(service.login(TENANT, 'ghost@b.test', 'pw')).rejects.toMatchObject({ status: 401 });
    expect(verifyPassword).toHaveBeenCalledWith('pw', 'dummy-hash');
  });

  it('401 for a wrong password', async () => {
    const { service } = setup();
    await expect(service.login(TENANT, 'a@b.test', 'wrong')).rejects.toBeInstanceOf(HttpError);
  });

  it('503 when no signing key is configured, without touching the database', async () => {
    const { service, repository } = setup({ signer: { available: false, ttlSeconds: 900, sign: jest.fn() } });
    await expect(service.login(TENANT, 'a@b.test', 'pw')).rejects.toMatchObject({ status: 503, code: 'LOGIN_UNAVAILABLE' });
    expect(repository.findByEmail).not.toHaveBeenCalled();
  });
});

describe('JwtTokenSigner', () => {
  it('reports availability and refuses to sign without a key', () => {
    const signer = new JwtTokenSigner(undefined, { issuer: 'i', audience: 'a', ttlSeconds: 60 });
    expect(signer.available).toBe(false);
    expect(signer.ttlSeconds).toBe(60);
    expect(() => signer.sign({ userId: 'u', tenantId: 't', role: 'LEARNER' })).toThrow('not configured');
  });
});

describe('CourseCatalogService', () => {
  const row = {
    id: 'c1',
    title: 'PMP',
    type: 'RECORDED' as const,
    priceHalalas: 199900,
    trainingHours: 35,
    durationDays: 5,
    accreditationNumber: null,
    trainerName: 'Khalid',
    moduleCount: 1,
    lessonCount: 3,
  };
  const detail = {
    ...row,
    description: null,
    licenseNumber: null,
    licenseAuthority: null,
    licenseExpiresOn: null,
    trainer: { id: 't1', fullName: 'Khalid', specialization: null, bio: null },
    modules: [],
  };
  const repository: CourseCatalogRepository = {
    listPublished: async () => [row],
    findPublished: async (_t, id) => (id === 'c1' ? detail : null),
  };
  const service = new CourseCatalogService(repository, 15);

  it('prices every course VAT-inclusive with the checkout rounding rules', async () => {
    const [course] = await service.list(TENANT);
    // 1999.00 + 15% = 299.85 VAT -> 2298.85
    expect(course?.price).toEqual({ netHalalas: 199900, vatHalalas: 29985, totalHalalas: 229885 });
  });

  it('returns details or 404', async () => {
    await expect(service.get(TENANT, 'c1')).resolves.toMatchObject({ id: 'c1', modules: [] });
    await expect(service.get(TENANT, 'missing')).rejects.toMatchObject({ status: 404, code: 'COURSE_NOT_FOUND' });
  });
});
