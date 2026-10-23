/** HTTP contracts for the learner journey, protected video, certificates, Zoom webhooks and custom domains. */
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { COURSE, TENANT_A, TENANT_B, adminToken, buildApp, learnerToken, sign } from './helpers/test-app';
import { CONTENT_KEY, PDF_LESSON, VIDEO_LESSON, ZOOM_MEETING, ZOOM_SECRET } from './helpers/learning-fakes';

type Fakes = ReturnType<typeof import('./helpers/learning-fakes').buildLearningFakes>;
const fakesOf = (app: ReturnType<typeof buildApp>) => app.locals.fakes as Fakes;
const as = (token: string, app = buildApp()) => ({
  app,
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  post: (p: string) => request(app).post(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  put: (p: string) => request(app).put(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
  del: (p: string) => request(app).delete(`/api/v1${p}`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${token}`),
});

describe('POST /api/v1/auth/register (PRD §6)', () => {
  const reg = (body: object) => request(buildApp()).post('/api/v1/auth/register').set('x-tenant-slug', 'rukn').send(body);

  it('creates a LEARNER in this academy and signs them in (201)', async () => {
    const res = await reg({ full_name: 'Reem Aldosari', email: 'reem@new.test', password: 'Str0ngPass!' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ token_type: 'Bearer', user: { email: 'reem@new.test', role: 'LEARNER' } });
  });

  it('cannot self-assign a role', async () => {
    const res = await reg({ full_name: 'Sneaky Admin', email: 'x@new.test', password: 'Str0ngPass!', role: 'TENANT_ADMIN' });
    expect(res.body.data.user.role).toBe('LEARNER');
  });

  it('409 for an existing email, 422 for weak passwords', async () => {
    expect((await reg({ full_name: 'Dup User', email: 'learner@rukn.test', password: 'Str0ngPass!' })).body.error.code).toBe('EMAIL_TAKEN');
    expect((await reg({ full_name: 'Weak User', email: 'w@new.test', password: '123' })).status).toBe(422);
  });
});

describe('learner portal /api/v1/me', () => {
  it('lists my enrollments and my course outline with per-lesson completion', async () => {
    const me = as(learnerToken);
    const list = await me.get('/me/enrollments');
    expect(list.body.data[0]).toMatchObject({ course_id: COURSE, course_title: 'PMP', progress: 0, certificate_code: null });
    const course = await me.get(`/me/courses/${COURSE}`);
    expect(course.body.data.modules[0].lessons).toEqual([
      expect.objectContaining({ id: VIDEO_LESSON, content_type: 'VIDEO', media_url: null, video_ready: true, completed: false }),
      expect.objectContaining({ id: PDF_LESSON, content_type: 'PDF', media_url: 'https://example.com/guide.pdf', completed: false }),
    ]);
  });

  it('403 for a course I am not enrolled in; 401 without a token', async () => {
    const other = sign({ sub: 'someone-else', tid: TENANT_A, role: 'LEARNER' });
    expect((await as(other).get(`/me/courses/${COURSE}`)).status).toBe(403);
    expect((await request(buildApp()).get('/api/v1/me/enrollments').set('x-tenant-id', TENANT_A)).status).toBe(401);
  });

  it('completing every lesson issues a certificate that anyone can verify', async () => {
    const me = as(learnerToken);
    const first = await me.post(`/me/lessons/${VIDEO_LESSON}/complete`);
    expect(first.body.data).toEqual({ progress: 50, completed: false, certificate_code: null });
    const last = await me.post(`/me/lessons/${PDF_LESSON}/complete`);
    expect(last.body.data.completed).toBe(true);
    const code = last.body.data.certificate_code as string;
    expect(code).toMatch(/^T3L-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);

    // Public verification: no tenant header, no auth.
    const verify = await request(me.app).get(`/api/v1/certificates/verify/${code.toLowerCase()}`);
    expect(verify.status).toBe(200);
    expect(verify.body.data).toMatchObject({ valid: true, code, learner_name: 'Abdullah', course_title: 'PMP', training_hours: 35, academy: { name: 'Rukn', slug: 'rukn' } });

    // It shows in the academy's dashboard list.
    expect((await as(adminToken, me.app).get('/admin/certificates')).body.data[0]).toMatchObject({ code, course_title: 'PMP' });
  });

  it('verification 404s for unknown or malformed codes', async () => {
    expect((await request(buildApp()).get('/api/v1/certificates/verify/T3L-2222-2222')).status).toBe(404);
    expect((await request(buildApp()).get("/api/v1/certificates/verify/' OR 1=1 --")).status).toBe(404);
  });

  it('my live sessions include the join link (enrolled only)', async () => {
    const res = await as(learnerToken).get('/me/classrooms');
    expect(res.body.data[0]).toMatchObject({ title: 'Live Q&A', join_url: 'https://zoom.us/j/1' });
  });
});

describe('protected video delivery (SWET §5)', () => {
  async function playback() {
    const me = as(learnerToken);
    const p = await me.get(`/me/lessons/${VIDEO_LESSON}/playback`);
    expect(p.status).toBe(200);
    expect(p.headers['cache-control']).toBe('no-store');
    return { app: me.app, path: p.body.data.playlist_path as string };
  }
  const media = (app: ReturnType<typeof buildApp>, path: string, tenant = TENANT_A) => request(app).get(`/api/v1${path}`).set('x-tenant-id', tenant);

  it('serves a playlist whose key and segments carry the signed token', async () => {
    const { app, path } = await playback();
    const res = await media(app, path);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    expect(res.text).toMatch(/URI="key\?token=[^"]+"/);
    expect(res.text).toMatch(/^segments\/seg_0000\.ts\?token=/m);
  });

  it('serves the AES key (no-store) and an encrypted segment for a valid token', async () => {
    const { app, path } = await playback();
    const token = path.split('token=')[1];
    const key = await media(app, `/media/lessons/${VIDEO_LESSON}/key?token=${token}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(key.status).toBe(200);
    expect(key.headers['cache-control']).toBe('no-store, private');
    expect(Buffer.from(key.body as Buffer)).toEqual(CONTENT_KEY);
    const seg = await media(app, `/media/lessons/${VIDEO_LESSON}/segments/seg_0000.ts?token=${token}`);
    expect(seg.status).toBe(200);
    expect(seg.headers['content-type']).toBe('video/mp2t');
  });

  it('refuses media without a token, with a forged token, or from another academy', async () => {
    const { app, path } = await playback();
    const token = path.split('token=')[1] ?? '';
    expect((await media(app, `/media/lessons/${VIDEO_LESSON}/key`)).status).toBe(403);
    expect((await media(app, `/media/lessons/${VIDEO_LESSON}/key?token=${token.slice(0, -4)}AAAA`)).status).toBe(403);
    expect((await media(app, `/media/lessons/${VIDEO_LESSON}/key?token=${token}`, TENANT_B)).status).toBe(403);
  });

  it('revoking the enrollment stops the key immediately, even with a still-valid token', async () => {
    const { app, path } = await playback();
    const token = path.split('token=')[1];
    fakesOf(app).state.activeEnrollments.clear();
    expect((await media(app, `/media/lessons/${VIDEO_LESSON}/key?token=${token}`)).status).toBe(403);
  });

  it('non-enrolled users cannot get a playback token', async () => {
    const other = sign({ sub: 'someone-else', tid: TENANT_A, role: 'LEARNER' });
    expect((await as(other).get(`/me/lessons/${VIDEO_LESSON}/playback`)).status).toBe(403);
  });
});

describe('course content admin + video upload', () => {
  it('admin manages modules/lessons; learners are refused', async () => {
    const admin = as(adminToken);
    expect((await admin.get(`/admin/courses/${COURSE}/content`)).status).toBe(200);
    expect((await admin.post(`/admin/courses/${COURSE}/modules`).send({ title: 'Week 2' })).status).toBe(201);
    expect((await admin.post('/admin/modules/d3000000-0000-4000-8000-000000000001/lessons').send({ title: 'Doc', content_type: 'PDF', media_url: 'https://example.com/doc.pdf' })).status).toBe(201);
    expect((await admin.post('/admin/modules/d3000000-0000-4000-8000-000000000001/lessons').send({ title: 'Doc', content_type: 'PDF', media_url: 'http://insecure/doc.pdf' })).status).toBe(422);
    expect((await admin.del(`/admin/lessons/${PDF_LESSON}`)).status).toBe(204);
    expect((await as(learnerToken).get(`/admin/courses/${COURSE}/content`)).status).toBe(403);
  });

  it('accepts a real MP4 upload (202 + queued) and rejects disguised files', async () => {
    const admin = as(adminToken);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), Buffer.alloc(500)]);
    const ok = await admin.put(`/admin/lessons/${VIDEO_LESSON}/video`).set('Content-Type', 'video/mp4').send(mp4);
    expect(ok.status).toBe(202);
    expect(fakesOf(admin.app).state.videoJobs).toEqual([{ kind: 'transcode', tenantId: TENANT_A, lessonId: VIDEO_LESSON }]);
    const html = await admin.put(`/admin/lessons/${VIDEO_LESSON}/video`).set('Content-Type', 'video/mp4').send(Buffer.from('<html>evil</html>'));
    expect(html.status).toBe(422);
    const wrongType = await admin.put(`/admin/lessons/${VIDEO_LESSON}/video`).set('Content-Type', 'text/html').send(mp4);
    expect(wrongType.status).toBe(422);
    const tooBig = await admin.put(`/admin/lessons/${VIDEO_LESSON}/video`).set('Content-Type', 'video/mp4').send(Buffer.concat([mp4, Buffer.alloc(70 * 1024)]));
    expect(tooBig.status).toBe(413);
  });

  it('classroom attendance is visible to the admin', async () => {
    const res = await as(adminToken).get('/admin/classrooms/a3000000-0000-4000-8000-000000000001/attendance');
    expect(res.body.data).toEqual([{ name: 'Abdullah', email: 'learner@rukn.test', joined_at: '2030-01-01T15:01:00.000Z', is_trainee: true }]);
  });
});

