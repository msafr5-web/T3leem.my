import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM field encryption (CLAUDE.md §3C). Output: "v1.<iv>.<tag>.<ciphertext>" (base64url).
 * GCM authenticates the data: a tampered or wrong-key value fails to decrypt instead of
 * returning garbage. A fresh 96-bit IV per value means equal plaintexts never look equal.
 */
export class FieldCipher {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('FieldCipher key must be 32 bytes');
  }

  encrypt(plain: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  decrypt(sealed: string): Buffer {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  }
}

/**
 * Compact HMAC-SHA256 signed tokens: "<base64url(json)>.<base64url(sig)>".
 * Used for short-lived media URLs that the browser's video player fetches without cookies.
 */
export class HmacTokens<T extends { exp: number }> {
  constructor(private readonly secret: string) {}

  sign(payload: T): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  /** Returns the payload only if the signature matches and it hasn't expired. */
  verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): T | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
      return typeof payload.exp === 'number' && payload.exp > nowSeconds ? payload : null;
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
