import { BrandingService, MAX_LOGO_BYTES, sniffImage, type BrandingRepository } from '../../src/modules/tenant/branding.service';
import { RegistrationService, type RegistrationRepository } from '../../src/modules/tenant/registration.service';

const T = 'tenant-1';
const actor = { userId: 'admin', role: 'TENANT_ADMIN' as const, ip: null };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([1])]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

describe('sniffImage', () => {
  it('identifies PNG, JPEG and WebP by magic bytes and rejects everything else', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(Buffer.from('<html>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('BrandingService', () => {
  const setup = (brandSettings: unknown = { locale: 'ar', primaryColor: '#000000', tagline: 'old' }) => {
    const repo = {
      getBranding: jest.fn(async (t: string) =>
        t === T
          ? {
              brandSettings,
              profile: { name: 'A', slug: 'a', tagline: null, about: null, city: null, primaryColor: null, legalName: null, vatNumber: null, hasLogo: false, logoUpdatedAt: null },
            }
          : null,
      ),
      updateBranding: jest.fn(async () => undefined),
      setLogo: jest.fn(async () => undefined),
      getLogo: jest.fn(async () => null),
    } as unknown as jest.Mocked<BrandingRepository>;
    const onChange = jest.fn(async () => undefined);
    return { service: new BrandingService(repo, onChange), repo, onChange };
  };

  it('merges into existing settings (keeps unrelated keys, removes cleared ones) and invalidates the cache', async () => {
    const { service, repo, onChange } = setup();
    await service.update(T, actor, { name: 'New Name', tagline: null, city: 'Riyadh', primaryColor: '#123456', vatNumber: '300000000000003' });
    expect(repo.updateBranding).toHaveBeenCalledWith(T, actor, {
      name: 'New Name',
      vatNumber: '300000000000003',
      brandSettings: { locale: 'ar', primaryColor: '#123456', city: 'Riyadh' },
    });
    expect(onChange).toHaveBeenCalledWith(T);
  });

  it('tolerates non-object stored settings', async () => {
    const { service, repo } = setup(null);
    await service.update(T, actor, { about: 'About us' });
    expect(repo.updateBranding).toHaveBeenCalledWith(T, actor, { brandSettings: { about: 'About us' } });
  });

  it('rejects empty updates, bad VAT numbers and unknown tenants', async () => {
    const { service } = setup();
    await expect(service.update(T, actor, {})).rejects.toMatchObject({ code: 'NOTHING_TO_UPDATE' });
    await expect(service.update(T, actor, { vatNumber: '123' })).rejects.toMatchObject({ code: 'INVALID_VAT_NUMBER' });
    await expect(service.update('other', actor, { name: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(service.get('other')).rejects.toMatchObject({ status: 404 });
    await expect(service.get(T)).resolves.toMatchObject({ slug: 'a' });
  });

  it('accepts a real PNG; rejects SVG, mismatched types, empty and oversized files', async () => {
    const { service, repo } = setup();
    await service.setLogo(T, actor, PNG, 'image/png');
    expect(repo.setLogo).toHaveBeenCalledWith(T, actor, { bytes: PNG, mime: 'image/png' });
    await expect(service.setLogo(T, actor, SVG, 'image/png')).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    await expect(service.setLogo(T, actor, JPEG, 'image/png')).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    await expect(service.setLogo(T, actor, Buffer.alloc(0), 'image/png')).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(service.setLogo(T, actor, Buffer.alloc(MAX_LOGO_BYTES + 1), 'image/png')).rejects.toMatchObject({ code: 'LOGO_TOO_LARGE' });
  });

  it('removes the logo and 404s when there is none', async () => {
    const { service, repo } = setup();
    await service.removeLogo(T, actor);
    expect(repo.setLogo).toHaveBeenCalledWith(T, actor, null);
    await expect(service.getLogo(T)).rejects.toMatchObject({ code: 'LOGO_NOT_FOUND' });
    repo.getLogo.mockResolvedValueOnce({ bytes: PNG, mime: 'image/png', updatedAt: new Date() });
    await expect(service.getLogo(T)).resolves.toMatchObject({ mime: 'image/png' });
  });
});

describe('RegistrationService', () => {
  const input = { academyName: ' New Academy ', slug: 'New-Academy', city: 'Dammam', adminName: ' Admin ', adminEmail: ' Boss@New.test ', password: 'Str0ngPass!' };
  const setup = (enabled = true) => {
    const repo = {
      slugTaken: jest.fn(async (s: string) => s === 'taken'),
      register: jest.fn(async () => ({ tenantId: 'tid' })),
    } as unknown as jest.Mocked<RegistrationRepository>;
    return { service: new RegistrationService(repo, async (p) => `hash(${p})`, enabled), repo };
  };

  it('normalizes input, hashes the password and registers', async () => {
    const { service, repo } = setup();
    await expect(service.register(input)).resolves.toEqual({ tenantId: 'tid', slug: 'new-academy' });
    expect(repo.register).toHaveBeenCalledWith({
      academyName: 'New Academy',
      slug: 'new-academy',
      city: 'Dammam',
      adminName: 'Admin',
      adminEmail: 'boss@new.test',
      passwordHash: 'hash(Str0ngPass!)',
    });
  });

  it('refuses when sign-up is disabled, for reserved and taken slugs, and on a lost race', async () => {
    await expect(setup(false).service.register(input)).rejects.toMatchObject({ status: 403 });
    const { service, repo } = setup();
    await expect(service.register({ ...input, slug: 'dashboard' })).rejects.toMatchObject({ code: 'SLUG_RESERVED' });
    await expect(service.register({ ...input, slug: 'taken' })).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
    repo.register.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(service.register(input)).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
    repo.register.mockRejectedValueOnce(new Error('db down'));
    await expect(service.register(input)).rejects.toThrow('db down');
  });
});
