import { BadgeService, TOKEN_FORMAT, buildVCard, newBadgeToken, type BadgeRepository } from '../../src/modules/badge/badge.service';

describe('badge tokens', () => {
  it('are 22 URL-safe characters (128 random bits) and never repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, newBadgeToken));
    expect(seen.size).toBe(500);
    for (const t of seen) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('TOKEN_FORMAT rejects anything that could be a path, a query or an injection', () => {
    for (const bad of ['', 'short', 'a'.repeat(21), 'a'.repeat(65), 'a/../b'.padEnd(22, 'x'), 'x'.repeat(21) + ' ', "x'; DROP TABLE users;--", '%2e%2e/'.padEnd(22, 'x')]) expect(TOKEN_FORMAT.test(bad)).toBe(false);
    expect(TOKEN_FORMAT.test(newBadgeToken())).toBe(true);
  });
});

describe('buildVCard', () => {
  it('writes a vCard 3.0 with CRLF line endings, the name, the academy and the link', () => {
    const v = buildVCard({ name: 'محمد العتيبي', academyName: 'أكاديمية هيلة', url: 'https://t3leem.my/badge/abc' });
    expect(v).toBe(['BEGIN:VCARD', 'VERSION:3.0', 'FN:محمد العتيبي', 'N:;محمد العتيبي;;;', 'ORG:أكاديمية هيلة', 'TITLE:متدرب', 'URL:https://t3leem.my/badge/abc', 'END:VCARD', ''].join('\r\n'));
  });

  it('escapes what would break a vCard value (commas, semicolons, backslashes, line breaks) so a name cannot add fields', () => {
    const v = buildVCard({ name: 'A, B; C\\D\nE:F\r\nORG:Evil', academyName: 'X;Y', url: 'https://t3leem.my/badge/abc' });
    expect(v).toContain('FN:A\\, B\\; C\\\\D\\nE:F\\nORG:Evil');
    expect(v.split('\r\n').filter((l) => l.startsWith('ORG:'))).toEqual(['ORG:X\\;Y']); // the injected "ORG:" stayed inside the name
    expect(v.split('\r\n').filter((l) => l === 'END:VCARD')).toHaveLength(1);
  });
});

describe('BadgeService', () => {
  const repo = (view: unknown): jest.Mocked<BadgeRepository> =>
    ({ find: jest.fn(), enable: jest.fn(), disable: jest.fn(async () => true), regenerate: jest.fn(), publicView: jest.fn(async () => view) }) as unknown as jest.Mocked<BadgeRepository>;

  it('does not even ask the database for a malformed token', async () => {
    const r = repo({ name: 'x' });
    const s = new BadgeService(r);
    await expect(s.publicView('short')).rejects.toMatchObject({ status: 404, code: 'BADGE_NOT_FOUND' });
    expect(r.publicView).not.toHaveBeenCalled();
  });

  it('hands the repository a fresh token on enable and regenerate', async () => {
    const r = repo(null);
    r.enable.mockResolvedValue({ token: 't', enabled: true });
    r.regenerate.mockResolvedValue({ token: 't', enabled: true });
    let n = 0;
    const s = new BadgeService(r, () => `tok-${++n}`.padEnd(22, '0'));
    await s.enable('T', 'U');
    await s.regenerate('T', 'U');
    expect(r.enable).toHaveBeenCalledWith('T', 'U', 'tok-1'.padEnd(22, '0'));
    expect(r.regenerate).toHaveBeenCalledWith('T', 'U', 'tok-2'.padEnd(22, '0'));
  });
});
