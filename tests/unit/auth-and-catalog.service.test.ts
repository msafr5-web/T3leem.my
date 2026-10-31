import { AuthService } from '../../src/modules/auth/auth.service';
import { JwtTokenSigner } from '../../src/modules/auth/token-signer';
import { CourseCatalogService } from '../../src/modules/lms/courses/course.service';
import type { CourseCatalogRepository } from '../../src/modules/lms/courses/course.repository';
import { HttpError } from '../../src/shared/utils/http-error';

const TENANT = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';

describe('AuthService', () => {
  const setup = () => {
    const repository = {
      findUser: jest.fn(async () => null),
      createLearner: jest.fn(async (_t: string, data: { email: string; fullName: string; passwordHash: string }) => {
        if (data.email === 'a@b.test') throw Object.assign(new Error('dup'), { code: 'P2002' });
        if (data.email === 'boom@b.test') throw new Error('db down');
        return { id: 'u2', email: data.email, role: 'LEARNER' as const };
      }),
    };
    return { service: new AuthService({ repository, unusablePasswordHash: async () => 'hash(random)' }), repository };
  };

  it('registers a LEARNER (role never from input) with an unusable password and issues no session', async () => {
    const { service, repository } = setup();
    await expect(service.register(TENANT, { fullName: ' Reem ', email: ' New@B.test ' })).resolves.toEqual({ id: 'u2', email: 'new@b.test' });
    expect(repository.createLearner).toHaveBeenCalledWith(TENANT, { email: 'new@b.test', fullName: 'Reem', passwordHash: 'hash(random)' });
  });

  it('409 for an existing email, and other errors pass through', async () => {
    const { service } = setup();
    await expect(service.register(TENANT, { fullName: 'A', email: 'a@b.test' })).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    await expect(service.register(TENANT, { fullName: 'A', email: 'boom@b.test' })).rejects.toThrow('db down');
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
