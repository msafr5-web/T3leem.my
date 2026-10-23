import { randomBytes } from 'node:crypto';
import { generateCertificateCode, normalizeCertificateCode } from '../../src/modules/lms/learning/learning.service';
import { parsePlaylistDuration, signPlaylist } from '../../src/modules/lms/media/transcoder';
import { looksLikeVideo } from '../../src/modules/lms/media/video.service';
import { FieldCipher, HmacTokens } from '../../src/shared/utils/crypto';

describe('FieldCipher (AES-256-GCM)', () => {
  const cipher = new FieldCipher(randomBytes(32).toString('base64'));

  it('round-trips and never produces the same ciphertext twice', () => {
    const key = randomBytes(16);
    const a = cipher.encrypt(key);
    const b = cipher.encrypt(key);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(a)).toEqual(key);
  });

  it('detects tampering and wrong keys (authenticated encryption)', () => {
    const sealed = cipher.encrypt(Buffer.from('secret'));
    const parts = sealed.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('evil').toString('base64url')].join('.');
    expect(() => cipher.decrypt(tampered)).toThrow();
    expect(() => new FieldCipher(randomBytes(32).toString('base64')).decrypt(sealed)).toThrow();
    expect(() => cipher.decrypt('v2.a.b.c')).toThrow('Unsupported');
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new FieldCipher(randomBytes(16).toString('base64'))).toThrow('32 bytes');
  });
});

describe('HmacTokens', () => {
  const tokens = new HmacTokens<{ l: string; exp: number }>('a-very-long-secret-for-signing-tokens');

  it('verifies its own tokens until they expire', () => {
    const t = tokens.sign({ l: 'lesson', exp: 1000 });
    expect(tokens.verify(t, 999)).toEqual({ l: 'lesson', exp: 1000 });
    expect(tokens.verify(t, 1000)).toBeNull();
  });

  it('rejects forged payloads, foreign signatures and garbage', () => {
    const t = tokens.sign({ l: 'lesson', exp: 9_999_999_999 });
    const [, sig] = t.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ l: 'other', exp: 9_999_999_999 })).toString('base64url');
    expect(tokens.verify(`${forgedBody}.${sig}`)).toBeNull();
    expect(new HmacTokens('another-secret-entirely-different-0000').verify(t)).toBeNull();
    expect(tokens.verify('garbage')).toBeNull();
    expect(tokens.verify('')).toBeNull();
    const nonJson = `${Buffer.from('not json').toString('base64url')}`;
    expect(tokens.verify(`${nonJson}.x`)).toBeNull();
  });
});

describe('HLS playlist helpers', () => {
  const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6.000,\nseg_0000.ts\n#EXTINF:3.500,\nseg_0001.ts\n#EXT-X-ENDLIST\n';

  it('signs the key URI and every segment with the viewer token', () => {
    const signed = signPlaylist(playlist, 'tok/en+1');
    expect(signed).toContain('URI="key?token=tok%2Fen%2B1"');
    expect(signed).toContain('segments/seg_0000.ts?token=tok%2Fen%2B1');
    expect(signed).toContain('segments/seg_0001.ts?token=tok%2Fen%2B1');
    expect(signed).not.toMatch(/^seg_/m);
  });

  it('sums segment durations', () => {
    expect(parsePlaylistDuration(playlist)).toBeCloseTo(9.5);
  });

  it('recognizes MP4/MOV and WebM/MKV signatures only', () => {
    expect(looksLikeVideo(Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))).toBe(true);
    expect(looksLikeVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]))).toBe(true);
    expect(looksLikeVideo(Buffer.from('<html><script>'))).toBe(false);
    expect(looksLikeVideo(Buffer.alloc(2))).toBe(false);
  });
});

describe('certificate codes', () => {
  it('have the T3L-XXXX-XXXX shape without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(generateCertificateCode()).toMatch(/^T3L-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(generateCertificateCode(() => 0)).toBe('T3L-2222-2222');
  });

  it('normalize user input', () => {
    expect(normalizeCertificateCode('  t3l-7k2m-q9xd ')).toBe('T3L-7K2M-Q9XD');
  });
});
