/** Per-course attendance rules and the admin's manual decisions: HTTP contracts (in-memory data). */
import request from 'supertest';
import { COURSE, TENANT_A, TENANT_B, USER, adminToken, buildApp, instructorToken, learnerToken } from './helpers/test-app';
import { DAY_SESSION, LIVE_SESSION, type buildAttendanceFakes } from './helpers/attendance-fakes';
import type { buildOtpFakes } from './helpers/owner-fakes';

type App = ReturnType<typeof buildApp>;
const fakes = (app: App) => app.locals.attendance as ReturnType<typeof buildAttendanceFakes>;
const mail = (app: App) => (app.locals.otp as ReturnType<typeof buildOtpFakes>).mailer;
const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00+03:00`);
const as = (app: App, token: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object = {}) => request(app).post(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body),
});

async function checkIn(app: App, hhmm: string): Promise<void> {
  fakes(app).clock.now = at(hhmm);
  const req = await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION });
  await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code: mail(app).lastCode });
}

describe('the admin tunes the attendance rules of a course', () => {
  const settingsPath = `/admin/attendance/courses/${COURSE}/settings`;
  const put = (app: App, token: string, body: object, path = settingsPath, tenant = TENANT_A) =>
    request(app).put(`/api/v1${path}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body);

  it('a longer late window changes who is late: 25% of an hour is 15 minutes', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('10:10');
    expect((await put(app, adminToken, { late_percent: 25, leave_grace_minutes: 10, pass_percent: 70 })).body.data).toEqual({ saved: true });
    const req = await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION });
    const done = await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code: mail(app).lastCode });
    expect(done.body.data.late).toBe(false); // 10:10 is before 10:15 (it would be late under the default 10:06)

    fakes(app).clock.now = at('12:00');
    const rep = await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`);
    expect(rep.body.data.rules).toEqual({ pass_percent: 70, late_percent_of_session: 25, leave_grace_minutes: 10 });
    expect(rep.body.data.settings).toEqual({ late_percent: 25, leave_grace_minutes: 10, pass_percent: 70 });
    expect(rep.body.data.limits.pass_percent).toEqual({ min: 50, max: 100 });
    expect(rep.body.data.trainees[0].statuses[LIVE_SESSION]).toBe('PRESENT');
  });

  it('results are recomputed under the new rules, and an empty value goes back to the default', async () => {
    const app = buildApp();
    await checkIn(app, '10:10');
    fakes(app).clock.now = at('12:00');
    expect((await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`)).body.data.trainees[0].statuses[LIVE_SESSION]).toBe('LATE'); // default: after 10:06
    await put(app, adminToken, { late_percent: 25 });
    expect((await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`)).body.data.trainees[0].statuses[LIVE_SESSION]).toBe('PRESENT');
    await put(app, adminToken, { late_percent: '', leave_grace_minutes: null, pass_percent: '' });
    const rep = await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`);
    expect(rep.body.data.settings).toEqual({ late_percent: null, leave_grace_minutes: null, pass_percent: null });
    expect(rep.body.data.trainees[0].statuses[LIVE_SESSION]).toBe('LATE');
  });

  it('refuses values outside their range or not whole numbers, an unknown course, and anyone but the academy admin', async () => {
    const app = buildApp();
    for (const bad of [{ late_percent: 0 }, { late_percent: 51 }, { leave_grace_minutes: 31 }, { leave_grace_minutes: -1 }, { pass_percent: 49 }, { pass_percent: 101 }]) {
      const r = await put(app, adminToken, bad);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_SETTINGS');
    }
    expect((await put(app, adminToken, { late_percent: 'abc' })).status).toBe(422);
    expect((await put(app, adminToken, { late_percent: 12.5 })).status).toBe(422);
    expect((await put(app, adminToken, { late_percent: 10 }, '/admin/attendance/courses/c0a80121-0000-4000-8000-00000000beef/settings')).status).toBe(404);
    expect((await put(app, learnerToken, { late_percent: 10 })).status).toBe(403);
    expect((await put(app, instructorToken, { late_percent: 10 })).status).toBe(403);
    expect((await put(app, adminToken, { late_percent: 10 }, settingsPath, TENANT_B)).status).toBe(403);
    expect(fakes(app).settings).toEqual({ latePercent: null, leaveGraceMinutes: null, passPercent: null });
  });
});