describe('POST /api/v1/webhooks/zoom', () => {
  const post = (app: ReturnType<typeof buildApp>, body: object, opts: { badSig?: boolean } = {}) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v0=${createHmac('sha256', ZOOM_SECRET).update(`v0:${ts}:${raw}`).digest('hex')}`;
    return request(app)
      .post('/api/v1/webhooks/zoom')
      .set('Content-Type', 'application/json')
      .set('x-zm-request-timestamp', ts)
      .set('x-zm-signature', opts.badSig ? 'v0=00' : sig)
      .send(raw);
  };

  it('answers url_validation with the HMAC of the plain token', async () => {
    const res = await post(buildApp(), { event: 'endpoint.url_validation', payload: { plainToken: 'p123' } });
    expect(res.body).toEqual({ plainToken: 'p123', encryptedToken: createHmac('sha256', ZOOM_SECRET).update('p123').digest('hex') });
  });

  it('records attendance from a signed participant_joined (verified over the raw bytes)', async () => {
    const app = buildApp();
    const res = await post(app, { event: 'meeting.participant_joined', payload: { object: { id: Number(ZOOM_MEETING), participant: { user_name: 'Reem', email: 'reem@x.test' } } } });
    expect(res.status).toBe(200);
    expect(fakesOf(app).state.attendance).toEqual([expect.objectContaining({ email: 'reem@x.test', name: 'Reem' })]);
  });

  it('401 for a bad signature — nothing recorded', async () => {
    const app = buildApp();
    const res = await post(app, { event: 'meeting.participant_joined', payload: { object: { id: Number(ZOOM_MEETING), participant: { email: 'x@y.z' } } } }, { badSig: true });
    expect(res.status).toBe(401);
    expect(fakesOf(app).state.attendance).toEqual([]);
  });
});

describe('custom domain (PRD §6 "النطاق")', () => {
  it('set -> DNS instructions; verify fails until the TXT record exists; then the edge can resolve it', async () => {
    const admin = as(adminToken);
    const set = await admin.put('/tenant/domain').send({ domain: 'academy.example.com' });
    expect(set.body.data).toMatchObject({ domain: 'academy.example.com', verified: false, dns: { txt: { name: '_t3leem-challenge.academy.example.com' }, cname: { target: 'cname.t3leem.my' } } });
    // Not yet resolvable at the edge:
    expect((await request(admin.app).get('/api/v1/platform/domains/academy.example.com')).status).toBe(404);
    const verified = await admin.post('/tenant/domain/verify');
    expect(verified.body.data.verified).toBe(true);
    expect((await request(admin.app).get('/api/v1/platform/domains/academy.example.com')).body.data).toEqual({ slug: 'rukn' });
    expect((await admin.del('/tenant/domain')).status).toBe(204);
  });

  it('rejects platform subdomains, taken domains, and missing DNS proof', async () => {
    const admin = as(adminToken);
    expect((await admin.put('/tenant/domain').send({ domain: 'evil.t3leem.my' })).body.error.code).toBe('PLATFORM_DOMAIN');
    expect((await admin.put('/tenant/domain').send({ domain: 'taken.example.com' })).body.error.code).toBe('DOMAIN_TAKEN');
    await admin.put('/tenant/domain').send({ domain: 'nodns.example.com' });
    expect((await admin.post('/tenant/domain/verify')).body.error.code).toBe('DNS_RECORD_NOT_FOUND');
    expect((await as(learnerToken).put('/tenant/domain').send({ domain: 'x.example.com' })).status).toBe(403);
  });
});
