/** HTTP contracts for the provider directory, public provider data, and the provider dashboard. */
import request from 'supertest';
import { COURSE, TENANT_A, TENANT_B, TRAINER, USER, adminToken, buildApp, learnerToken, sign } from './helpers/test-app';

const admin = (method: 'get' | 'post' | 'put', path: string, token = adminToken, tenant = TENANT_A) =>
  request(buildApp())[method](`/api/v1/admin${path}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`);

describe('GET /api/v1/platform/providers (no tenant needed)', () => {
  it('lists active providers with public fields only', async () => {
    const res = await request(buildApp()).get('/api/v1/platform/providers');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { slug: 'rukn', name: 'Rukn', tagline: 'Pro training', city: 'Riyadh', primary_color: '#0d6b62', logo_version: null, health_sectors: 6 },
      { slug: 'masar', name: 'Masar Training', tagline: null, city: null, primary_color: null, logo_version: null, health_sectors: 0 },
    ]);
  });
});

describe('public provider data', () => {
  it('plans include total training hours', async () => {
    const res = await request(buildApp()).get('/api/v1/plans').set('x-tenant-slug', 'rukn');
    expect(res.body.data[0]).toMatchObject({ title: 'Leadership', type: 'DEVELOPMENT', total_hours: 35 });
  });

  it('public trainers never expose email or account status', async () => {
    const res = await request(buildApp()).get('/api/v1/trainers').set('x-tenant-slug', 'rukn');
    expect(res.body.data).toEqual([{ id: TRAINER, full_name: 'Khalid', specialization: 'PM', bio: 'Consultant', course_count: 1 }]);
  });

  it('upcoming classrooms never expose the join link publicly', async () => {
    const res = await request(buildApp()).get('/api/v1/classrooms/upcoming').set('x-tenant-slug', 'rukn');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).not.toHaveProperty('join_url');
  });

  it("another provider sees none of tenant A's data", async () => {
    const res = await request(buildApp()).get('/api/v1/trainers').set('x-tenant-slug', 'masar');
    expect(res.body.data).toEqual([]);
  });
});

describe('provider dashboard access control', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/v1/admin/overview').set('x-tenant-id', TENANT_A);
    expect(res.status).toBe(401);
  });

  it('403 for a learner', async () => {
    expect((await admin('get', '/overview', learnerToken)).status).toBe(403);
  });

  it("403 for tenant A's admin on tenant B's dashboard", async () => {
    expect((await admin('get', '/overview', adminToken, TENANT_B)).status).toBe(403);
  });

  it('403 for an instructor', async () => {
    const instructor = sign({ sub: USER, tid: TENANT_A, role: 'INSTRUCTOR' });
    expect((await admin('get', '/courses', instructor)).status).toBe(403);
  });
});

