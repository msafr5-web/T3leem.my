/**
 * Deleting a course that has trainees needs the PLATFORM OWNER's approval: a code is e-mailed to the owner address(es), the
 * admin comes back with it. HTTP contract (with fakes) first, then the code rules at service level.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { JwtTokenSigner } from '../../src/modules/auth/token-signer';
import { APPROVAL, OTP, type LoginUser, type UserLookup } from '../../src/modules/auth/otp.service';
import { COURSE, TENANT_A, TENANT_B, adminToken, buildApp, learnerToken } from './helpers/test-app';
import { buildOtpFakes } from './helpers/owner-fakes';

type App = ReturnType<typeof buildApp>;
const OWNER = 't3leemy@t3leem.my';
const otpOf = (app: App) => app.locals.otp as ReturnType<typeof buildOtpFakes>;
const post = (app: App, path: string, body: object = {}, token = adminToken, tenant = TENANT_A) =>
  request(app).post(`/api/v1/admin${path}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body);

describe('owner approval for deleting a course with trainees (HTTP)', () => {
  it('the plain delete still refuses a course with trainees', async () => {
    const res = await request(buildApp()).delete(`/api/v1/admin/courses/${COURSE}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_HAS_ENROLLMENTS');
  });

  it('a request e-mails the code to the OWNER (never to the admin, never in the response) and says what is being approved', async () => {
    const app = buildApp();
    const res = await post(app, `/courses/${COURSE}/delete-request`);
    expect(res.status).toBe(202);
    expect(Object.keys(res.body.data).sort()).toEqual(['challenge_id', 'expires_in']);
    expect(JSON.stringify(res.body)).not.toMatch(/\d{6}/);

    const mails = otpOf(app).mailer.sent;
    expect(mails.map((m) => m.to)).toEqual([OWNER]);
    expect(mails[0]?.text).toContain('Rukn'); // the academy
    expect(mails[0]?.text).toContain('عدد المتدربين المسجلين: 1');
    expect(mails[0]?.subject).toContain('Rukn');
  });

  it('the right code deletes the course with its trainees; the same code cannot be used twice', async () => {
    const app = buildApp();
    const { challenge_id } = (await post(app, `/courses/${COURSE}/delete-request`)).body.data;
    const code = otpOf(app).mailer.lastCode;

    const done = await post(app, `/courses/${COURSE}/delete-approved`, { challenge_id, code });
    expect(done.status).toBe(200);
    expect(done.body.data).toEqual({ enrollments: 1, certificates: 0 });

    const again = await post(app, `/courses/${COURSE}/delete-approved`, { challenge_id, code });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('OTP_INVALID');
  });

  it('a wrong code deletes nothing, and five wrong codes lock the request', async () => {
    const app = buildApp();
    const { challenge_id } = (await post(app, `/courses/${COURSE}/delete-request`)).body.data;
    const right = otpOf(app).mailer.lastCode;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP.maxAttempts; i++) {
      const r = await post(app, `/courses/${COURSE}/delete-approved`, { challenge_id, code: wrong });
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    const locked = await post(app, `/courses/${COURSE}/delete-approved`, { challenge_id, code: right });
    expect(locked.status).toBe(429); // even the right code is refused after the lock-out
  });

  it('validates the input and refuses anyone but the academy admin', async () => {
    const app = buildApp();
    expect((await post(app, `/courses/${COURSE}/delete-approved`, { challenge_id: 'x', code: '123456' })).status).toBe(422);
    expect((await post(app, `/courses/${COURSE}/delete-approved`, { challenge_id: randomUUID(), code: 'abc' })).status).toBe(422);
    expect((await post(app, `/courses/${COURSE}/delete-request`, {}, learnerToken)).status).toBe(403);
    expect((await post(app, `/courses/${COURSE}/delete-request`, {}, adminToken, TENANT_B)).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/courses/${COURSE}/delete-request`).set('x-tenant-id', TENANT_A)).status).toBe(401);
    expect(otpOf(app).mailer.sent).toHaveLength(0);
  });

  it('an unknown course is 404 and spends no code', async () => {
    const app = buildApp();
    const other = 'c0a80121-0000-4000-8000-00000000beef';
    expect((await post(app, `/courses/${other}/delete-request`)).status).toBe(404);
    const { challenge_id } = (await post(app, `/courses/${COURSE}/delete-request`)).body.data;
    const code = otpOf(app).mailer.lastCode;
    expect((await post(app, `/courses/${other}/delete-approved`, { challenge_id, code })).status).toBe(404);
    // the code was not consumed by the 404: it still works for its own course
    expect((await post(app, `/courses/${COURSE}/delete-approved`, { challenge_id, code })).status).toBe(200);
  });
});

describe('owner approval codes (service rules)', () => {
  const T = randomUUID();
  const REQUESTER = randomUUID();
  const SUBJECT = randomUUID();
  const users: UserLookup = {
    findUser: async () => null,
    findById: async (_t, id): Promise<LoginUser | null> => (id === REQUESTER ? { id, email: 'admin@corp.test', role: 'TENANT_ADMIN', fullName: 'Academy Admin' } : null),
  };
  const setup = (owners = [OWNER, 'second.owner@t3leem.test']) => {
    const f = buildOtpFakes({ users, signer: { available: true, ttlSeconds: 60, sign: () => 'unused' } as unknown as JwtTokenSigner, platformAdmins: owners });
    const ask = () => f.service.requestOwnerApproval({ tenantId: T, tenantLabel: 'Corp', requester: { id: REQUESTER }, purpose: 'course_delete', subjectId: SUBJECT, details: ['الدورة: PMP'] });
    const confirm = (o: Partial<{ tenantId: string; requesterId: string; subjectId: string; challengeId: string; code: string }> & { challengeId: string; code: string }) =>
      f.service.confirmOwnerApproval({ tenantId: T, requesterId: REQUESTER, purpose: 'course_delete', subjectId: SUBJECT, ...o });
    return { f, ask, confirm };
  };

  it('mails EVERY owner address the same code', async () => {
    const { f, ask } = setup();
    await ask();
    expect(f.mailer.sent.map((m) => m.to).sort()).toEqual([OWNER, 'second.owner@t3leem.test'].sort());
    expect(new Set(f.mailer.sent.map((m) => /(\d{6})/.exec(m.text)?.[1])).size).toBe(1);
  });

  it('is bound to its course, academy and requester: a code for one course cannot approve another', async () => {
    const { f, ask, confirm } = setup();
    const { challengeId } = await ask();
    const code = f.mailer.lastCode;
    await expect(confirm({ challengeId, code, subjectId: randomUUID() })).rejects.toMatchObject({ code: 'OTP_INVALID' }); // other course
    await expect(confirm({ challengeId, code, tenantId: randomUUID() })).rejects.toMatchObject({ code: 'OTP_INVALID' }); // other academy
    await expect(confirm({ challengeId, code, requesterId: randomUUID() })).rejects.toMatchObject({ code: 'OTP_INVALID' }); // other admin
    await expect(confirm({ challengeId, code })).resolves.toBeUndefined(); // the real one still works: wrong-binding tries did not burn it
  });

  it('expires after ten minutes', async () => {
    const { f, ask, confirm } = setup();
    const { challengeId } = await ask();
    const code = f.mailer.lastCode;
    f.clock.now = new Date(f.clock.now.getTime() + OTP.ttlMs + 1000);
    await expect(confirm({ challengeId, code })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('allows five requests an hour per admin, then 429', async () => {
    const { ask } = setup();
    for (let i = 0; i < APPROVAL.maxRequestsPerHour; i++) await ask();
    await expect(ask()).rejects.toMatchObject({ status: 429 });
  });

  it('an unknown requester is refused and nothing is mailed; a mail failure leaves no usable challenge', async () => {
    const { f, ask, confirm } = setup();
    await expect(f.service.requestOwnerApproval({ tenantId: T, tenantLabel: 'Corp', requester: { id: randomUUID() }, purpose: 'course_delete', subjectId: SUBJECT, details: [] })).rejects.toMatchObject({ status: 401 });
    expect(f.mailer.sent).toHaveLength(0);

    f.mailer.failNext = true;
    await expect(ask()).rejects.toMatchObject({ code: 'MAIL_UNAVAILABLE' });
    expect([...f.repository.rows.values()]).toHaveLength(0);
    await expect(confirm({ challengeId: randomUUID(), code: '123456' })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('refuses to work with no owner address configured', async () => {
    const { ask } = setup([]);
    await expect(ask()).rejects.toMatchObject({ status: 503, code: 'APPROVAL_UNAVAILABLE' });
  });

  it('keeps sign-in codes and approval codes apart (an approval code is not a login code)', async () => {
    const { f, ask } = setup();
    const { challengeId } = await ask();
    await expect(f.service.verify(T, challengeId, f.mailer.lastCode)).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });
});
