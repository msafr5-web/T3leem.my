/** HTTP contracts for the platform owner console: e-mail code sign-in, approval, plans, subscription, modules. */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { TENANT_A, adminToken, buildApp, jwtOpts, learnerToken, tenants } from './helpers/test-app';
import { ALL_FEATURES, PENDING_TENANT, type buildOtpFakes, type buildOwnerFakes } from './helpers/owner-fakes';

type Otp = ReturnType<typeof buildOtpFakes>;
type Owner = ReturnType<typeof buildOwnerFakes>;
const otpOf = (app: ReturnType<typeof buildApp>) => app.locals.otp as Otp;
const ownerOf = (app: ReturnType<typeof buildApp>) => app.locals.owner as Owner;

const OWNER = 't3leemy@t3leem.my';
const base = '/api/v1/platform/owner';

async function signIn(app: ReturnType<typeof buildApp>, email = OWNER): Promise<string> {
  const r = await request(app).post(`${base}/otp/request`).send({ email });
  const v = await request(app).post(`${base}/otp/verify`).send({ challenge_id: r.body.data.challenge_id, code: otpOf(app).mailer.lastCode });
  return v.body.data.access_token as string;
}

const as = (app: ReturnType<typeof buildApp>, token: string) => ({
  get: (p: string) => request(app).get(`${base}${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object) => request(app).post(`${base}${p}`).set('Authorization', `Bearer ${token}`).send(body),
  put: (p: string, body: object) => request(app).put(`${base}${p}`).set('Authorization', `Bearer ${token}`).send(body),
  del: (p: string) => request(app).delete(`${base}${p}`).set('Authorization', `Bearer ${token}`),
});

describe('owner sign-in by e-mail code', () => {
  it('t3leemy@t3leem.my gets a code and a SUPER_ADMIN token for the platform (not for any academy)', async () => {
    const app = buildApp();
    const token = await signIn(app);
    const claims = jwt.verify(token, jwtOpts.publicKey, { algorithms: ['RS256'], issuer: jwtOpts.issuer, audience: jwtOpts.audience }) as jwt.JwtPayload;
    expect(claims.role).toBe('SUPER_ADMIN');
    expect(claims.tid).toBe('00000000-0000-4000-8000-000000000000');
    expect(otpOf(app).mailer.sent[0]!.to).toBe(OWNER);
  });

  it('any other address gets the same answer but no e-mail and no way in', async () => {
    const app = buildApp();
    const r = await request(app).post(`${base}/otp/request`).send({ email: 'someone@else.test' });
    expect(r.status).toBe(202);
    expect(otpOf(app).mailer.sent).toHaveLength(0);
    const v = await request(app).post(`${base}/otp/verify`).send({ challenge_id: r.body.data.challenge_id, code: '123456' });
    expect(v.body.error.code).toBe('OTP_INVALID');
  });

  it('an academy sign-in code cannot be used on the owner console (and vice versa)', async () => {
    const app = buildApp();
    const r = await request(app).post('/api/v1/auth/otp/request').set('x-tenant-slug', 'rukn').send({ email: 'learner@rukn.test' });
    const v = await request(app).post(`${base}/otp/verify`).send({ challenge_id: r.body.data.challenge_id, code: otpOf(app).mailer.lastCode });
    expect(v.body.error.code).toBe('OTP_INVALID');
  });

  it('the console refuses anonymous callers, learners, academy admins and tokens of academies', async () => {
    const app = buildApp();
    expect((await request(app).get(`${base}/overview`)).status).toBe(401);
    expect((await as(app, learnerToken).get('/overview')).status).toBe(403);
    expect((await as(app, adminToken).get('/overview')).status).toBe(403);
  });
});

describe('approving an academy', () => {
  it('lists academies, approves one with plan, months and modules, and e-mails its admin', async () => {
    const app = buildApp();
    const o = as(app, await signIn(app));
    const overview = (await o.get('/overview')).body.data;
    expect(overview).toMatchObject({ total: 1, pending: 1, active: 0 });
    expect(overview.tenants[0]).toMatchObject({ slug: 'health', status: 'PROVISIONING', owner_email: 'owner@health.test', owner_phone: '+966500000000' });

    const plan = (await o.get('/plans')).body.data[0].id as string;
    const res = await o.post(`/tenants/${PENDING_TENANT}/approve`, { plan_id: plan, months: 6, features: { health: true, recorded: false } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', plan_name: 'الأساسية', features: { health: true, recorded: false } });
    expect(res.body.data.subscription_ends_at).toBe('2027-05-01T10:00:00.000Z');
    expect(ownerOf(app).invalidated).toContain('health');

    const mail = otpOf(app).mailer.sent.find((m) => m.to === 'owner@health.test');
    expect(mail?.subject).toContain('أكاديمية الشهادات الصحية');
    expect(mail?.text).toContain('https://t3leem.my/health');
  });

  it('months = 0 means no end date; unknown plan and bad months are refused', async () => {
    const app = buildApp();
    const o = as(app, await signIn(app));
    const open = await o.post(`/tenants/${PENDING_TENANT}/approve`, { months: 0, features: ALL_FEATURES });
    expect(open.body.data.subscription_ends_at).toBeNull();
    expect((await o.post(`/tenants/${PENDING_TENANT}/approve`, { months: 1, plan_id: 'b0000000-0000-4000-8000-0000000000ff' })).body.error.code).toBe('UNKNOWN_PLAN');
    expect((await o.post(`/tenants/${PENDING_TENANT}/approve`, { months: 500 })).status).toBe(422);
    expect((await o.post('/tenants/c1000000-0000-4000-8000-0000000000ff/approve', { months: 1 })).status).toBe(404);
  });

  it('suspends, reactivates, edits modules and extends from the later of now and the end date', async () => {
    const app = buildApp();
    const o = as(app, await signIn(app));
    await o.post(`/tenants/${PENDING_TENANT}/approve`, { months: 1, features: ALL_FEATURES });
    expect((await o.put(`/tenants/${PENDING_TENANT}`, { status: 'SUSPENDED' })).body.data.status).toBe('SUSPENDED');
    expect((await o.put(`/tenants/${PENDING_TENANT}`, { status: 'ACTIVE', features: { health: false, recorded: true } })).body.data).toMatchObject({ status: 'ACTIVE', features: { health: false, recorded: true } });
    const ext = await o.post(`/tenants/${PENDING_TENANT}/extend`, { months: 3 });
    expect(ext.body.data.subscription_ends_at).toBe('2027-03-01T10:00:00.000Z'); // 2026-12-01 + 3 months
    expect((await o.put(`/tenants/${PENDING_TENANT}`, { subscription_ends_at: null })).body.data.subscription_ends_at).toBeNull();
    expect((await o.put(`/tenants/${PENDING_TENANT}`, { status: 'DELETED' })).status).toBe(422);
  });
});

describe('plans', () => {
  it('creates, edits and deletes plans; a plan in use cannot be deleted', async () => {
    const app = buildApp();
    const o = as(app, await signIn(app));
    const id = (await o.post('/plans', { name: 'المتقدمة', max_students: 500, max_storage_gb: 50, monthly_price: 299 })).body.data.id as string;
    expect((await o.post('/plans', { name: 'المتقدمة', max_students: 1, max_storage_gb: 1, monthly_price: 0 })).body.error.code).toBe('PLAN_EXISTS');
    expect((await o.put(`/plans/${id}`, { name: 'المتقدمة+', max_students: 800, max_storage_gb: 80, monthly_price: 399 })).status).toBe(200);
    const plans = (await o.get('/plans')).body.data;
    expect(plans.find((p: { id: string }) => p.id === id)).toMatchObject({ name: 'المتقدمة+', max_students: 800, monthly_price: 399 });

    await o.post(`/tenants/${PENDING_TENANT}/approve`, { plan_id: id, months: 1, features: ALL_FEATURES });
    expect((await o.del(`/plans/${id}`)).body.error.code).toBe('PLAN_IN_USE');
    await o.put(`/tenants/${PENDING_TENANT}`, { plan_id: null });
    expect((await o.del(`/plans/${id}`)).status).toBe(204);
    expect((await o.post('/plans', { name: 'x', max_students: 0, max_storage_gb: 1, monthly_price: 1 })).status).toBe(422);
  });
});

describe('what an academy may use', () => {
  const original = { ...tenants[TENANT_A]! };
  afterEach(() => {
    Object.assign(tenants[TENANT_A]!, original);
  });
  const learner = (app: ReturnType<typeof buildApp>, path: string) => request(app).get(`/api/v1${path}`).set('x-tenant-slug', 'rukn').set('Authorization', `Bearer ${learnerToken}`);

  it('an expired subscription blocks the whole academy; an unexpired or open-ended one does not', async () => {
    const app = buildApp();
    tenants[TENANT_A]!.subscriptionEndsAt = new Date(Date.now() - 1000);
    const blocked = await request(app).get('/api/v1/tenant').set('x-tenant-slug', 'rukn');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
    tenants[TENANT_A]!.subscriptionEndsAt = new Date(Date.now() + 86_400_000);
    expect((await request(app).get('/api/v1/tenant').set('x-tenant-slug', 'rukn')).status).toBe(200);
    tenants[TENANT_A]!.subscriptionEndsAt = null;
    expect((await request(app).get('/api/v1/tenant').set('x-tenant-slug', 'rukn')).status).toBe(200);
  });

  it('a pending academy is not reachable until it is approved', async () => {
    const app = buildApp();
    tenants[TENANT_A]!.status = 'PROVISIONING';
    const r = await request(app).get('/api/v1/tenant').set('x-tenant-slug', 'rukn');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('TENANT_INACTIVE');
  });

  it('a module the owner switched off answers 403 FEATURE_DISABLED', async () => {
    const app = buildApp();
    expect((await learner(app, '/me/health')).status).toBe(200);
    tenants[TENANT_A]!.features = { health: false, recorded: true };
    const off = await learner(app, '/me/health');
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('FEATURE_DISABLED');
    const admin = await request(app).get('/api/v1/admin/health').set('x-tenant-slug', 'rukn').set('Authorization', `Bearer ${adminToken}`);
    expect(admin.body.error.code).toBe('FEATURE_DISABLED');

    tenants[TENANT_A]!.features = { health: true, recorded: false };
    expect((await learner(app, '/me/health')).status).toBe(200);
    const recorded = await request(app).get('/api/v1/admin/recorded-courses').set('x-tenant-slug', 'rukn').set('Authorization', `Bearer ${adminToken}`);
    expect(recorded.body.error.code).toBe('FEATURE_DISABLED');
  });
});