describe('provider dashboard', () => {
  it('overview returns counts, revenue and upcoming sessions with links', async () => {
    const res = await admin('get', '/overview');
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toEqual({ courses: 1, published_courses: 1, trainers: 1, trainees: 2, active_plans: 1, enrollments: 1 });
    expect(res.body.data.revenue_total).toBe(1150);
    expect(res.body.data.upcoming_classrooms[0].join_url).toBe('https://example.com/join/demo');
  });

  it('lists courses with license, accreditation and hours', async () => {
    const res = await admin('get', '/courses');
    expect(res.body.data[0]).toMatchObject({
      license: { number: 'DEMO-LIC-1', authority: 'TVTC', expires_on: '2027-06-30' },
      accreditation_number: 'DEMO-ACC-1',
      training_hours: 35,
      duration_days: 5,
      price: { net: 1000, vat: 150, total: 1150 },
    });
  });

  const validCourse = {
    title: 'Risk Management',
    type: 'RECORDED',
    price: 1200,
    trainer_id: TRAINER,
    license_number: 'DEMO-LIC-9',
    license_authority: 'TVTC',
    license_expires_on: '2027-12-31',
    accreditation_number: 'DEMO-ACC-9',
    training_hours: 21,
    duration_days: 3,
    is_published: false,
  };

  it('creates a course (201)', async () => {
    const res = await admin('post', '/courses').send(validCourse);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: 'c-new' });
  });

  it("rejects a trainer that belongs to another provider (FK checks bypass RLS)", async () => {
    const res = await admin('post', '/courses').send({ ...validCourse, trainer_id: '0b9f4e6a-0000-4000-8000-00000000dead' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNKNOWN_TRAINER');
  });

  it('validates course fields', async () => {
    const res = await admin('post', '/courses').send({ ...validCourse, title: 'x', training_hours: -2, license_expires_on: '31/12/2027' });
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'training_hours', 'license_expires_on']));
  });

  it('updates a course partially; 404 for an unknown one', async () => {
    expect((await admin('put', `/courses/${COURSE}`).send({ is_published: false })).status).toBe(200);
    expect((await admin('put', '/courses/c0a80121-0000-4000-8000-000000000999').send({ is_published: true })).status).toBe(404);
  });

  it('adds a trainer without a login account', async () => {
    const res = await admin('post', '/trainers').send({ full_name: 'Sara Alghamdi', specialization: 'Cybersecurity' });
    expect(res.status).toBe(201);
  });

  it('adds a trainee; 409 when the email already exists', async () => {
    expect((await admin('post', '/trainees').send({ email: 'new@a.test', full_name: 'New Trainee', password: 'Str0ngPass!' })).status).toBe(201);
    const dup = await admin('post', '/trainees').send({ email: 'learner@rukn.test', full_name: 'Dup', password: 'Str0ngPass!' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects weak trainee passwords', async () => {
    expect((await admin('post', '/trainees').send({ email: 'x@a.test', full_name: 'Weak One', password: '123' })).status).toBe(422);
  });

  it('creates a plan from own courses; rejects foreign course ids and inverted periods', async () => {
    const base = { title: 'Digital Plan', type: 'TRAINING', starts_on: '2027-01-01', ends_on: '2027-03-31', course_ids: [COURSE] };
    expect((await admin('post', '/plans').send(base)).status).toBe(201);
    const foreign = await admin('post', '/plans').send({ ...base, course_ids: ['c0a80121-0000-4000-8000-00000000beef'] });
    expect(foreign.body.error.code).toBe('UNKNOWN_COURSE');
    const inverted = await admin('post', '/plans').send({ ...base, starts_on: '2027-05-01', ends_on: '2027-01-01' });
    expect(inverted.body.error.code).toBe('INVALID_PERIOD');
  });

  it('schedules a classroom in the future with an https link only', async () => {
    const base = { title: 'Live Q&A', starts_at: '2026-11-01T15:00:00Z', duration_minutes: 60, course_id: COURSE, trainer_id: TRAINER, provider: 'ZOOM' };
    expect((await admin('post', '/classrooms').send({ ...base, join_url: 'https://zoom.us/j/123' })).status).toBe(201);
    expect((await admin('post', '/classrooms').send({ ...base, join_url: 'javascript:alert(1)' })).status).toBe(422);
    const past = await admin('post', '/classrooms').send({ ...base, starts_at: '2026-01-01T15:00:00Z' });
    expect(past.body.error.code).toBe('START_IN_PAST');
  });

  it('lists trainees, trainers (with emails), plans and classrooms', async () => {
    expect((await admin('get', '/trainees')).body.data[0]).toMatchObject({ email: 'learner@rukn.test', enrollment_count: 1 });
    expect((await admin('get', '/trainers')).body.data[0]).toMatchObject({ email: 'k@a.test', has_account: true });
    expect((await admin('get', '/plans')).body.data).toHaveLength(1);
    expect((await admin('get', '/classrooms')).body.data[0].join_url).toBe('https://example.com/join/demo');
    expect((await admin('get', `/courses/${COURSE}`)).status).toBe(200);
  });
});
