import { Router, type Request, type Response } from 'express';
import { body, param } from 'express-validator';
import { UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireRoles, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import type { DiscussionPostRow } from './recorded.repository';
import type { RecordedCourseService, ScheduleRequest, SchedulePreview } from './recorded.service';
import { SCHEDULE_LIMITS, type ScheduleConfig } from './schedule-planner';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);
const L = SCHEDULE_LIMITS;

const scheduleRules = [
  body('youtube_url').isString().trim().isLength({ min: 11, max: 500 }).withMessage('youtube_url is required'),
  body('days').optional({ values: 'falsy' }).isInt({ min: L.days.min, max: L.days.max }),
  body('max_lecture_minutes').optional({ values: 'falsy' }).isInt(L.lectureMinutes),
  body('min_lecture_minutes').optional({ values: 'falsy' }).isInt(L.lectureMinutes),
  body('break_minutes').optional({ values: 'null' }).isInt(L.breakMinutes),
  body('discussion_minutes').optional({ values: 'null' }).isInt(L.discussionMinutes),
  body('daily_video_minutes').optional({ values: 'falsy' }).isInt(L.dailyVideoMinutes),
  body('manual_duration_seconds').optional({ values: 'falsy' }).isInt({ min: 60, max: L.maxVideoSeconds }),
];

const int = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));

function scheduleRequest(b: Record<string, unknown>): ScheduleRequest {
  const config: Partial<ScheduleConfig> = {};
  const set = (key: keyof ScheduleConfig, raw: unknown) => {
    const v = int(raw);
    if (v !== undefined) config[key] = v;
  };
  set('maxLectureMinutes', b.max_lecture_minutes);
  set('minLectureMinutes', b.min_lecture_minutes);
  set('breakMinutes', b.break_minutes);
  set('discussionMinutes', b.discussion_minutes);
  set('dailyVideoMinutes', b.daily_video_minutes);
  return { youtubeUrl: String(b.youtube_url).trim(), days: int(b.days) ?? null, config, manualDurationSeconds: int(b.manual_duration_seconds) ?? null };
}

const configJson = (c: ScheduleConfig) => ({
  max_lecture_minutes: c.maxLectureMinutes,
  min_lecture_minutes: c.minLectureMinutes,
  break_minutes: c.breakMinutes,
  discussion_minutes: c.discussionMinutes,
  daily_video_minutes: c.dailyVideoMinutes,
});

const previewJson = (p: SchedulePreview) => ({
  video: { id: p.video.videoId, title: p.video.title, channel: p.video.channel, duration_seconds: p.video.durationSeconds, duration_source: p.video.durationSource },
  config: configJson(p.config),
  plan: {
    video_seconds: p.plan.videoSeconds,
    lecture_count: p.plan.lectureCount,
    training_hours: p.plan.trainingHours,
    days: p.plan.days.map((d) => ({
      day: d.day,
      video_seconds: d.videoSeconds,
      break_count: d.breakCount,
      total_minutes: d.totalMinutes,
      lectures: d.lectures.map((l) => ({ start_second: l.startSecond, end_second: l.endSecond })),
    })),
  },
});

const postJson = (p: Omit<DiscussionPostRow, 'replies'>) => ({
  id: p.id,
  body: p.body,
  created_at: p.createdAt.toISOString(),
  author_name: p.authorName,
  // Learners only see whether the author is academy staff, never internal role names.
  author_is_staff: p.authorRole !== 'LEARNER',
  mine: p.mine,
});
const threadJson = (rows: DiscussionPostRow[]) => rows.map((p) => ({ ...postJson(p), replies: p.replies.map(postJson) }));

const postRules = [uuid('id'), body('body').isString().trim().isLength({ min: 2, max: 2000 }), body('parent_id').optional({ values: 'falsy' }).isUUID()];

