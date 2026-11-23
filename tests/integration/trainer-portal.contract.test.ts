/** Trainer logins (granted by the academy admin) and the trainer's own page: HTTP contracts. */
import request from 'supertest';
import {
  COURSE,
  TENANT_A,
  TENANT_B,
  TRAINER,
  TRAINER_EMAIL_TAKEN,
  TRAINER_NEW,
  TRAINER_NO_EMAIL,
  adminToken,
  buildApp,
  instructorToken,
  learnerToken,
  unlinkedInstructorToken,
} from './helpers/test-app';
import type { buildOtpFakes } from './helpers/owner-fakes';

type App = ReturnType<typeof buildApp>;
const mailer = (app: App) => (app.locals.otp as ReturnType<typeof buildOtpFakes>).mailer;
const as = (app: App, token: string, tenant = TENANT_A) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  post: (p: string) => request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  del: (p: string) => request(app).delete(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
});

describe('the academy admin gives a trainer a login', () => {
  it('creates the account and e-mails an invitation with the academy login link (no password, no code in the mail)', async () => {
    const app = buildApp();
    const res = await as(app, adminToken).post(`/admin/trainers/${TRAINER_NEW}/account`);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ invited: true });
    const mail = mailer(app).sent.find((m) => m.to === 'new.trainer@a.test');
    expect(mail?.subject).toContain('دعوة دخول مدرّب');
    expect(mail?.text).toContain('https://t3leem.my/rukn/login');
    expect(mail?.text).not.toMatch(/\d{6}/);
  });

  it('still creates the account when the invitation cannot be sent (invited: false)', async () => {
    const app = buildApp();
    mailer(app).failNext = true;
    const res = await as(app, adminToken).post(`/admin/trainers/${TRAINER_NEW}/account`);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ invited: false });
  });

  it('says why when it cannot: already has one, no e-mail, e-mail used by another account, unknown trainer', async () => {
    const app = buildApp();
    const grant = (id: string) => as(app, adminToken).post(`/admin/trainers/${id}/account`);
    expect((await grant(TRAINER)).body.error.code).toBe('TRAINER_HAS_ACCOUNT');
    expect((await grant(TRAINER_NO_EMAIL)).body.error.code).toBe('TRAINER_EMAIL_REQUIRED');
    expect((await grant(TRAINER_EMAIL_TAKEN)).body.error.code).toBe('EMAIL_TAKEN');
    expect((await grant('f1000000-0000-4000-8000-0000000000ff')).body.error.code).toBe('TRAINER_NOT_FOUND');
    expect((await as(app, adminToken).post('/admin/trainers/not-a-uuid/account')).status).toBe(422);
    expect(mailer(app).sent).toHaveLength(0);
  });

  it('removes a login (the trainer stays); removing it twice, or for an unknown trainer, says so', async () => {
    const app = buildApp();
    expect((await as(app, adminToken).del(`/admin/trainers/${TRAINER}/account`)).status).toBe(204);
    expect((await as(app, adminToken).del(`/admin/trainers/${TRAINER}/account`)).body.error.code).toBe('TRAINER_HAS_NO_ACCOUNT');
    expect((await as(app, adminToken).del('/admin/trainers/f1000000-0000-4000-8000-0000000000ff/account')).body.error.code).toBe('TRAINER_NOT_FOUND');
  });

  it('is the academy admin only: 401, 403 for a learner, a trainer, and another academy', async () => {
    const app = buildApp();
    expect((await request(app).post(`/api/v1/admin/trainers/${TRAINER_NEW}/account`).set('x-tenant-id', TENANT_A)).status).toBe(401);
    expect((await as(app, learnerToken).post(`/admin/trainers/${TRAINER_NEW}/account`)).status).toBe(403);
    expect((await as(app, instructorToken).post(`/admin/trainers/${TRAINER_NEW}/account`)).status).toBe(403);
    expect((await as(app, instructorToken).del(`/admin/trainers/${TRAINER}/account`)).status).toBe(403);
    expect((await as(app, adminToken, TENANT_B).post(`/admin/trainers/${TRAINER_NEW}/account`)).status).toBe(403);
  });
});

describe("the trainer's own page: /api/v1/trainer", () => {
  it('shows who they are, their courses (with trainee counts) and their upcoming live sessions with join links', async () => {
    const res = await as(buildApp(), instructorToken).get('/trainer/overview');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.trainer).toEqual({ id: TRAINER, full_name: 'Khalid', specialization: 'PM', bio: 'Consultant' });
    expect(res.body.data.courses).toEqual([
      { id: COURSE, title: 'PMP', type: 'RECORDED', is_published: true, enrollment_count: 2, starts_at: '2027-01-10T16:00:00.000Z', duration_days: 5 },
    ]);
    expect(res.body.data.sessions[0]).toMatchObject({ title: 'Scheduling', duration_minutes: 90, provider: 'ZOOM', join_url: 'https://example.com/join/demo', course_title: 'PMP' });
  });

  it("lists a course's trainees with progress only: no e-mail, phone or other personal fields", async () => {
    const res = await as(buildApp(), instructorToken).get(`/trainer/courses/${COURSE}/trainees`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      title: 'PMP',
      trainees: [{ name: 'Abdullah', progress_percentage: 40, completion_status: 'ENROLLED', status: 'ACTIVE', enrolled_at: '2026-10-24T00:00:00.000Z' }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/email|phone|national|employee/i);
  });

  it("404 for a course that is not theirs, and for a login that is not linked to a trainer profile", async () => {
    const app = buildApp();
    expect((await as(app, instructorToken).get('/trainer/courses/c0a80121-0000-4000-8000-00000000beef/trainees')).body.error.code).toBe('COURSE_NOT_FOUND');
    expect((await as(app, unlinkedInstructorToken).get('/trainer/overview')).body.error.code).toBe('TRAINER_PROFILE_NOT_FOUND');
    expect((await as(app, instructorToken).get('/trainer/courses/not-a-uuid/trainees')).status).toBe(422);
  });

  it('is for trainer logins only: 401 anonymous, 403 for learners, academy admins, and another academy', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/v1/trainer/overview').set('x-tenant-id', TENANT_A)).status).toBe(401);
    expect((await as(app, learnerToken).get('/trainer/overview')).status).toBe(403);
    expect((await as(app, adminToken).get('/trainer/overview')).status).toBe(403);
    expect((await as(app, instructorToken, TENANT_B).get('/trainer/overview')).status).toBe(403);
  });
});
