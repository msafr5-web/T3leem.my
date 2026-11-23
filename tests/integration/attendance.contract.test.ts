/** Attendance and check-out: the trainee's e-mailed-code check-in and the admin's report (HTTP contracts, in-memory data). */
import request from 'supertest';
import { COURSE, TENANT_A, TENANT_B, adminToken, buildApp, instructorToken, learnerToken } from './helpers/test-app';
import { DAY_SESSION, LIVE_SESSION, type buildAttendanceFakes } from './helpers/attendance-fakes';
import type { buildOtpFakes } from './helpers/owner-fakes';

type App = ReturnType<typeof buildApp>;
const fakes = (app: App) => app.locals.attendance as ReturnType<typeof buildAttendanceFakes>;
const mail = (app: App) => (app.locals.otp as ReturnType<typeof buildOtpFakes>).mailer;
const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00+03:00`);
const as = (app: App, token: string, tenant = TENANT_A) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object = {}) => request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
});

describe("the trainee's sessions", () => {
  it('lists today\'s sessions of their enrolled courses with what they can do (open now / not yet)', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('10:00');
    const res = await as(app, learnerToken).get('/me/attendance/sessions');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.map((s: { ref: string; state: string }) => [s.ref, s.state])).toEqual([
      [LIVE_SESSION, 'OPEN'],
      [DAY_SESSION, 'UPCOMING'],
    ]);
    expect(res.body.data[0]).toMatchObject({ kind: 'LIVE', title: 'Live lecture', course_title: 'PMP', checked_in_at: null, result: null });
    // someone not enrolled in the course sees nothing
    expect((await as(app, adminToken).get('/me/attendance/sessions')).body.data).toEqual([]);
  });
});

describe('check-in with the e-mailed code', () => {
  it('sends the code to the trainee (never in the response), then the right code checks them in and gives the join link', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('09:58');
    const req = await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION });
    expect(req.status).toBe(202);
    expect(Object.keys(req.body.data).sort()).toEqual(['challenge_id', 'expires_in']);
    const code = mail(app).lastCode;
    expect(JSON.stringify(req.body)).not.toContain(code);
    expect(mail(app).sent.at(-1)?.to).toBe('learner@rukn.test');
    expect(mail(app).sent.at(-1)?.subject).toContain('رمز تأكيد الحضور');

    const done = await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code });
    expect(done.status).toBe(200);
    expect(done.body.data).toEqual({ checked_in_at: at('09:58').toISOString(), late: false, join_url: 'https://zoom.example/join/live' });
    const after = await as(app, learnerToken).get('/me/attendance/sessions');
    expect(after.body.data[0]).toMatchObject({ state: 'CHECKED_IN', checked_in_at: at('09:58').toISOString() });
  });

  it('is LATE after 10% of the session (6 minutes of an hour), decided by when the code is entered', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('10:07');
    const req = await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION });
    const done = await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code: mail(app).lastCode });
    expect(done.body.data.late).toBe(true);
  });

  it('refuses a wrong code, a second check-in, and check-in outside the open window', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('10:00');
    const req = await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION });
    const wrong = await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code: '000000' === mail(app).lastCode ? '111111' : '000000' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('OTP_INVALID');
    expect(fakes(app).records.size).toBe(0);

    await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code: mail(app).lastCode });
    expect((await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION })).body.error.code).toBe('ALREADY_CHECKED_IN');

    const early = await as(app, learnerToken).post('/me/attendance/request', { kind: 'DAY', ref: DAY_SESSION }); // opens at 18:45
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('CHECKIN_CLOSED');
    expect(early.body.error.details.opens_at).toBe(at('18:45').toISOString());
    fakes(app).clock.now = at('11:00'); // the live session just ended
    expect((await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION })).body.error.code).toBe('CHECKIN_CLOSED');
  });

  it('a code is bound to its session: it cannot check in to another one', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('10:00');
    const req = await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION });
    const code = mail(app).lastCode;
    fakes(app).clock.now = at('19:05'); // now the DAY session is open, the live one is over
    const other = await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'DAY', ref: DAY_SESSION, challenge_id: req.body.data.challenge_id, code });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('OTP_INVALID');
    expect(fakes(app).records.size).toBe(0);
  });

  it('only for enrolled trainees; unknown sessions are 404; bad input is 422; no token is 401', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('10:00');
    expect((await as(app, adminToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION })).status).toBe(403);
    expect((await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: 'a3000000-0000-4000-8000-0000000000ff' })).body.error.code).toBe('SESSION_NOT_FOUND');
    expect((await as(app, learnerToken).post('/me/attendance/request', { kind: 'NOPE', ref: LIVE_SESSION })).status).toBe(422);
    expect((await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: 'x', code: '12' })).status).toBe(422);
    expect((await request(app).get('/api/v1/me/attendance/sessions').set('x-tenant-id', TENANT_A)).status).toBe(401);
    expect(mail(app).sent).toHaveLength(0);
  });
});

describe('Zoom joins and leaves feed the same record', () => {
  it('a trainee is found by e-mail; strangers and sessions that do not exist are ignored; a leave closes the open interval', async () => {
    const app = buildApp();
    const { service, joins } = fakes(app);
    await service.onZoomPresence(TENANT_A, LIVE_SESSION, 'learner@rukn.test', 'join', at('10:01'));
    await service.onZoomPresence(TENANT_A, LIVE_SESSION, 'learner@rukn.test', 'leave', at('10:40'));
    await service.onZoomPresence(TENANT_A, LIVE_SESSION, 'stranger@else.test', 'join', at('10:02'));
    await service.onZoomPresence(TENANT_A, LIVE_SESSION, null, 'join', at('10:02'));
    await service.onZoomPresence(TENANT_A, 'a3000000-0000-4000-8000-0000000000ff', 'learner@rukn.test', 'join', at('10:02'));
    expect(joins).toEqual([{ userId: expect.any(String), ref: LIVE_SESSION, at: at('10:01'), leftAt: at('10:40') }]);
  });
});

describe("the admin's attendance report", () => {
  it('lists courses with sessions, and gives each trainee a status per session and the 85% result', async () => {
    const app = buildApp();
    const { clock } = fakes(app);
    clock.now = at('10:03');
    const req = await as(app, learnerToken).post('/me/attendance/request', { kind: 'LIVE', ref: LIVE_SESSION });
    await as(app, learnerToken).post('/me/attendance/confirm', { kind: 'LIVE', ref: LIVE_SESSION, challenge_id: req.body.data.challenge_id, code: mail(app).lastCode });
    clock.now = at('12:00'); // the live session is over, the recorded day is still to come

    const list = await as(app, adminToken).get('/admin/attendance/courses');
    expect(list.body.data).toEqual([{ course_id: COURSE, title: 'PMP', sessions: 2, held: 1, trainees: 1, passing_trainees: 1 }]);

    const rep = await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`);
    expect(rep.status).toBe(200);
    expect(rep.body.data.rules).toEqual({ pass_percent: 85, late_percent_of_session: 10, leave_grace_minutes: 5 });
    expect(rep.body.data.sessions.map((s: { held: boolean }) => s.held)).toEqual([true, false]);
    expect(rep.body.data.trainees[0]).toMatchObject({
      name: 'Abdullah',
      statuses: { [LIVE_SESSION]: 'PRESENT', [DAY_SESSION]: 'PENDING' },
      summary: { held: 1, attended: 1, late: 0, absent: 0, percent: 100, passes: true },
    });
  });

  it('a trainee who never checked in is ABSENT once the session has ended (and fails the 85% mark)', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('12:00');
    const rep = await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}`);
    expect(rep.body.data.trainees[0]).toMatchObject({ statuses: { [LIVE_SESSION]: 'ABSENT' }, summary: { held: 1, absent: 1, percent: 0, passes: false } });
    expect(rep.body.data.passing_trainees).toBe(0);
  });

  it('exports the sheet as Excel, 404 for an unknown course, and is the academy admin only', async () => {
    const app = buildApp();
    fakes(app).clock.now = at('12:00');
    const xlsx = await as(app, adminToken).get(`/admin/attendance/courses/${COURSE}/export`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // an .xlsx is a zip

    expect((await as(app, adminToken).get('/admin/attendance/courses/c0a80121-0000-4000-8000-00000000beef')).body.error.code).toBe('COURSE_NOT_FOUND');
    expect((await as(app, learnerToken).get('/admin/attendance/courses')).status).toBe(403);
    expect((await as(app, instructorToken).get(`/admin/attendance/courses/${COURSE}`)).status).toBe(403);
    expect((await as(app, adminToken, TENANT_B).get('/admin/attendance/courses')).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/attendance/courses').set('x-tenant-id', TENANT_A)).status).toBe(401);
  });
});
