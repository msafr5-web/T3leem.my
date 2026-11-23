/** HTTP contracts for recorded (YouTube) courses: preview, creation, and per-day discussions. */
import request from 'supertest';
import { ADMIN, TENANT_A, TENANT_B, TRAINER, USER, adminToken, buildApp, learnerToken, sign } from './helpers/test-app';
import { PLAN_ID, YT_NO_DURATION, YT_NO_EMBED, YT_OK, YT_OK_2, YT_PRIVATE } from './helpers/recorded-fakes';

type Recorded = ReturnType<typeof import('./helpers/recorded-fakes').buildRecordedFakes>;
const recordedOf = (app: ReturnType<typeof buildApp>) => app.locals.recorded as Recorded;

const call = (app: ReturnType<typeof buildApp>, token: string, tenant = TENANT_A) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: object = {}) => request(app).post(`/api/v1${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
});

const createBody = { youtube_url: `https://www.youtube.com/watch?v=${YT_OK}`, trainer_id: TRAINER, price: 0 };

describe('POST /api/v1/admin/recorded-courses/preview', () => {
  it('reads the duration from YouTube and proposes 2 × ~10.5 min lectures with the default breaks', async () => {
    const res = await call(buildApp(), adminToken).post('/admin/recorded-courses/preview', { youtube_url: `https://youtu.be/${YT_OK}` });
    expect(res.status).toBe(200);
    expect(res.body.data.video).toMatchObject({ id: YT_OK, duration_seconds: 1265, duration_source: 'youtube', channel: 'Syntax' });
    expect(res.body.data.config).toEqual({ split_mode: 'balanced', max_lecture_minutes: 15, min_lecture_minutes: 10, break_minutes: 5, discussion_minutes: 15, daily_video_minutes: 60 });
    expect(res.body.data.plan.days).toEqual([
      { day: 1, video_seconds: 1265, break_count: 1, total_minutes: 41, lectures: [{ start_second: 0, end_second: 632 }, { start_second: 632, end_second: 1265 }] },
    ]);
  });

  it('explains every YouTube failure with its own code', async () => {
    const admin = call(buildApp(), adminToken);
    const code = async (url: string, extra: object = {}) => (await admin.post('/admin/recorded-courses/preview', { youtube_url: url, ...extra })).body.error?.code;
    expect(await code('https://example.com/video')).toBe('INVALID_YOUTUBE_URL');
    expect(await code(`https://youtu.be/${YT_PRIVATE}`)).toBe('YOUTUBE_VIDEO_NOT_FOUND');
    expect(await code(`https://youtu.be/${YT_NO_EMBED}`)).toBe('YOUTUBE_NOT_EMBEDDABLE');
    expect(await code(`https://youtu.be/${YT_NO_DURATION}`)).toBe('YOUTUBE_DURATION_UNKNOWN');
    expect(await code(`https://youtu.be/${YT_OK}`, { days: 10 })).toBe('TOO_MANY_DAYS');
  });

  it('accepts a manual duration only when YouTube cannot provide one', async () => {
    const admin = call(buildApp(), adminToken);
    const manual = await admin.post('/admin/recorded-courses/preview', { youtube_url: `https://youtu.be/${YT_NO_DURATION}`, manual_duration_seconds: 7200 });
    expect(manual.body.data.video).toMatchObject({ duration_seconds: 7200, duration_source: 'manual' });
    expect(manual.body.data.plan.days).toHaveLength(2);
    // A wrong manual value can't override the real duration.
    const ignored = await admin.post('/admin/recorded-courses/preview', { youtube_url: `https://youtu.be/${YT_OK}`, manual_duration_seconds: 7200 });
    expect(ignored.body.data.video.duration_seconds).toBe(1265);
  });

  it('is admin-only: 401 anonymous, 403 learner, 422 on out-of-range settings', async () => {
    const app = buildApp();
    expect((await request(app).post('/api/v1/admin/recorded-courses/preview').set('x-tenant-id', TENANT_A).send(createBody)).status).toBe(401);
    expect((await call(app, learnerToken).post('/admin/recorded-courses/preview', createBody)).status).toBe(403);
    expect((await call(app, adminToken).post('/admin/recorded-courses/preview', { ...createBody, break_minutes: 99 })).status).toBe(422);
  });
});

describe('POST /api/v1/admin/recorded-courses', () => {
  it('creates the course with one day of YOUTUBE lectures, defaulting the title to the video title', async () => {
    const app = buildApp();
    const res = await call(app, adminToken).post('/admin/recorded-courses', createBody);
    expect(res.status).toBe(201);
    const saved = recordedOf(app).courses.get(res.body.data.id)!;
    expect(saved).toMatchObject({ title: 'تعلم GitHub في أقل من 30 دقيقة', videoId: YT_OK, durationSeconds: 1265, isPublished: false, trainingHours: 0.6, price: '0.00' });
    expect(saved.days).toEqual([
      {
        title: 'اليوم 1',
        lessons: [
          { title: 'الجزء 1 (0:00 – 10:32)', startSecond: 0, endSecond: 632 },
          { title: 'الجزء 2 (10:32 – 21:05)', startSecond: 632, endSecond: 1265 },
        ],
      },
    ]);
    const list = await call(app, adminToken).get('/admin/recorded-courses');
    expect(list.body.data).toEqual([expect.objectContaining({ id: res.body.data.id, day_count: 1, lecture_count: 2, video_id: YT_OK })]);
  });

  it('rejects a trainer from another academy and never leaks across tenants', async () => {
    const app = buildApp();
    const res = await call(app, adminToken).post('/admin/recorded-courses', { ...createBody, trainer_id: '0b9f4e6a-2c1d-4e8f-8a7b-000000000099' });
    expect(res.body.error.code).toBe('UNKNOWN_TRAINER');
    const created = await call(app, adminToken).post('/admin/recorded-courses', createBody);
    const otherAdmin = sign({ sub: ADMIN, tid: TENANT_B, role: 'TENANT_ADMIN' });
    expect((await call(app, otherAdmin, TENANT_B).get(`/admin/recorded-courses/${created.body.data.id}`)).status).toBe(404);
  });
});

describe('day discussion boards', () => {
  async function setup() {
    const app = buildApp();
    const created = await call(app, adminToken).post('/admin/recorded-courses', createBody);
    const detail = await call(app, adminToken).get(`/admin/recorded-courses/${created.body.data.id}`);
    return { app, courseId: created.body.data.id as string, dayId: detail.body.data.days[0].id as string };
  }

  it('enrolled learners ask, staff reply, and everyone sees the thread', async () => {
    const { app, courseId, dayId } = await setup();
    recordedOf(app).enroll(USER, courseId);
    const learner = call(app, learnerToken);
    const asked = await learner.post(`/me/modules/${dayId}/discussion`, { body: 'ما الفرق بين commit و push؟' });
    expect(asked.status).toBe(201);
    const replied = await call(app, adminToken).post(`/admin/modules/${dayId}/discussion`, { body: 'commit محلي و push يرفع للخادم.', parent_id: asked.body.data.id });
    expect(replied.status).toBe(201);

    const thread = await learner.get(`/me/modules/${dayId}/discussion`);
    expect(thread.body.data).toEqual([
      expect.objectContaining({
        body: 'ما الفرق بين commit و push؟',
        author_name: 'Sara',
        author_is_staff: false,
        mine: true,
        replies: [expect.objectContaining({ author_name: 'Admin', author_is_staff: true, mine: false })],
      }),
    ]);
  });

  it('403 for learners who are not enrolled; 404 when replying to a missing question; 422 for empty posts', async () => {
    const { app, courseId, dayId } = await setup();
    const learner = call(app, learnerToken);
    expect((await learner.get(`/me/modules/${dayId}/discussion`)).status).toBe(403);
    recordedOf(app).enroll(USER, courseId);
    expect((await learner.post(`/me/modules/${dayId}/discussion`, { body: ' ' })).status).toBe(422);
    const orphan = await learner.post(`/me/modules/${dayId}/discussion`, { body: 'reply', parent_id: '00000000-9999-4000-8000-000000000000' });
    expect(orphan.body.error.code).toBe('POST_NOT_FOUND');
  });
});

describe('channel, start date and lecture time', () => {
  it('defaults the channel to the one YouTube reports; supervisor values win; dates are Saudi time', async () => {
    const app = buildApp();
    const auto = await call(app, adminToken).post('/admin/recorded-courses', createBody);
    expect(recordedOf(app).courses.get(auto.body.data.id)).toMatchObject({ channelUrl: 'https://www.youtube.com/@mostfa-syntax', channelName: 'Syntax', startsAt: null });

    const custom = await call(app, adminToken).post('/admin/recorded-courses', {
      ...createBody,
      channel_url: 'https://youtube.com/@With_fouad/videos?view=0',
      channel_name: 'مع فؤاد',
      starts_on: '2026-11-01',
      lecture_time: '19:00',
    });
    const saved = recordedOf(app).courses.get(custom.body.data.id)!;
    expect(saved).toMatchObject({ channelUrl: 'https://www.youtube.com/@With_fouad', channelName: 'مع فؤاد' });
    expect(saved.startsAt!.toISOString()).toBe('2026-11-01T16:00:00.000Z'); // 19:00 Riyadh = 16:00 UTC
    const detail = await call(app, adminToken).get(`/admin/recorded-courses/${custom.body.data.id}`);
    expect(detail.body.data).toMatchObject({ channel_url: 'https://www.youtube.com/@With_fouad', starts_at: '2026-11-01T16:00:00.000Z' });
  });

  it('rejects non-YouTube channel links and malformed times', async () => {
    const admin = call(buildApp(), adminToken);
    expect((await admin.post('/admin/recorded-courses', { ...createBody, channel_url: 'https://evil.com/@x' })).body.error.code).toBe('INVALID_CHANNEL_URL');
    expect((await admin.post('/admin/recorded-courses', { ...createBody, starts_on: '2026-11-01', lecture_time: '25:00' })).status).toBe(422);
  });

  it('attaches a YouTube schedule to an empty course from the regular course form, and updates its source later', async () => {
    const app = buildApp();
    const plainId = 'c0a80121-872f-41ed-a1eb-0242ac1200aa';
    recordedOf(app).addPlainCourse(TENANT_A, plainId);
    const admin = call(app, adminToken);
    const attached = await admin.post(`/admin/courses/${plainId}/youtube`, {
      youtube_url: `https://youtu.be/${YT_OK}`,
      split_mode: 'fixed',
      max_lecture_minutes: 10,
      starts_on: '2026-11-02',
      lecture_time: '18:30',
    });
    expect(attached.status).toBe(201);
    const saved = recordedOf(app).courses.get(plainId)!;
    // 21:05 every 10 minutes → 10, 10, and a 1-minute tail merged into the last lecture.
    expect(saved.days.flatMap((d) => d.lessons.map((l) => [l.startSecond, l.endSecond]))).toEqual([
      [0, 600],
      [600, 1265],
    ]);
    expect(saved.startsAt!.toISOString()).toBe('2026-11-02T15:30:00.000Z');
    // A second attach (or a course with hand-built content) is refused.
    expect((await admin.post(`/admin/courses/${plainId}/youtube`, { youtube_url: `https://youtu.be/${YT_OK}` })).body.error.code).toBe('COURSE_HAS_CONTENT');

    const updated = await request(app)
      .put(`/api/v1/admin/recorded-courses/${plainId}/source`)
      .set('x-tenant-id', TENANT_A)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channel_name: 'With Fouad', starts_on: '2026-11-05', lecture_time: '20:00' });
    expect(updated.status).toBe(200);
    expect(recordedOf(app).courses.get(plainId)).toMatchObject({ channelName: 'With Fouad', startsAt: new Date('2026-11-05T17:00:00Z') });
  });
});



