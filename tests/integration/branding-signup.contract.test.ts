/** HTTP contracts: academy branding (PRD PUT /tenant/branding), logo upload, provider sign-up, dashboard edit/delete. */
import request from 'supertest';
import { COURSE, TENANT_A, TRAINER, USER, adminToken, buildApp, learnerToken } from './helpers/test-app';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

const as = (token: string) => (method: 'get' | 'put' | 'post' | 'delete', path: string, app = buildApp()) =>
  request(app)[method](`/api/v1${path}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`);
const admin = as(adminToken);

describe('academy branding', () => {
  it('public GET /tenant includes a logo version for cache-busting', async () => {
    const res = await request(buildApp()).get('/api/v1/tenant').set('x-tenant-slug', 'rukn');
    expect(res.body.data.logo_version).toBe(String(new Date('2026-10-01T00:00:00Z').getTime()));
  });

  it('only the academy admin can read or change branding', async () => {
    expect((await as(learnerToken)('get', '/tenant/branding')).status).toBe(403);
    expect((await as(learnerToken)('put', '/tenant/branding').send({ name: 'Hacked' })).status).toBe(403);
    expect((await request(buildApp()).put('/api/v1/tenant/branding').set('x-tenant-id', TENANT_A).send({ name: 'x' })).status).toBe(401);
  });

  it('updates identity and billing profile, then reads it back', async () => {
    const app = buildApp();
    const res = await admin('put', '/tenant/branding', app).send({ name: 'Rukn Academy', tagline: 'New tagline', city: 'Riyadh', primary_color: '#112233', vat_number: '300000000000003' });
    expect(res.status).toBe(200);
    const read = await admin('get', '/tenant/branding', app);
    expect(read.body.data).toMatchObject({ name: 'Rukn Academy', tagline: 'New tagline', city: 'Riyadh', primary_color: '#112233', vat_number: '300000000000003', has_logo: false });
  });

  it('validates colors and VAT numbers', async () => {
    const res = await admin('put', '/tenant/branding').send({ primary_color: 'red', vat_number: '12345' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['primary_color', 'vat_number']));
  });

  it('uploads a PNG logo as a raw body and serves it back with safe headers', async () => {
    const app = buildApp();
    const up = await admin('put', '/tenant/branding/logo', app).set('Content-Type', 'image/png').send(PNG);
    expect(up.status).toBe(200);
    const logo = await request(app).get('/api/v1/tenant/logo').set('x-tenant-slug', 'rukn');
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(logo.body)).toEqual(PNG);
    expect((await admin('delete', '/tenant/branding/logo', app)).status).toBe(204);
    expect((await request(app).get('/api/v1/tenant/logo').set('x-tenant-slug', 'rukn')).status).toBe(404);
  });

  it('rejects an SVG disguised as PNG, and files over 512 KB', async () => {
    const svg = await admin('put', '/tenant/branding/logo').set('Content-Type', 'image/png').send(SVG);
    expect(svg.status).toBe(422);
    expect(svg.body.error.code).toBe('UNSUPPORTED_IMAGE');
    const big = await admin('put', '/tenant/branding/logo').set('Content-Type', 'image/png').send(Buffer.concat([PNG, Buffer.alloc(600 * 1024)]));
    expect(big.status).toBe(413);
  });
});

describe('POST /api/v1/platform/providers (self-service sign-up)', () => {
  const valid = { academy_name: 'Dammam Skills', slug: 'dammam-skills', city: 'Dammam', admin_name: 'Faisal Admin', admin_email: 'boss@dammam.test', password: 'Str0ngPass!', accept_terms: true };
  const signup = (body: object, app = buildApp()) => request(app).post('/api/v1/platform/providers').send(body);

  it('creates an academy (201) without any tenant context', async () => {
    const res = await signup(valid);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ tenant_id: 'new-tenant-id', slug: 'dammam-skills' });
  });

  it('409 for a taken slug, 422 for reserved or malformed slugs', async () => {
    expect((await signup({ ...valid, slug: 'rukn' })).body.error.code).toBe('SLUG_TAKEN');
    expect((await signup({ ...valid, slug: 'dashboard' })).body.error.code).toBe('SLUG_RESERVED');
    expect((await signup({ ...valid, slug: '-bad slug-' })).status).toBe(422);
  });

  it('requires accepted terms and a strong-enough password', async () => {
    const res = await signup({ ...valid, accept_terms: false, password: '123' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['accept_terms', 'password']));
  });

  it('403 when sign-up is disabled', async () => {
    expect((await signup(valid, buildApp({ signupEnabled: false }))).status).toBe(403);
  });
});

describe('dashboard edit / delete', () => {
  it('courses with enrollments cannot be deleted (409); unknown ones 404', async () => {
    expect((await admin('delete', `/admin/courses/${COURSE}`)).body.error.code).toBe('COURSE_HAS_ENROLLMENTS');
    expect((await admin('delete', '/admin/courses/c0a80121-0000-4000-8000-000000000999')).status).toBe(404);
  });

  it('trainers: update (200), delete blocked while assigned to courses (409)', async () => {
    expect((await admin('put', `/admin/trainers/${TRAINER}`).send({ specialization: 'PMP' })).status).toBe(200);
    expect((await admin('delete', `/admin/trainers/${TRAINER}`)).body.error.code).toBe('TRAINER_IN_USE');
  });

  it('trainees: rename (200), delete blocked with enrollments (409)', async () => {
    expect((await admin('put', `/admin/trainees/${USER}`).send({ full_name: 'Abdullah A.' })).status).toBe(200);
    expect((await admin('delete', `/admin/trainees/${USER}`)).body.error.code).toBe('TRAINEE_HAS_ENROLLMENTS');
  });

  it('plans: update and delete', async () => {
    const id = 'a2000000-0000-4000-8000-000000000001';
    expect((await admin('put', `/admin/plans/${id}`).send({ status: 'ARCHIVED', course_ids: [COURSE] })).status).toBe(200);
    expect((await admin('delete', `/admin/plans/${id}`)).status).toBe(204);
  });

  it('classrooms: read, reschedule, cancel, delete; integrations flag', async () => {
    const id = 'a3000000-0000-4000-8000-000000000001';
    expect((await admin('get', `/admin/classrooms/${id}`)).body.data.join_url).toBe('https://example.com/join/demo');
    expect((await admin('put', `/admin/classrooms/${id}`).send({ starts_at: '2026-12-01T15:00:00Z', duration_minutes: 90 })).status).toBe(200);
    expect((await admin('put', `/admin/classrooms/${id}`).send({ status: 'CANCELLED' })).status).toBe(200);
    expect((await admin('put', `/admin/classrooms/${id}`).send({ status: 'POSTPONED' })).status).toBe(422);
    expect((await admin('delete', `/admin/classrooms/${id}`)).status).toBe(204);
    expect((await admin('get', '/admin/integrations')).body.data).toEqual({ zoom: false });
  });
});
