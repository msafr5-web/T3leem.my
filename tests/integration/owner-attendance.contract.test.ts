/** The platform owner's attendance view across academies: HTTP contracts (in-memory data). */
import request from 'supertest';
import { COURSE, TENANT_A, adminToken, buildApp, learnerToken } from './helpers/test-app';
import { LIVE_SESSION, type buildAttendanceFakes } from './helpers/attendance-fakes';
import { ALL_FEATURES, type buildOtpFakes, type buildOwnerFakes } from './helpers/owner-fakes';

type App = ReturnType<typeof buildApp>;
const fakes = (app: App) => app.locals.attendance as ReturnType<typeof buildAttendanceFakes>;
const otpOf = (app: App) => app.locals.otp as ReturnType<typeof buildOtpFakes>;
const ownerOf = (app: App) => app.locals.owner as ReturnType<typeof buildOwnerFakes>;
const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00+03:00`);
const base = '/api/v1/platform/owner';

async function ownerToken(app: App): Promise<string> {
  const r = await request(app).post(`${base}/otp/request`).send({ email: 't3leemy@t3leem.my' });
  const v = await request(app).post(`${base}/otp/verify`).send({ challenge_id: r.body.data.challenge_id, code: otpOf(app).mailer.lastCode });
  return v.body.data.access_token as string;
}
const get = (app: App, token: string, path: string) => request(app).get(`${base}${path}`).set('Authorization', `Bearer ${token}`);

/** Academy A is in the owner's list too, so its courses can be opened by id. */
function registerAcademy(app: App): void {
  ownerOf(app).repository.tenants.set(TENANT_A, {
    id: TENANT_A, slug: 'rukn', name: 'Rukn', status: 'ACTIVE', planId: null, planName: null, approvedAt: null, subscriptionEndsAt: null, features: ALL_FEATURES,
    ownerName: null, ownerEmail: null, ownerPhone: null, createdAt: new Date('2026-10-01T00:00:00Z'),
  });
}

async function learnerChecksIn(app: App, hhmm: string): Promise<void> {
  fakes(app).clock.now = at(hhmm);
  const req = await request(app).post('/api/v1/me/attendance/request').set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${learnerToken}`).send({ kind: 'LIVE', ref: LIVE_SESSION });
  await request(app)
    .post('/api/v1/me/attendance/confirm')
    .set('x-tenant-id', TENANT_A)
    .set('Authorization', `Bearer ${learnerToken}`)
    .send({ kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code: otpOf(app).mailer.lastCode });
}

describe('attendance across academies (platform owner)', () => {
  it('summarises every live academy: courses, sessions held, trainees, who passes, and the attended share', async () => {
    const app = buildApp();
    const token = await ownerToken(app);
    await learnerChecksIn(app, '10:03');
    fakes(app).clock.now = at('12:00');
    const res = await get(app, token, '/attendance');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.academies).toEqual([
      { id: TENANT_A, slug: 'rukn', name: 'Rukn', courses: 1, held_sessions: 1, trainees: 1, passing_trainees: 1, attendance_percent: 100, late_slots: 0, absent_slots: 0 },
    ]);
    expect(res.body.data.totals).toEqual({ academies: 1, courses: 1, held_sessions: 1, trainees: 1, passing_trainees: 1, attendance_percent: 100 });
  });

  it('counts a trainee who never checked in as absent and as not passing', async () => {
    const app = buildApp();
    const token = await ownerToken(app);
    fakes(app).clock.now = at('12:00');
    const { academies, totals } = (await get(app, token, '/attendance')).body.data;
    expect(academies[0]).toMatchObject({ trainees: 1, passing_trainees: 0, attendance_percent: 0, absent_slots: 1 });
    expect(totals.attendance_percent).toBe(0);
  });

  it('has no percentage before anything has been held', async () => {
    const app = buildApp();
    const token = await ownerToken(app);
    fakes(app).clock.now = at('08:00');
    expect((await get(app, token, '/attendance')).body.data.totals).toMatchObject({ held_sessions: 0, attendance_percent: null });
  });

  it("opens one academy's courses by id (404 for an unknown academy)", async () => {
    const app = buildApp();
    registerAcademy(app);
    const token = await ownerToken(app);
    await learnerChecksIn(app, '10:20'); // late: after the 10:06 mark
    fakes(app).clock.now = at('12:00');
    const res = await get(app, token, `/tenants/${TENANT_A}/attendance`);
    expect(res.status).toBe(200);
    expect(res.body.data.academy).toEqual({ id: TENANT_A, slug: 'rukn', name: 'Rukn' });
    expect(res.body.data.courses).toEqual([{ course_id: COURSE, title: 'PMP', sessions: 2, held: 1, trainees: 1, passing_trainees: 1, attendance_percent: 100 }]);
    expect((await get(app, token, '/tenants/c1000000-0000-4000-8000-0000000000ff/attendance')).body.error.code).toBe('TENANT_NOT_FOUND');
    expect((await get(app, token, '/tenants/not-a-uuid/attendance')).status).toBe(422);
  });

  it('is for the platform owner only: anonymous 401, academy admin and learner 403', async () => {
    const app = buildApp();
    registerAcademy(app);
    expect((await request(app).get(`${base}/attendance`)).status).toBe(401);
    expect((await get(app, adminToken, '/attendance')).status).toBe(403);
    expect((await get(app, learnerToken, '/attendance')).status).toBe(403);
    expect((await get(app, adminToken, `/tenants/${TENANT_A}/attendance`)).status).toBe(403);
  });

  it("the academy admin's own list now shows the attended percentage per course", async () => {
    const app = buildApp();
    await learnerChecksIn(app, '10:03');
    fakes(app).clock.now = at('12:00');
    const res = await request(app).get('/api/v1/admin/attendance/courses').set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data).toEqual([{ course_id: COURSE, title: 'PMP', sessions: 2, held: 1, trainees: 1, passing_trainees: 1, attendance_percent: 100 }]);
  });
});
