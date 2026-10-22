import { Router, type Request, type Response } from 'express';
import { ok } from '../../shared/utils/api-response';

/**
 * GET /api/v1/tenant — public branding for the resolved academy (name, colors, logo),
 * so the frontend can render a white-label site. No DB call: the tenant middleware already
 * resolved it (with cache). Never exposes status internals or billing identifiers.
 */
export function buildTenantRouter(): Router {
  const router = Router();
  router.get('/', (req: Request, res: Response) => {
    if (!req.tenant) throw new Error('tenant route mounted without tenant middleware');
    const { id, slug, name, brandSettings } = req.tenant;
    res.json(ok({ id, slug, name, brand_settings: brandSettings }));
  });
  return router;
}
