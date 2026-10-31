import { BrandingService, MAX_LOGO_BYTES, sniffImage, type BrandingRepository } from '../../src/modules/tenant/branding.service';
import { buildRegistrationFakes } from '../integration/helpers/registration-fakes';

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

describe('RegistrationService (e-mail code)', () => {
  const input = { academyName: ' New Academy ', slug: 'New-Academy', city: 'Dammam', adminName: ' Admin ', adminEmail: ' Boss@New.test ', phone: null };
  const setup = (enabled = true) => buildRegistrationFakes({ enabled });

  it('start stores a normalized pending sign-up and e-mails the code with the site data; nothing is created yet', async () => {
    const { service, repository, mailer } = setup();
    const r = await service.start(input);
    expect(r).toMatchObject({ email: 'boss@new.test', expiresInSec: 900 });
    expect(repository.registered).toHaveLength(0);
    const row = repository.pending.get(r.pendingId)!;
    expect(row).toMatchObject({ slug: 'new-academy', academyName: 'New Academy', adminName: 'Admin', passwordHash: expect.stringMatching(/^hashed:/) });
    // The code itself is never stored, only its salted hash.
    expect(JSON.stringify(row)).not.toContain(mailer.lastCode);

    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe('boss@new.test');
    expect(mailer.lastCode).toMatch(/^\d{6}$/);
    for (const part of ['New Academy', 'https://t3leem.my/new-academy', 'https://t3leem.my/new-academy/dashboard', 'boss@new.test', 'Dammam']) {
      expect(mail.text).toContain(part);
      expect(mail.html).toContain(part);
    }
  });

  it('escapes the academy name in the HTML body', async () => {
    const { service, mailer } = setup();
    await service.start({ ...input, academyName: 'A <script>x</script> & Co' });
    expect(mailer.sent[0]!.html).toContain('A &lt;script&gt;x&lt;/script&gt; &amp; Co');
    expect(mailer.sent[0]!.html).not.toContain('<script>');
  });

  it('verify with the right code creates the academy once', async () => {
    const { service, repository, mailer } = setup();
    const { pendingId } = await service.start(input);
    await expect(service.verify(pendingId, mailer.lastCode)).resolves.toEqual({ tenantId: 'new-tenant-id', slug: 'new-academy' });
    expect(repository.registered).toEqual([{ academyName: 'New Academy', slug: 'new-academy', city: 'Dammam', adminName: 'Admin', adminEmail: 'boss@new.test', phone: null, passwordHash: expect.stringMatching(/^hashed:/) }]);
    await expect(service.verify(pendingId, mailer.lastCode)).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
    expect(repository.registered).toHaveLength(1);
  });

  it('a wrong code is refused and counted; five wrong codes lock the sign-up even for the right one', async () => {
    const { service, mailer, repository } = setup();
    const { pendingId } = await service.start(input);
    const wrong = mailer.lastCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(service.verify(pendingId, wrong)).rejects.toMatchObject({ code: 'CODE_INVALID' });
    await expect(service.verify(pendingId, mailer.lastCode)).rejects.toMatchObject({ status: 429, code: 'TOO_MANY_ATTEMPTS' });
    expect(repository.registered).toHaveLength(0);
  });

  it('the code expires after 15 minutes', async () => {
    const { service, mailer, clock } = setup();
    const { pendingId } = await service.start(input);
    clock.now = new Date(clock.now.getTime() + 15 * 60_000 + 1);
    await expect(service.verify(pendingId, mailer.lastCode)).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
    await expect(service.verify('00000000-0000-4000-8000-000000000000', '123456')).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
  });

  it('resend: cooldown, a new code replaces the old one, and at most three sends', async () => {
    const { service, mailer, clock } = setup();
    const { pendingId } = await service.start(input);
    const first = mailer.lastCode;
    await expect(service.resend(pendingId)).rejects.toMatchObject({ status: 429, code: 'RESEND_TOO_SOON' });
    clock.now = new Date(clock.now.getTime() + 61_000);
    await service.resend(pendingId);
    expect(mailer.sent).toHaveLength(2);
    if (mailer.lastCode !== first) await expect(service.verify(pendingId, first)).rejects.toMatchObject({ code: 'CODE_INVALID' });
    clock.now = new Date(clock.now.getTime() + 61_000);
    await service.resend(pendingId);
    clock.now = new Date(clock.now.getTime() + 61_000);
    await expect(service.resend(pendingId)).rejects.toMatchObject({ status: 429, code: 'TOO_MANY_ATTEMPTS' });
  });

  it('refuses when sign-up is disabled, for reserved and taken slugs, and when the e-mail cannot be sent', async () => {
    await expect(setup(false).service.start(input)).rejects.toMatchObject({ status: 403 });
    const { service, repository, mailer } = setup();
    await expect(service.start({ ...input, slug: 'dashboard' })).rejects.toMatchObject({ code: 'SLUG_RESERVED' });
    await expect(service.start({ ...input, slug: 'rukn' })).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
    mailer.failNext = true;
    await expect(service.start(input)).rejects.toMatchObject({ status: 503, code: 'MAIL_UNAVAILABLE' });
    expect(repository.pending.size).toBe(0); // no orphan row when nothing could be sent
  });

  it('the slug may be health (it is no longer reserved)', async () => {
    const { service } = setup();
    await expect(service.start({ ...input, slug: 'health' })).resolves.toMatchObject({ email: 'boss@new.test' });
  });

  it('throttles repeated starts for one e-mail', async () => {
    const { service } = setup();
    for (let i = 0; i < 5; i++) await service.start({ ...input, slug: `academy-${i}` });
    await expect(service.start({ ...input, slug: 'academy-9' })).rejects.toMatchObject({ status: 429 });
  });

  it('a lost slug race at verification time becomes SLUG_TAKEN', async () => {
    const { service, repository, mailer } = setup();
    const { pendingId } = await service.start(input);
    repository.failRegisterWith = Object.assign(new Error('dup'), { code: 'P2002' });
    await expect(service.verify(pendingId, mailer.lastCode)).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
  });
});