describe("the admin's manual decision about a trainee's attendance", () => {
  const recordsPath = `/api/v1/admin/attendance/courses/${COURSE}/records`;
  const send = (app: App, method: 'put' | 'delete', body: object, token = adminToken) => request(app)[method](recordsPath).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`).send(body);
  const base = { kind: 'LIVE', ref: LIVE_SESSION, user_id: USER };

  it('overrides the computed status with a reason; the report flags it; automatic settling never overwrites it; reverting restores the computed result', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('12:00'); // nobody checked in: the computed status is ABSENT
    expect((await send(app, 'put', { ...base, status: 'PRESENT', note: 'Was in the room (HR confirmed)' })).body.data).toEqual({ saved: true });

    let rep = (await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`)).body.data;
    expect(rep.trainees[0].statuses[LIVE_SESSION]).toBe('PRESENT');
    expect(rep.trainees[0].adjusted).toEqual({ [LIVE_SESSION]: 'Was in the room (HR confirmed)' });
    expect(rep.trainees[0].summary).toMatchObject({ held: 1, percent: 100, passes: true });

    // the periodic settling runs: it must leave the decision alone
    await fakes(app).service.settle(TENANT_A, fakes(app).sessions[0]!, [{ userId: USER, name: 'Abdullah', adminEnrolled: true }], at('12:00'));
    expect(fakes(app).records.get(`${USER}:LIVE:${LIVE_SESSION}`)).toMatchObject({ status: 'PRESENT', source: 'MANUAL' });

    expect((await send(app, 'delete', base)).status).toBe(204);
    rep = (await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`)).body.data;
    expect(rep.trainees[0].statuses[LIVE_SESSION]).toBe('ABSENT'); // back to the computed result
    expect(rep.trainees[0].adjusted).toEqual({});
    expect((await send(app, 'delete', base)).body.error.code).toBe('NO_ADJUSTMENT');
  });

  it('can also turn a computed PRESENT into ABSENT', async () => {
    const app = buildApp();
    await checkIn(app, '10:02');
    fakes(app).clock.now = at('12:00');
    await send(app, 'put', { ...base, status: 'ABSENT', note: 'Left the room after check-in' });
    const rep = (await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`)).body.data;
    expect(rep.trainees[0].statuses[LIVE_SESSION]).toBe('ABSENT');
    expect(rep.trainees[0].summary).toMatchObject({ passes: false, absent: 1 });
  });

  it('needs a reason, a session that has started, a session of THIS course and an active trainee of it', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('12:00');
    expect((await send(app, 'put', { ...base, status: 'PRESENT', note: 'x' })).status).toBe(422);
    expect((await send(app, 'put', { ...base, status: 'PRESENT' })).status).toBe(422);
    expect((await send(app, 'put', { ...base, status: 'PENDING', note: 'valid reason' })).status).toBe(422);
    expect((await send(app, 'put', { ...base, kind: 'DAY', ref: DAY_SESSION, status: 'PRESENT', note: 'valid reason' })).body.error.code).toBe('SESSION_NOT_STARTED'); // 19:00 is still ahead
    expect((await send(app, 'put', { ...base, ref: 'a3000000-0000-4000-8000-0000000000ff', status: 'PRESENT', note: 'valid reason' })).body.error.code).toBe('SESSION_NOT_FOUND');
    expect((await send(app, 'put', { ...base, user_id: 'a4b8f2b0-1111-4c2a-8a33-000000000099', status: 'PRESENT', note: 'valid reason' })).body.error.code).toBe('TRAINEE_NOT_FOUND');
    expect(fakes(app).records.size).toBe(0);
  });

  it('is for the academy admin only', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('12:00');
    const body = { ...base, status: 'PRESENT', note: 'valid reason' };
    expect((await send(app, 'put', body, learnerToken)).status).toBe(403);
    expect((await send(app, 'put', body, instructorToken)).status).toBe(403);
    expect((await send(app, 'delete', base, learnerToken)).status).toBe(403);
    expect((await request(app).put(recordsPath).set('x-tenant-id', TENANT_A).send(body)).status).toBe(401);
  });
});
