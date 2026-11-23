import { Router, type Request, type Response } from 'express';
import { param } from 'express-validator';
import { UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireRoles, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { validate } from '../../shared/middlewares/validate.middleware';
import { ok } from '../../shared/utils/api-response';
import type { TrainerPortalService } from './trainer-portal.service';

/** The trainer's own pages: /api/v1/trainer. INSTRUCTOR accounts only; everything is about the caller's own trainer profile. */
export function buildTrainerPortalRouter(service: TrainerPortalService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use(authenticate(jwt), requireRoles(UserRole.INSTRUCTOR));
  const ctx = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, userId: user.id };
  };

  router.get('/overview', async (req: Request, res: Response) => {
    const { tenantId, userId } = ctx(req);
    const o = await service.overview(tenantId, userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      ok({
        trainer: { id: o.trainer.id, full_name: o.trainer.fullName, specialization: o.trainer.specialization, bio: o.trainer.bio },
        courses: o.courses.map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          is_published: c.isPublished,
          enrollment_count: c.enrollmentCount,
          starts_at: c.startsAt?.toISOString() ?? null,
          duration_days: c.durationDays,
        })),
        sessions: o.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          starts_at: s.startsAt.toISOString(),
          duration_minutes: s.durationMinutes,
          provider: s.provider,
          join_url: s.joinUrl,
          course_title: s.courseTitle,
        })),
      }),
    );
  });

  router.get('/courses/:id/trainees', param('id').isUUID().withMessage('id must be a UUID'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, userId } = ctx(req);
    const r = await service.courseTrainees(tenantId, userId, req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      ok({
        title: r.title,
        trainees: r.trainees.map((t) => ({
          name: t.name,
          progress_percentage: t.progress,
          completion_status: t.completionStatus,
          status: t.status,
          enrolled_at: t.enrolledAt.toISOString(),
        })),
      }),
    );
  });

  return router;
}
