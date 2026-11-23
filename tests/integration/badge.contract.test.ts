/** The trainee's optional public digital badge: HTTP contracts (in-memory data). */
import request from 'supertest';
import { TENANT_A, adminToken, buildApp, learnerToken } from './helpers/test-app';

type App = ReturnType<typeof buildApp>;
const mine = (app: App, token = learnerToken) => ({
  get: () => request(app).get('/api/v1/me/badge').set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  post: (path = '') => request(app).post(`/api/v1/me/badge${path}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  del: () => request(app).delete('/api/v1/me/badge').set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
});
const pub = (app: App, token: string, suffix = '') => request(app).get(`/api/v1/badges/${token}${suffix}`);

describe('turning the badge on and off', () => {
  it('has no badge until the trainee turns it on; then gives an unguessable link token', async () => {
    const app = buildApp();
    expect((await mine(app).get()).body.data).toEqual({ enabled: false, token: null });
    const on = await mine(app).post();
    expect(on.status).toBe(200);
    expect(on.headers['cache-control']).toBe('no-store');
    expect(on.body.data.enabled).toBe(true);
    expect(on.body.data.token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 bits, URL-safe
    expect((await mine(app).get()).body.data).toEqual(on.body.data);
  });

  it('turning it on again keeps the same link; turning it off makes the page disappear; turning it on restores the same link', async () => {
    const app = buildApp();
    const { token } = (await mine(app).post()).body.data;
    expect((await mine(app).post()).body.data.token).toBe(token);
    expect((await pub(app, token)).status).toBe(200);
    expect((await mine(app).del()).status).toBe(204);
    expect((await pub(app, token)).status).toBe(404);
    expect((await mine(app).get()).body.data).toEqual({ enabled: false, token });
    expect((await mine(app).post()).body.data).toEqual({ enabled: true, token });
    expect((await pub(app, token)).status).toBe(200);
  });

  it('a new link replaces the old one at once (for a link shared by mistake)', async () => {
    const app = buildApp();
    const { token } = (await mine(app).post()).body.data;
    const fresh = (await mine(app).post('/regenerate')).body.data;
    expect(fresh.token).not.toBe(token);
    expect((await pub(app, token)).status).toBe(404);
    expect((await pub(app, fresh.token)).status).toBe(200);
  });

  it('turning off a badge that was never turned on is 404; anyone signed in manages only their own; no token is 401', async () => {
    const app = buildApp();
    expect((await mine(app).del()).body.error.code).toBe('BADGE_NOT_FOUND');
    const a = (await mine(app).post()).body.data.token;
    const b = (await mine(app, adminToken).post()).body.data.token; // another account of the same academy: its own badge
    expect(a).not.toBe(b);
    expect((await request(app).get('/api/v1/me/badge').set('x-tenant-id', TENANT_A)).status).toBe(401);
  });
});

describe('the public badge page (no sign-in)', () => {
  it('shows only the name, the academy and the verifiable certificates; nothing personal beyond that', async () => {
    const app = buildApp();
    const { token } = (await mine(app).post()).body.data;
    const res = await pub(app, token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=60');
    expect(res.body.data).toEqual({
      name: 'Abdullah',
      academy: { name: 'Rukn', slug: 'rukn' },
      certificates: [{ code: 'CERT-ABCD1234', course_title: 'PMP', issued_at: '2026-10-30T00:00:00.000Z' }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/email|phone|national|employee|@/i);
  });

  it('answers 404 the same way for unknown, malformed and switched-off tokens', async () => {
    const app = buildApp();
    const { token } = (await mine(app).post()).body.data;
    await mine(app).del();
    for (const t of [token, 'A'.repeat(22), 'short', 'x'.repeat(100), '..%2f..']) {
      const r = await pub(app, t);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('BADGE_NOT_FOUND');
    }
  });

  it('gives a contact card (.vcf) with the name, academy and badge link, and no phone or e-mail', async () => {
    const app = buildApp();
    const { token } = (await mine(app).post()).body.data;
    const res = await pub(app, token, '/vcard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/vcard');
    expect(res.headers['content-disposition']).toContain('badge.vcf');
    const text = res.text;
    expect(text.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(text).toContain('FN:Abdullah');
    expect(text).toContain('ORG:Rukn');
    expect(text).toContain(`/badge/${token}`);
    expect(text).not.toMatch(/EMAIL|TEL/);
    expect((await pub(app, 'A'.repeat(22), '/vcard')).status).toBe(404);
  });
});
