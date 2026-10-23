import { Router, type Request, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../../../shared/utils/http-error';
import type { VideoService } from './video.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Signed HLS delivery (SWET §5), mounted under /api/v1/media behind the tenant middleware.
 * No session/JWT here: the video player fetches these URLs itself, so authorization is the
 * short-lived HMAC token bound to tenant + lesson + learner, issued by /me/lessons/:id/playback.
 */
export function buildMediaRouter(video: VideoService): Router {
  const router = Router();

  const params = (req: Request<{ lessonId: string }>) => {
    if (!req.tenantId) throw new Error('media routes mounted without tenant middleware');
    if (!UUID_RE.test(req.params.lessonId)) throw HttpError.notFound('VIDEO_NOT_FOUND', 'Video not found');
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    return { tenantId: req.tenantId, lessonId: req.params.lessonId, token };
  };

  router.get('/lessons/:lessonId/playlist.m3u8', async (req: Request<{ lessonId: string }>, res: Response) => {
    const { tenantId, lessonId, token } = params(req);
    const body = await video.playlist(tenantId, lessonId, token);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  });

  // The AES-128 content key: never cached anywhere, re-authorized on every fetch.
  router.get('/lessons/:lessonId/key', async (req: Request<{ lessonId: string }>, res: Response) => {
    const { tenantId, lessonId, token } = params(req);
    const key = await video.key(tenantId, lessonId, token);
    res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store, private' });
    res.send(key);
  });

  router.get('/lessons/:lessonId/segments/:name', async (req: Request<{ lessonId: string; name: string }>, res: Response) => {
    const { tenantId, lessonId, token } = params(req);
    const stream = video.segment(tenantId, lessonId, token, req.params.name);
    res.setHeader('Content-Type', 'video/mp2t');
    // Segments are encrypted; caching them is harmless and saves bandwidth.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.on('error', () => {
      if (!res.headersSent) res.status(404);
      res.end();
    });
    await pipeline(stream, res).catch(() => undefined);
  });

  return router;
}
