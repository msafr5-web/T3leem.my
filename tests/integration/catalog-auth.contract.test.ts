/** HTTP contracts for the endpoints the web frontend uses: tenant branding, catalog, login. */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { COURSE, LEARNER_EMAIL, LEARNER_PASSWORD, TENANT_A, TENANT_B, USER, buildApp, jwtOpts } from './helpers/test-app';

describe('tenant resolution by slug (web frontend)', () => {
  it('resolves x-tenant-slug and echoes the tenant id', async () => {
    const res = await request(buildApp()).get('/api/v1/tenant').set('x-tenant-slug', 'rukn');
    expect(res.status).toBe(200);
    expect(res.headers['x-tenant-id']).toBe(TENANT_A);
    expect(res.body).toEqual({
      success: true,
      data: { id: TENANT_A, slug: 'rukn', name: 'Rukn', brand_settings: { primaryColor: '#0d6b62' }, logo_version: String(new Date('2026-10-01T00:00:00Z').getTime()) },
    });
  });

  it('does not leak billing identifiers in public branding', async () => {
    const res = await request(buildApp()).get('/api/v1/tenant').set('x-tenant-slug', 'rukn');
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
    const res = await request(buildApp()).get('/api/v1/courses').set('x-tenant-slug', 'rukn');
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
    const res = await request(buildApp()).get(`/api/v1/courses/${COURSE}`).set('x-tenant-slug', 'rukn');
    expect(res.body.data).toMatchObject({
      description: 'Exam prep',
      license: { number: 'DEMO-LIC-1', authority: 'TVTC', expires_on: '2027-06-30' },
      trainer: { full_name: 'Khalid', specialization: 'PM', bio: 'Consultant' },
    });
  });

  it("another academy's catalog does not include tenant A's courses", async () => {
    const res = await request(buildApp()).get('/api/v1/courses').set('x-tenant-slug', 'masar');
    expect(res.body.data).toEqual([]);
  });

  it('returns the course outline without media URLs', async () => {
    const res = await request(buildApp()).get(`/api/v1/courses/${COURSE}`).set('x-tenant-slug', 'rukn');
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

describe('e-mail code sign-in (POST /api/v1/auth/otp/*)', () => {
  type Otp = ReturnType<typeof import('./helpers/owner-fakes').buildOtpFakes>;
  const otpOf = (app: ReturnType<typeof buildApp>) => app.locals.otp as Otp;
  const post = (app: ReturnType<typeof buildApp>, path: string, body: object, slug = 'rukn') => request(app).post(`/api/v1/auth/otp/${path}`).set('x-tenant-slug', slug).send(body);
  const request_ = (app: ReturnType<typeof buildApp>, email: string, slug = 'rukn') => post(app, 'request', { email }, slug);

  it('request e-mails a 6-digit code, verify issues an RS256 token the API itself accepts', async () => {
    const app = buildApp();
    const r = await request_(app, LEARNER_EMAIL);
    expect(r.status).toBe(202);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(otpOf(app).mailer.sent).toHaveLength(1);
    expect(otpOf(app).mailer.sent[0]!.to).toBe(LEARNER_EMAIL);
    expect(otpOf(app).mailer.lastCode).toMatch(/^\d{6}$/);

    const res = await post(app, 'verify', { challenge_id: r.body.data.challenge_id, code: otpOf(app).mailer.lastCode });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ token_type: 'Bearer', expires_in: 900, user: { id: USER, role: 'LEARNER' } });
    const claims = jwt.verify(res.body.data.access_token, jwtOpts.publicKey, { algorithms: ['RS256'], issuer: jwtOpts.issuer, audience: jwtOpts.audience }) as jwt.JwtPayload;
    expect(claims).toMatchObject({ sub: USER, tid: TENANT_A, role: 'LEARNER' });
  });

  it('accepts the e-mail case-insensitively; the code works once', async () => {
    const app = buildApp();
    const r = await request_(app, '  LEARNER@rukn.test ');
    const code = otpOf(app).mailer.lastCode;
    expect((await post(app, 'verify', { challenge_id: r.body.data.challenge_id, code })).status).toBe(200);
    expect((await post(app, 'verify', { challenge_id: r.body.data.challenge_id, code })).body.error.code).toBe('OTP_INVALID');
  });

  it('an unknown address gets the same answer and no e-mail (no account enumeration)', async () => {
    const app = buildApp();
    const known = await request_(app, LEARNER_EMAIL);
    const unknown = await request_(app, 'ghost@rukn.test');
    expect(unknown.status).toBe(known.status);
    expect(Object.keys(unknown.body.data)).toEqual(Object.keys(known.body.data));
    expect(otpOf(app).mailer.sent.map((m) => m.to)).toEqual([LEARNER_EMAIL]);
    const verify = await post(app, 'verify', { challenge_id: unknown.body.data.challenge_id, code: '123456' });
    expect(verify.body.error.code).toBe('OTP_INVALID');
  });

  it('a wrong code is refused; the code does not work in another academy', async () => {
    const app = buildApp();
    const r = await request_(app, LEARNER_EMAIL);
    const code = otpOf(app).mailer.lastCode;
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await post(app, 'verify', { challenge_id: r.body.data.challenge_id, code: wrong })).body.error.code).toBe('OTP_INVALID');
    expect((await post(app, 'verify', { challenge_id: r.body.data.challenge_id, code }, 'masar')).body.error.code).toBe('OTP_INVALID');
    expect((await post(app, 'verify', { challenge_id: r.body.data.challenge_id, code })).status).toBe(200);
  });

  it('the same address has no account in another academy (no e-mail sent)', async () => {
    const app = buildApp();
    expect((await request_(app, LEARNER_EMAIL, 'masar')).status).toBe(202);
    expect(otpOf(app).mailer.sent).toHaveLength(0);
  });

  it('there is no password sign-in any more', async () => {
    const res = await request(buildApp()).post('/api/v1/auth/login').set('x-tenant-slug', 'rukn').send({ email: LEARNER_EMAIL, password: LEARNER_PASSWORD });
    expect(res.status).toBe(404);
  });

  it('422 for an invalid body; 503 without a signing key or without mail', async () => {
    const app = buildApp();
    expect((await post(app, 'request', { email: 'not-an-email' })).status).toBe(422);
    expect((await post(app, 'verify', { challenge_id: 'x', code: '12' })).status).toBe(422);
    expect((await request_(buildApp({ signingKey: null }), LEARNER_EMAIL)).body.error.code).toBe('LOGIN_UNAVAILABLE');
    const broken = buildApp();
    otpOf(broken).mailer.failNext = true;
    expect((await request_(broken, LEARNER_EMAIL)).body.error.code).toBe('MAIL_UNAVAILABLE');
  });

  it('register creates the account without a session; signing in then needs the e-mailed code', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/v1/auth/register').set('x-tenant-slug', 'rukn').send({ full_name: 'Reem Saleh', email: 'reem@rukn.test' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ email: 'reem@rukn.test' });
    expect(res.body.data).not.toHaveProperty('access_token');
    const dup = await request(app).post('/api/v1/auth/register').set('x-tenant-slug', 'rukn').send({ full_name: 'Abdullah A.', email: LEARNER_EMAIL });
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('a token from the code sign-in can complete a checkout end-to-end', async () => {
    const app = buildApp();
    const r = await request_(app, LEARNER_EMAIL);
    const token = (await post(app, 'verify', { challenge_id: r.body.data.challenge_id, code: otpOf(app).mailer.lastCode })).body.data.access_token;
    const res = await request(app)
      .post('/api/v1/enrollments/checkout')
      .set('x-tenant-slug', 'rukn')
      .set('Authorization', `Bearer ${token}`)
      .send({ course_id: COURSE, payment_method: 'MADA', payment_token: 'tok_sandbox' });
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.total_amount).toBe(1150);
  });
});