describe('POST /api/v1/admin/recorded-courses/batch (several recorded courses for one trainer, into a plan)', () => {
  const url = (id: string) => `https://youtu.be/${id}`;
  const batch = (app: ReturnType<typeof buildApp>, body: object, token = adminToken, tenant = TENANT_A) => call(app, token, tenant).post('/admin/recorded-courses/batch', body);

  it('creates one course per link for the trainer, titled by the video unless a title is given, and appends them to the plan in order', async () => {
    const app = buildApp();
    const res = await batch(app, { trainer_id: TRAINER, plan_id: PLAN_ID, price: 0, items: [{ youtube_url: url(YT_OK) }, { youtube_url: url(YT_OK_2), title: 'الداتا سنتر - الحلقة الثانية' }] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ plan_linked: true, created: 2, failed: 0 });
    const [a, b] = res.body.data.results as { id: string; title: string; status: string; days: number; training_hours: number }[];
    expect(a).toMatchObject({ status: 'created', title: 'تعلم GitHub في أقل من 30 دقيقة', days: 1 });
    expect(b).toMatchObject({ status: 'created', title: 'الداتا سنتر - الحلقة الثانية' });

    const rec = recordedOf(app);
    expect([...rec.courses.values()].map((c) => [c.trainerId, c.isPublished])).toEqual([[TRAINER, false], [TRAINER, false]]);
    expect(rec.plans.get(PLAN_ID)).toEqual([a?.id, b?.id]);
  });

  it('a bad line fails alone with its own code; the good ones are still created and linked; repeats are flagged', async () => {
    const app = buildApp();
    const res = await batch(app, {
      trainer_id: TRAINER,
      plan_id: PLAN_ID,
      items: [{ youtube_url: url(YT_OK) }, { youtube_url: url(YT_PRIVATE) }, { youtube_url: url(YT_NO_EMBED) }, { youtube_url: url(YT_NO_DURATION) }, { youtube_url: 'https://example.com/x1234567' }, { youtube_url: url(YT_OK) }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 1, failed: 5, plan_linked: true });
    expect(res.body.data.results.map((r: { status: string; code: string | null }) => r.code)).toEqual([
      null,
      'YOUTUBE_VIDEO_NOT_FOUND',
      'YOUTUBE_NOT_EMBEDDABLE',
      'YOUTUBE_DURATION_UNKNOWN',
      'INVALID_YOUTUBE_URL',
      'DUPLICATE_IN_BATCH',
    ]);
    expect(recordedOf(app).plans.get(PLAN_ID)).toHaveLength(1);
  });

  it('works without a plan (courses only), and publishes them when asked', async () => {
    const app = buildApp();
    const res = await batch(app, { trainer_id: TRAINER, is_published: true, price: 150, items: [{ youtube_url: url(YT_OK) }] });
    expect(res.body.data).toMatchObject({ plan_linked: false, created: 1 });
    const course = [...recordedOf(app).courses.values()][0];
    expect(course).toMatchObject({ isPublished: true, price: '150.00' });
    expect(recordedOf(app).plans.get(PLAN_ID)).toEqual([]);
  });

  it('refuses a trainer or plan of another academy before creating anything', async () => {
    const app = buildApp();
    const other = 'f1000000-0000-4000-8000-0000000000ff';
    expect((await batch(app, { trainer_id: other, items: [{ youtube_url: url(YT_OK) }] })).body.error.code).toBe('UNKNOWN_TRAINER');
    expect((await batch(app, { trainer_id: TRAINER, plan_id: other, items: [{ youtube_url: url(YT_OK) }] })).body.error.code).toBe('PLAN_NOT_FOUND');
    expect(recordedOf(app).courses.size).toBe(0);
  });

  it('validates the body: 1-20 links, uuid ids, price range', async () => {
    const app = buildApp();
    expect((await batch(app, { trainer_id: TRAINER, items: [] })).status).toBe(422);
    expect((await batch(app, { trainer_id: TRAINER, items: Array.from({ length: 21 }, () => ({ youtube_url: url(YT_OK) })) })).status).toBe(422);
    expect((await batch(app, { trainer_id: 'nope', items: [{ youtube_url: url(YT_OK) }] })).status).toBe(422);
    expect((await batch(app, { trainer_id: TRAINER, price: -1, items: [{ youtube_url: url(YT_OK) }] })).status).toBe(422);
    expect((await batch(app, { trainer_id: TRAINER, items: [{ youtube_url: 'x' }] })).status).toBe(422);
    expect(recordedOf(app).courses.size).toBe(0);
  });

  it('is for the academy admin only', async () => {
    const app = buildApp();
    const body = { trainer_id: TRAINER, items: [{ youtube_url: url(YT_OK) }] };
    expect((await batch(app, body, learnerToken)).status).toBe(403);
    expect((await batch(app, body, adminToken, TENANT_B)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/recorded-courses/batch').set('x-tenant-id', TENANT_A).send(body)).status).toBe(401);
  });
});

describe('recorded courses inside a plan: no overlap, ordered by start date', () => {
  const create = (app: ReturnType<typeof buildApp>, extra: object, video = YT_OK) =>
    call(app, adminToken).post('/admin/recorded-courses', { youtube_url: `https://youtu.be/${video}`, trainer_id: TRAINER, price: 0, plan_id: PLAN_ID, ...extra });
  const planOf = (app: ReturnType<typeof buildApp>) => recordedOf(app).plans.get(PLAN_ID)!;
  const startOf = (app: ReturnType<typeof buildApp>, id: string) => recordedOf(app).courses.get(id)?.startsAt?.toISOString();

  // YT_OK is one 41-minute day: 19:00-19:41 Saudi time.
  it('adds a dated course to the plan with the normal recorded-course steps and settings', async () => {
    const app = buildApp();
    const res = await create(app, { title: 'Ep 1', starts_on: '2026-12-01', lecture_time: '19:00', max_lecture_minutes: 15 });
    expect(res.status).toBe(201);
    expect(planOf(app)).toEqual([res.body.data.id]);
    expect(startOf(app, res.body.data.id)).toBe('2026-12-01T16:00:00.000Z');
  });

  it('refuses a course that overlaps another one of the plan, says which, and suggests the first free start (same time of day)', async () => {
    const app = buildApp();
    await create(app, { title: 'Ep 1', starts_on: '2026-12-01', lecture_time: '19:00' });
    const clash = await create(app, { title: 'Ep 2', starts_on: '2026-12-01', lecture_time: '19:30' }, YT_OK_2);
    expect(clash.status).toBe(422);
    expect(clash.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(clash.body.error.details.conflict).toMatchObject({ title: 'Ep 1', day: 1, other_day: 1 });
    expect(clash.body.error.details.suggested_start).toBe('2026-12-02T16:30:00.000Z'); // 2 December 19:30 Saudi time
    expect(planOf(app)).toHaveLength(1); // nothing was created
    expect(recordedOf(app).courses.size).toBe(1);
  });

  it('accepts the suggested start, and a course that starts exactly when the other ends', async () => {
    const app = buildApp();
    await create(app, { title: 'Ep 1', starts_on: '2026-12-01', lecture_time: '19:00' });
    expect((await create(app, { title: 'Ep 2', starts_on: '2026-12-02', lecture_time: '19:30' }, YT_OK_2)).status).toBe(201);
    expect((await create(app, { title: 'Ep 3', starts_on: '2026-12-01', lecture_time: '19:41', youtube_url: `https://youtu.be/${YT_OK}` })).status).toBe(201); // 19:41 = end of Ep 1
  });

  it('keeps the plan ordered by start date whatever order the courses are added in; undated courses stay last', async () => {
    const app = buildApp();
    const late = await create(app, { title: 'Late', starts_on: '2026-12-10', lecture_time: '19:00' });
    const undated = await create(app, { title: 'No date' }, YT_OK_2);
    const early = await create(app, { title: 'Early', starts_on: '2026-12-03', lecture_time: '19:00' }, YT_OK_2);
    const middle = await create(app, { title: 'Middle', starts_on: '2026-12-05', lecture_time: '19:00' }, YT_OK_2);
    expect(planOf(app)).toEqual([early.body.data.id, middle.body.data.id, late.body.data.id, undated.body.data.id]);
  });

  it('a course without a start date cannot conflict (nothing to compare), and a course outside any plan is unaffected', async () => {
    const app = buildApp();
    await create(app, { title: 'Ep 1', starts_on: '2026-12-01', lecture_time: '19:00' });
    expect((await create(app, { title: 'Undated' }, YT_OK_2)).status).toBe(201);
    const alone = await call(app, adminToken).post('/admin/recorded-courses', { youtube_url: `https://youtu.be/${YT_OK_2}`, trainer_id: TRAINER, price: 0, starts_on: '2026-12-01', lecture_time: '19:00' });
    expect(alone.status).toBe(201); // same slot, but not in the plan
  });

  it('moving a course\'s start date later re-checks every plan it is in, and re-orders them', async () => {
    const app = buildApp();
    const a = await create(app, { title: 'Alpha', starts_on: '2026-12-01', lecture_time: '19:00' });
    const b = await create(app, { title: 'Beta', starts_on: '2026-12-05', lecture_time: '19:00' }, YT_OK_2);
    const put = (id: string, body: object) => request(app).put(`/api/v1/admin/recorded-courses/${id}/source`).set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${adminToken}`).send(body);

    const clash = await put(b.body.data.id, { starts_on: '2026-12-01', lecture_time: '19:20' });
    expect(clash.status).toBe(422);
    expect(clash.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(startOf(app, b.body.data.id)).toBe('2026-12-05T16:00:00.000Z'); // unchanged

    expect((await put(a.body.data.id, { starts_on: '2026-12-09', lecture_time: '19:00' })).status).toBe(200);
    expect(planOf(app)).toEqual([b.body.data.id, a.body.data.id]); // A now starts after B
  });

  it('404 for a plan that is not this academy\'s, before anything is created', async () => {
    const app = buildApp();
    const res = await create(app, { title: 'Xyz', starts_on: '2026-12-01' }, YT_OK);
    expect(res.status).toBe(201);
    const other = await call(app, adminToken).post('/admin/recorded-courses', { youtube_url: `https://youtu.be/${YT_OK}`, trainer_id: TRAINER, price: 0, plan_id: 'b1000000-0000-4000-8000-0000000000ff' });
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('PLAN_NOT_FOUND');
    expect(recordedOf(app).courses.size).toBe(1);
  });
});
