/** HTTP contracts for the endpoints the web frontend uses: tenant branding, catalog, login. */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { COURSE, LEARNER_EMAIL, LEARNER_PASSWORD, TENANT_A, TENANT_B, USER, buildApp, jwtOpts } from './helpers/test-app';

describe('tenant resolution by slug (web frontend)', () => {
  it('resolves x-tenant-slug and echoes the tenant id', async () => {
    const res = await request(buildApp()).get('/api/v1/tenant').set('x-tenant-slug', 'alfaisal');
    expect(res.status).toBe(200);
    expect(res.headers['x-tenant-id']).toBe(TENANT_A);
    expect(res.body).toEqual({
      success: true,
      data: { id: TENANT_A, slug: 'alfaisal', name: 'Al-Faisal', brand_settings: { primaryColor: '#0d6b62' }, logo_version: String(new Date('2026-10-01T00:00:00Z').getTime()) },
    });
  });

  it('does not leak billing identifiers in public branding', async () => {
    const res = await request(buildApp()).get('/api/v1/tenant').set('x-tenant-slug', 'alfaisal');
    expect(JSON.stringify(res.body)).not.toContain('300000000000003');
  });

  it('400 for a malformed slug', async () => {
    const res = await request(buildApp()).get('/api/v1/tenant').set('x-tenant-slug', 'Bad Slug!');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TENANT_SLUG');
  });

  it('400 for an unknown slug', async () => {
    const res = await request(buildApp()).get('/api/v1/tenant').set('x-tenant-slug', 'nope');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TENANT_CONTEXT_MISSING');
  });
});

describe('GET /api/v1/courses', () => {
  it('lists published courses with a VAT-inclusive price breakdown and accreditation data, without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/courses').set('x-tenant-slug', 'alfaisal');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        id: COURSE,
        title: 'PMP',
        type: 'RECORDED',
        price: { net: 1000, vat: 150, total: 1150, currency: 'SAR' },
        training_hours: 35,
        duration_days: 5,
        accreditation_number: 'DEMO-ACC-1',
        trainer_name: 'Khalid',
        module_count: 1,
        lesson_count: 2,
      },
    ]);
  });

  it('course detail includes license, trainer profile and description', async () => {
    const res = await request(buildApp()).get(`/api/v1/courses/${COURSE}`).set('x-tenant-slug', 'alfaisal');
    expect(res.body.data).toMatchObject({
      description: 'Exam prep',
      license: { number: 'DEMO-LIC-1', authority: 'TVTC', expires_on: '2027-06-30' },
      trainer: { full_name: 'Khalid', specialization: 'PM', bio: 'Consultant' },
    });
  });

  it("another academy's catalog does not include tenant A's courses", async () => {
    const res = await request(buildApp()).get('/api/v1/courses').set('x-tenant-slug', 'rukn');
    expect(res.body.data).toEqual([]);
  });

  it('returns the course outline without media URLs', async () => {
    const res = await request(buildApp()).get(`/api/v1/courses/${COURSE}`).set('x-tenant-slug', 'alfaisal');
    expect(res.status).toBe(200);
    expect(res.body.data.modules[0].lessons).toEqual([
      { id: 'e1000000-0000-4000-8000-000000000001', title: 'Intro', content_type: 'VIDEO' },
      { id: 'e1000000-0000-4000-8000-000000000002', title: 'Guide', content_type: 'PDF' },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/media_url|mediaUrl/);
  });

  it('404 for a course of another academy, 422 for a non-UUID id', async () => {
    const other = await request(buildApp()).get(`/api/v1/courses/${COURSE}`).set('x-tenant-id', TENANT_B);
    expect(other.status).toBe(404);
    const bad = await request(buildApp()).get('/api/v1/courses/abc').set('x-tenant-id', TENANT_A);
    expect(bad.status).toBe(422);
  });
});

describe('POST /api/v1/auth/login', () => {
  const login = (body: object, slug = 'alfaisal', app = buildApp()) =>
    request(app).post('/api/v1/auth/login').set('x-tenant-slug', slug).send(body);

  it('issues an RS256 token the API itself accepts', async () => {
    const res = await login({ email: LEARNER_EMAIL, password: LEARNER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({ token_type: 'Bearer', expires_in: 900, user: { id: USER, role: 'LEARNER' } });

    const claims = jwt.verify(res.body.data.access_token, jwtOpts.publicKey, {
      algorithms: ['RS256'],
      issuer: jwtOpts.issuer,
      audience: jwtOpts.audience,
    }) as jwt.JwtPayload;
    expect(claims).toMatchObject({ sub: USER, tid: TENANT_A, role: 'LEARNER' });
  });

  it('accepts the email case-insensitively', async () => {
    const res = await login({ email: '  LEARNER@alfaisal.test ', password: LEARNER_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('gives the same 401 for a wrong password and an unknown email (no enumeration)', async () => {
    const wrong = await login({ email: LEARNER_EMAIL, password: 'nope' });
    const unknown = await login({ email: 'ghost@alfaisal.test', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('the same credentials do not work in another academy', async () => {
    const res = await login({ email: LEARNER_EMAIL, password: LEARNER_PASSWORD }, 'rukn');
    expect(res.status).toBe(401);
  });

  it('422 for an invalid body', async () => {
    const res = await login({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('503 when this deployment has no signing key', async () => {
    const res = await login({ email: LEARNER_EMAIL, password: LEARNER_PASSWORD }, 'alfaisal', buildApp({ signingKey: null }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LOGIN_UNAVAILABLE');
  });

  it('a token from login can complete a checkout end-to-end', async () => {
    const app = buildApp();
    const token = (await login({ email: LEARNER_EMAIL, password: LEARNER_PASSWORD }, 'alfaisal', app)).body.data.access_token;
    const res = await request(app)
      .post('/api/v1/enrollments/checkout')
      .set('x-tenant-slug', 'alfaisal')
      .set('Authorization', `Bearer ${token}`)
      .send({ course_id: COURSE, payment_method: 'MADA', payment_token: 'tok_sandbox' });
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.total_amount).toBe(1150);
  });
});
