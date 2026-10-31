import { Router, type Request, type RequestHandler, type Response } from 'express';
import { body } from 'express-validator';
import { validate } from '../../shared/middlewares/validate.middleware';
import { ok } from '../../shared/utils/api-response';
import type { DomainService } from '../tenant/domain.service';
import type { RegistrationService } from '../tenant/registration.service';

export interface ProviderDirectorySource {
  listActive(): Promise<{ slug: string; name: string; brandSettings: unknown; logoUpdatedAt?: Date | null; healthSectors?: number }[]>;
}

const pick = (settings: unknown, key: string): string | null => {
  if (typeof settings !== 'object' || settings === null) return null;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * Platform-level endpoints (no tenant context). Mounted under /api/v1/platform, BEFORE the
 * tenant-scoped router. Reads only the tenant registry, which is not under RLS by design.
 */
export function buildPlatformRouter(
  directory: ProviderDirectorySource,
  registration: RegistrationService,
  signupLimiter: RequestHandler,
  domains: Pick<DomainService, 'slugForHost'>,
): Router {
  const router = Router();

  // Directory of service providers for the platform home page.
  router.get('/providers', async (_req: Request, res: Response) => {
    const providers = await directory.listActive();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(
      ok(
        providers.map((p) => ({
          slug: p.slug,
          name: p.name,
          tagline: pick(p.brandSettings, 'tagline'),
          city: pick(p.brandSettings, 'city'),
          primary_color: pick(p.brandSettings, 'primaryColor'),
          logo_version: p.logoUpdatedAt ? String(new Date(p.logoUpdatedAt).getTime()) : null,
          health_sectors: p.healthSectors ?? 0,
        })),
      ),
    );
  });

  // Self-service sign-up for a new service provider (academy + its first admin).
  router.post(
    '/providers',
    signupLimiter,
    body('academy_name').isString().trim().isLength({ min: 3, max: 120 }).withMessage('academy_name must be 3-120 characters'),
    body('slug')
      .isString()
      .trim()
      .toLowerCase()
      .matches(SLUG_RE)
      .withMessage('slug: 3-40 lowercase letters, digits or hyphens, not starting/ending with a hyphen'),
    body('city').optional({ values: 'falsy' }).isString().isLength({ max: 60 }),
    body('admin_name').isString().trim().isLength({ min: 3, max: 120 }),
    body('admin_email').isString().trim().isEmail().withMessage('A valid email is required'),
    body('password').isString().isLength({ min: 8, max: 128 }).withMessage('password must be at least 8 characters'),
    body('accept_terms').equals('true').withMessage('The terms must be accepted'),
    validate,
    async (req: Request, res: Response) => {
      const b = req.body as Record<string, unknown>;
      // Step 1 of 2: nothing is created until the e-mailed code is confirmed (POST /providers/verify).
      const result = await registration.start({
        academyName: String(b.academy_name),
        slug: String(b.slug),
        city: typeof b.city === 'string' && b.city.trim() ? b.city.trim() : null,
        adminName: String(b.admin_name),
        adminEmail: String(b.admin_email),
        password: String(b.password),
      });
      res.status(202).json(ok({ pending_id: result.pendingId, email: result.email, expires_in: result.expiresInSec }));
    },
  );

  router.post(
    '/providers/verify',
    signupLimiter,
    body('pending_id').isUUID().withMessage('pending_id must be a UUID'),
    body('code').isString().trim().matches(/^\d{6}$/).withMessage('code must be 6 digits'),
    validate,
    async (req: Request, res: Response) => {
      const result = await registration.verify(String(req.body.pending_id), String(req.body.code));
      res.status(201).json(ok({ tenant_id: result.tenantId, slug: result.slug }));
    },
  );

  router.post(
    '/providers/resend',
    signupLimiter,
    body('pending_id').isUUID().withMessage('pending_id must be a UUID'),
    validate,
    async (req: Request, res: Response) => {
      const result = await registration.resend(String(req.body.pending_id));
      res.status(202).json(ok({ expires_in: result.expiresInSec }));
    },
  );

  // Web edge lookup for custom domains: host -> academy slug (verified domains only).
  router.get('/domains/:host', async (req: Request<{ host: string }>, res: Response) => {
    const slug = await domains.slugForHost(req.params.host);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(ok({ slug }));
  });

  return router;
}
