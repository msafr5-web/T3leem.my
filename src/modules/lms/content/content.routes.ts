import { Router, type Request, type Response } from 'express';
import { body, param } from 'express-validator';
import { ContentType, UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireRoles, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import type { LearningService } from '../learning/learning.service';
import type { VideoService } from '../media/video.service';
import type { ContentService } from './content.service';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);

const actorOf = (req: Request): Actor => {
  const { user } = requireAuthContext(req);
  return { userId: user.id, role: user.role, ip: req.ip ?? null };
};
const tenantOf = (req: Request) => requireAuthContext(req).tenantId;

/** Course content + video upload + issued certificates. Mounted under /api/v1/admin (TENANT_ADMIN). */
export function buildContentAdminRouter(content: ContentService, video: VideoService, learning: LearningService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use(authenticate(jwt), requireRoles(UserRole.TENANT_ADMIN));

  router.get('/courses/:id/content', uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const modules = await content.getCourseContent(tenantOf(req), req.params.id);
    res.json(
      ok(
        modules.map((m) => ({
          id: m.id,
          title: m.title,
          sort_order: m.sortOrder,
          lessons: m.lessons.map((l) => ({
            id: l.id,
            title: l.title,
            content_type: l.contentType,
            sort_order: l.sortOrder,
            media_url: l.mediaUrl,
            hls_status: l.hlsStatus,
            hls_error: l.hlsError,
            duration_seconds: l.durationSeconds,
            start_second: l.startSecond,
            end_second: l.endSecond,
          })),
        })),
      ),
    );
  });

  router.post('/courses/:id/modules', uuid('id'), body('title').isString().trim().isLength({ min: 2, max: 200 }), validate, async (req: Request<{ id: string }>, res: Response) => {
    const id = await content.createModule(tenantOf(req), actorOf(req), req.params.id, String(req.body.title).trim());
    res.status(201).json(ok({ id }));
  });

  router.put(
    '/modules/:id',
    uuid('id'),
    body('title').optional().isString().trim().isLength({ min: 2, max: 200 }),
    body('sort_order').optional().isInt({ min: 0, max: 10_000 }),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const data: { title?: string; sortOrder?: number } = {};
      if (req.body.title !== undefined) data.title = String(req.body.title).trim();
      if (req.body.sort_order !== undefined) data.sortOrder = Number(req.body.sort_order);
      await content.updateModule(tenantOf(req), actorOf(req), req.params.id, data);
      res.json(ok({ id: req.params.id }));
    },
  );

  router.delete('/modules/:id', uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    await content.deleteModule(tenantOf(req), actorOf(req), req.params.id);
    res.status(204).end();
  });

  router.post(
    '/modules/:id/lessons',
    uuid('id'),
    body('title').isString().trim().isLength({ min: 2, max: 200 }),
    body('content_type').isIn(Object.values(ContentType)),
    body('media_url').optional({ values: 'falsy' }).isURL({ protocols: ['https'], require_protocol: true }).withMessage('media_url must be an https link'),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const id = await content.createLesson(tenantOf(req), actorOf(req), req.params.id, {
        title: String(req.body.title).trim(),
        contentType: req.body.content_type as ContentType,
        mediaUrl: typeof req.body.media_url === 'string' && req.body.media_url ? req.body.media_url : null,
      });
      res.status(201).json(ok({ id }));
    },
  );

  router.put(
    '/lessons/:id',
    uuid('id'),
    body('title').optional().isString().trim().isLength({ min: 2, max: 200 }),
    body('media_url').optional({ values: 'null' }).isURL({ protocols: ['https'], require_protocol: true }),
    body('sort_order').optional().isInt({ min: 0, max: 10_000 }),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const data: { title?: string; mediaUrl?: string | null; sortOrder?: number } = {};
      if (req.body.title !== undefined) data.title = String(req.body.title).trim();
      if (req.body.media_url !== undefined) data.mediaUrl = req.body.media_url || null;
      if (req.body.sort_order !== undefined) data.sortOrder = Number(req.body.sort_order);
      await content.updateLesson(tenantOf(req), actorOf(req), req.params.id, data);
      res.json(ok({ id: req.params.id }));
    },
  );

  router.delete('/lessons/:id', uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    await content.deleteLesson(tenantOf(req), actorOf(req), req.params.id);
    res.status(204).end();
  });

  // Raw video body, streamed straight to storage (never buffered in memory), then queued for HLS.
  router.put('/lessons/:id/video', uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const type = req.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!VIDEO_TYPES.has(type)) throw HttpError.unprocessable('UNSUPPORTED_VIDEO', 'Upload an MP4, MOV, WebM or MKV video');
    const length = req.get('content-length');
    await video.acceptUpload(tenantOf(req), req.params.id, req, length ? Number(length) : null);
    res.status(202).json(ok({ status: 'PROCESSING' }));
  });

  router.get('/certificates', async (req: Request, res: Response) => {
    const rows = await learning.listCertificates(tenantOf(req));
    res.json(ok(rows.map((r) => ({ code: r.code, issued_at: r.issuedAt.toISOString(), learner_name: r.learnerName, course_title: r.courseTitle }))));
  });

  return router;
}
