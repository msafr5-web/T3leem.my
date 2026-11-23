import { Router, type Request, type Response } from 'express';
import { authenticate, requireAuthContext, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { ok } from '../../shared/utils/api-response';
import { buildVCard, type BadgeService } from './badge.service';

/** The trainee manages their own badge: /api/v1/me/badge (any signed-in user of the academy). */
export function buildBadgeOwnerRouter(service: BadgeService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use(authenticate(jwt));
  const who = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, userId: user.id };
  };
  const json = (res: Response, b: { enabled: boolean; token: string } | null) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok(b ? { enabled: b.enabled, token: b.token } : { enabled: false, token: null }));
  };

  router.get('/badge', async (req: Request, res: Response) => {
    const { tenantId, userId } = who(req);
    json(res, await service.get(tenantId, userId));
  });
  router.post('/badge', async (req: Request, res: Response) => {
    const { tenantId, userId } = who(req);
    json(res, await service.enable(tenantId, userId));
  });
  // A new link: the old one stops working at once (for a link that was shared by mistake).
  router.post('/badge/regenerate', async (req: Request, res: Response) => {
    const { tenantId, userId } = who(req);
    json(res, await service.regenerate(tenantId, userId));
  });
  router.delete('/badge', async (req: Request, res: Response) => {
    const { tenantId, userId } = who(req);
    await service.disable(tenantId, userId);
    res.status(204).end();
  });
  return router;
}

/** Public, no sign-in: /api/v1/badges/:token. Shows only what the trainee chose to publish. */
export function buildBadgePublicRouter(service: BadgeService): Router {
  const router = Router();

  router.get('/:token', async (req: Request<{ token: string }>, res: Response) => {
    const b = await service.publicView(req.params.token);
    // Short cache: turning the badge off should take effect quickly.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(
      ok({
        name: b.name,
        academy: b.academy,
        certificates: b.certificates.map((c) => ({ code: c.code, course_title: c.courseTitle, issued_at: c.issuedAt.toISOString() })),
      }),
    );
  });

  router.get('/:token/vcard', async (req: Request<{ token: string }>, res: Response) => {
    const b = await service.publicView(req.params.token);
    const base = (process.env.PUBLIC_WEB_URL ?? 'https://t3leem.my').replace(/\/$/, '');
    const origin = /^https?:\/\//.test(base) ? base : `https://${base}`;
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="badge.vcf"');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(buildVCard({ name: b.name, academyName: b.academy.name, url: `${origin}/badge/${encodeURIComponent(req.params.token)}` }));
  });

  return router;
}