function discussionHandlers(service: RecordedCourseService) {
  const who = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, user: { id: user.id, role: user.role } };
  };
  return {
    list: async (req: Request<{ id: string }>, res: Response) => {
      const { tenantId, user } = who(req);
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(threadJson(await service.listDiscussion(tenantId, user, req.params.id))));
    },
    post: async (req: Request<{ id: string }>, res: Response) => {
      const { tenantId, user } = who(req);
      const parentId = typeof req.body.parent_id === 'string' && req.body.parent_id ? req.body.parent_id : null;
      const id = await service.post(tenantId, user, req.params.id, String(req.body.body), parentId);
      res.status(201).json(ok({ id }));
    },
  };
}

/** Provider dashboard: /api/v1/admin/recorded-courses + day discussions (TENANT_ADMIN). */
export function buildRecordedAdminRouter(service: RecordedCourseService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const admin = [authenticate(jwt), requireRoles(UserRole.TENANT_ADMIN)];
  const discussion = discussionHandlers(service);

  router.post('/recorded-courses/preview', ...admin, ...scheduleRules, validate, async (req: Request, res: Response) => {
    res.json(ok(previewJson(await service.preview(scheduleRequest(req.body)))));
  });

  router.post(
    '/recorded-courses',
    ...admin,
    ...scheduleRules,
    body('title').optional({ values: 'falsy' }).isString().trim().isLength({ min: 3, max: 200 }),
    body('description').optional({ values: 'falsy' }).isString().isLength({ max: 5000 }),
    body('trainer_id').isUUID().withMessage('trainer_id must be a UUID'),
    body('price').isFloat({ min: 0, max: 1_000_000 }).withMessage('price must be 0 - 1,000,000 SAR'),
    body('is_published').optional().isBoolean(),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, user } = requireAuthContext(req);
      const b = req.body as Record<string, unknown>;
      const { id, preview } = await service.create(tenantId, { userId: user.id, role: user.role, ip: req.ip ?? null }, {
        ...scheduleRequest(b),
        title: typeof b.title === 'string' ? b.title : null,
        description: typeof b.description === 'string' && b.description.trim() ? b.description.trim() : null,
        trainerId: String(b.trainer_id),
        price: Number(b.price).toFixed(2),
        isPublished: b.is_published === true || b.is_published === 'true',
      });
      res.status(201).json(ok({ id, ...previewJson(preview) }));
    },
  );

  router.get('/recorded-courses', ...admin, async (req: Request, res: Response) => {
    const rows = await service.list(requireAuthContext(req).tenantId);
    res.json(
      ok(
        rows.map((c) => ({
          id: c.id,
          title: c.title,
          is_published: c.isPublished,
          video_id: c.videoId,
          duration_seconds: c.durationSeconds,
          day_count: c.dayCount,
          lecture_count: c.lectureCount,
          enrollment_count: c.enrollmentCount,
          post_count: c.postCount,
        })),
      ),
    );
  });

  router.get('/recorded-courses/:id', ...admin, uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const c = await service.get(requireAuthContext(req).tenantId, req.params.id);
    res.json(
      ok({
        id: c.id,
        title: c.title,
        is_published: c.isPublished,
        video_id: c.videoId,
        duration_seconds: c.durationSeconds,
        enrollment_count: c.enrollmentCount,
        training_hours: c.trainingHours,
        config: c.config ? configJson(c.config) : null,
        days: c.days.map((d) => ({
          id: d.id,
          title: d.title,
          post_count: d.postCount,
          lessons: d.lessons.map((l) => ({ id: l.id, title: l.title, start_second: l.startSecond, end_second: l.endSecond })),
        })),
      }),
    );
  });

  router.get('/modules/:id/discussion', ...admin, uuid('id'), validate, discussion.list);
  router.post('/modules/:id/discussion', ...admin, ...postRules, validate, discussion.post);
  return router;
}

/** Learner side: /api/v1/me/modules/:id/discussion — enrolled learners of that course only. */
export function buildRecordedLearnerRouter(service: RecordedCourseService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const discussion = discussionHandlers(service);
  router.get('/modules/:id/discussion', authenticate(jwt), uuid('id'), validate, discussion.list);
  router.post('/modules/:id/discussion', authenticate(jwt), ...postRules, validate, discussion.post);
  return router;
}
