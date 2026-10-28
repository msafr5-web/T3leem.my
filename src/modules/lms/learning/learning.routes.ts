import { Router, type Request, type Response } from 'express';
import { param } from 'express-validator';
import { authenticate, requireAuthContext, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import type { VideoService } from '../media/video.service';
import type { LearningService } from './learning.service';

/** Learner portal: /api/v1/me — any signed-in user of this academy, scoped to their own data. */
export function buildLearnerRouter(learning: LearningService, video: VideoService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use(authenticate(jwt));
  const ctx = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, userId: user.id };
  };

  router.get('/enrollments', async (req: Request, res: Response) => {
    const { tenantId, userId } = ctx(req);
    const rows = await learning.myEnrollments(tenantId, userId);
    res.json(
      ok(
        rows.map((e) => ({
          enrollment_id: e.enrollmentId,
          course_id: e.courseId,
          course_title: e.courseTitle,
          trainer_name: e.trainerName,
          status: e.status,
          completion_status: e.completionStatus,
          progress: e.progress,
          lesson_count: e.lessonCount,
          certificate_code: e.certificateCode,
          enrolled_at: e.enrolledAt.toISOString(),
        })),
      ),
    );
  });

  router.get('/courses/:id', param('id').isUUID(), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, userId } = ctx(req);
    const c = await learning.myCourse(tenantId, userId, req.params.id);
    res.json(
      ok({
        enrollment_id: c.enrollmentId,
        course_title: c.courseTitle,
        progress: c.progress,
        completion_status: c.completionStatus,
        certificate_code: c.certificateCode,
        youtube_video_id: c.youtubeVideoId,
        schedule: c.schedule ? { break_minutes: c.schedule.breakMinutes, discussion_minutes: c.schedule.discussionMinutes } : null,
        source: c.source
          ? { channel_url: c.source.channelUrl, channel_name: c.source.channelName, starts_at: c.source.startsAt?.toISOString() ?? null }
          : null,
        modules: c.modules.map((m) => ({
          id: m.id,
          title: m.title,
          lessons: m.lessons.map((l) => ({
            id: l.id,
            title: l.title,
            content_type: l.contentType,
            media_url: l.mediaUrl,
            video_ready: l.contentType === 'VIDEO' ? l.hlsStatus === 'READY' : null,
            duration_seconds: l.durationSeconds,
            start_second: l.startSecond,
            end_second: l.endSecond,
            completed: l.completed,
          })),
        })),
      }),
    );
  });

  router.post('/lessons/:id/complete', param('id').isUUID(), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, userId } = ctx(req);
    const r = await learning.completeLesson(tenantId, userId, req.params.id);
    res.json(ok({ progress: r.progress, completed: r.completed, certificate_code: r.certificateCode }));
  });

  router.get('/lessons/:id/playback', param('id').isUUID(), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, userId } = ctx(req);
    const p = await video.issuePlayback(tenantId, userId, req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok({ playlist_path: p.playlistPath, expires_in: p.expiresIn }));
  });

  router.get('/classrooms', async (req: Request, res: Response) => {
    const { tenantId, userId } = ctx(req);
    const rows = await learning.myUpcomingClassrooms(tenantId, userId);
    res.json(
      ok(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          starts_at: r.startsAt.toISOString(),
          duration_minutes: r.durationMinutes,
          provider: r.provider,
          // Enrolled learners get the join link; the public site never does.
          join_url: r.joinUrl,
          course_title: r.courseTitle,
        })),
      ),
    );
  });

  return router;
}

/** PRD §6 GET /api/v1/certificates/verify/:code — public, no tenant needed (code is global). */
export function buildCertificateVerifyRouter(learning: LearningService): Router {
  const router = Router();
  router.get('/verify/:code', async (req: Request<{ code: string }>, res: Response) => {
    const c = await learning.verifyCertificate(req.params.code);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(
      ok({
        valid: true,
        code: c.code,
        issued_at: c.issuedAt.toISOString(),
        learner_name: c.learnerName,
        course_title: c.courseTitle,
        training_hours: c.trainingHours,
        accreditation_number: c.accreditationNumber,
        license_number: c.licenseNumber,
        trainer_name: c.trainerName,
        academy: { name: c.academyName, slug: c.academySlug },
      }),
    );
  });
  return router;
}
