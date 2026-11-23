/** E-mail invitations when the academy's admin enrolls employees (and re-sending them): HTTP contracts. */
import request from 'supertest';
import { COURSE, TENANT_A, TENANT_B, adminToken, buildApp, instructorToken, learnerToken } from './helpers/test-app';
import type { buildOtpFakes } from './helpers/owner-fakes';
import type { ProviderService } from '../../src/modules/provider/provider.service';

type App = ReturnType<typeof buildApp>;
const mailer = (app: App) => (app.locals.otp as ReturnType<typeof buildOtpFakes>).mailer;
const service = (app: App) => app.locals.providerService as ProviderService;
const people = [
  { full_name: 'Ali Hassan', email: 'ali@corp.test' },
  { full_name: 'Sara Ahmed', email: 'sara@corp.test' },
];
const post = (app: App, path: string, body: object = {}, token = adminToken, tenant = TENANT_A) =>
  request(app).post(`/api/v1/admin${path}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body);
const upload = (app: App, csv: string, query = '') =>
  request(app)
    .post(`/api/v1/admin/courses/${COURSE}/enrollments/import${query}`)
    .set('x-tenant-id', TENANT_A)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from(csv, 'utf8'));

describe('invitations when employees are enrolled', () => {
  it('e-mails each newly enrolled employee by default, and says how many were queued', async () => {
    const app = buildApp();
    const res = await post(app, `/courses/${COURSE}/enrollments`, { trainees: people });
    expect(res.status).toBe(201);
    expect(res.body.data.invitations).toBe(2);
    await service(app).drainInvitations();
    expect(mailer(app).sent.map((m) => m.to).sort()).toEqual(['ali@corp.test', 'sara@corp.test']);
    const mail = mailer(app).sent.find((m) => m.to === 'ali@corp.test')!;
    expect(mail.subject).toContain('«PMP»');
    expect(mail.text).toContain('https://t3leem.my/rukn/login');
    expect(mail.text).toContain('تبدأ الدورة'); // the fixture course is dated
    expect(mail.text).toContain('وتمتد 5 أيام');
  });

  it('sends nothing when the admin switches invitations off', async () => {
    const app = buildApp();
    const res = await post(app, `/courses/${COURSE}/enrollments`, { trainees: people, invite: false });
    expect(res.body.data.invitations).toBe(0);
    await service(app).drainInvitations();
    expect(mailer(app).sent).toHaveLength(0);
    expect((await post(app, `/courses/${COURSE}/enrollments`, { trainees: people, invite: 'maybe' })).status).toBe(422);
  });

  it('works the same for an uploaded sheet (?invite=0 switches it off)', async () => {
    const app = buildApp();
    const csv = 'Full_Name,Email\nAli Hassan,ali@corp.test\nSara Ahmed,sara@corp.test\n';
    expect((await upload(app, csv)).body.data.invitations).toBe(2);
    await service(app).drainInvitations();
    expect(mailer(app).sent).toHaveLength(2);

    const app2 = buildApp();
    expect((await upload(app2, csv, '?invite=0')).body.data.invitations).toBe(0);
    await service(app2).drainInvitations();
    expect(mailer(app2).sent).toHaveLength(0);
    expect((await upload(app2, csv, '?invite=2')).status).toBe(422);
  });

  it('an invalid list sends nothing', async () => {
    const app = buildApp();
    const res = await post(app, `/courses/${COURSE}/enrollments`, { trainees: [people[0], { full_name: 'Bad One', email: 'nope' }] });
    expect(res.status).toBe(422);
    await service(app).drainInvitations();
    expect(mailer(app).sent).toHaveLength(0);
  });
});

describe('re-sending invitations', () => {
  it("goes to the employees the admin enrolled in the course and says how many", async () => {
    const app = buildApp();
    const res = await post(app, `/courses/${COURSE}/enrollments/invite`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ queued: 1 });
    await service(app).drainInvitations();
    expect(mailer(app).sent.map((m) => m.to)).toEqual(['ali@corp.test']);
    expect(mailer(app).sent[0]?.text).toContain('مرحباً Ali Hassan');
  });

  it('refuses a course of another academy, and anyone but the academy admin', async () => {
    const app = buildApp();
    expect((await post(app, '/courses/c0a80121-0000-4000-8000-00000000beef/enrollments/invite')).body.error.code).toBe('UNKNOWN_COURSE');
    expect((await post(app, `/courses/${COURSE}/enrollments/invite`, {}, learnerToken)).status).toBe(403);
    expect((await post(app, `/courses/${COURSE}/enrollments/invite`, {}, instructorToken)).status).toBe(403);
    expect((await post(app, `/courses/${COURSE}/enrollments/invite`, {}, adminToken, TENANT_B)).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/courses/${COURSE}/enrollments/invite`).set('x-tenant-id', TENANT_A)).status).toBe(401);
    await service(app).drainInvitations();
    expect(mailer(app).sent).toHaveLength(0);
  });
});
