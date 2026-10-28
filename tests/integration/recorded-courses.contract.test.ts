/** HTTP contracts for recorded (YouTube) courses: preview, creation, and per-day discussions. */
import request from 'supertest';
import { ADMIN, TENANT_A, TENANT_B, TRAINER, USER, adminToken, buildApp, learnerToken, sign } from './helpers/test-app';
import { YT_NO_DURATION, YT_NO_EMBED, YT_OK, YT_PRIVATE } from './helpers/recorded-fakes';

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
