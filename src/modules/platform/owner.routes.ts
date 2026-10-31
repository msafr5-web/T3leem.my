import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param } from 'express-validator';
import jwt from 'jsonwebtoken';
import { validate } from '../../shared/middlewares/validate.middleware';
import type { JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { ok } from '../../shared/utils/api-response';
import { HttpError } from '../../shared/utils/http-error';
import { tokenJson } from '../auth/auth.controller';
import { otpCodeRules, otpEmailRule } from '../auth/auth.routes';
import { PLATFORM_OWNER_ID, PLATFORM_TENANT_ID, type OtpLoginService } from '../auth/otp.service';
import { FEATURES, type Features, type OwnerService, type OwnerTenantRow, type PlanRow } from './owner.service';

const OWNER_LABEL = 'لوحة إدارة T3leem.my';

/** Only a token minted by the owner sign-in (sentinel tenant, SUPER_ADMIN) opens these routes. */
const ownerOnly =
  ({ publicKey, issuer, audience }: JwtVerifyOptions): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw HttpError.unauthorized();
    let payload: unknown;
    try {
      payload = jwt.verify(header.slice('Bearer '.length), publicKey, { algorithms: ['RS256'], issuer, audience });
    } catch {
      throw HttpError.unauthorized('Invalid or expired access token');
    }
    const p = payload as Record<string, unknown>;
    if (typeof payload !== 'object' || payload === null || p.role !== 'SUPER_ADMIN' || p.tid !== PLATFORM_TENANT_ID || p.sub !== PLATFORM_OWNER_ID) {
      throw HttpError.forbidden('Platform owner only');
    }
    next();
  };

const tenantJson = (t: OwnerTenantRow) => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  status: t.status,
  plan_id: t.planId,
  plan_name: t.planName,
  approved_at: t.approvedAt?.toISOString() ?? null,
  subscription_ends_at: t.subscriptionEndsAt?.toISOString() ?? null,
  features: t.features,
  owner_name: t.ownerName,
  owner_email: t.ownerEmail,
  owner_phone: t.ownerPhone,
  created_at: t.createdAt.toISOString(),
});

const planJson = (p: PlanRow) => ({ id: p.id, name: p.name, max_students: p.maxStudents, max_storage_gb: p.maxStorageGb, monthly_price: p.monthlyPrice, tenant_count: p.tenantCount });

const featuresOf = (raw: unknown): Features => {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(FEATURES.map((f) => [f, o[f] === true || o[f] === 'true'])) as Features;
};

const featureRules = FEATURES.map((f) => body(`features.${f}`).optional().isBoolean());
const planRules = [
  body('name').isString().trim().isLength({ min: 2, max: 60 }).withMessage('name must be 2-60 characters'),
  body('max_students').isInt({ min: 1, max: 1_000_000 }),
  body('max_storage_gb').isInt({ min: 1, max: 100_000 }),
  body('monthly_price').isFloat({ min: 0, max: 1_000_000 }),
];
const planInput = (b: Record<string, unknown>) => ({ name: String(b.name).trim(), maxStudents: Number(b.max_students), maxStorageGb: Number(b.max_storage_gb), monthlyPrice: Number(b.monthly_price) });
const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);

/** Mounted under /api/v1/platform/owner: the platform owner's sign-in and console. */
export function buildOwnerRouter(otp: OtpLoginService, service: OwnerService, jwtOpts: JwtVerifyOptions, loginLimiter: RequestHandler): Router {
  const router = Router();
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

  // ---- sign-in (no token yet): only the listed owner e-mail addresses receive a code ----
  router.post('/otp/request', loginLimiter, otpEmailRule, validate, async (req: Request, res: Response) => {
    const r = await otp.requestForPlatform(String(req.body.email));
    noStore(res);
    res.status(202).json(ok({ challenge_id: r.challengeId, expires_in: r.expiresInSec }));
  });
  router.post('/otp/resend', loginLimiter, body('challenge_id').isUUID(), validate, async (req: Request, res: Response) => {
    const r = await otp.resend(null, String(req.body.challenge_id), OWNER_LABEL);
    noStore(res);
    res.status(202).json(ok({ expires_in: r.expiresInSec }));
  });
  router.post('/otp/verify', loginLimiter, ...otpCodeRules, validate, async (req: Request, res: Response) => {
    const result = await otp.verify(null, String(req.body.challenge_id), String(req.body.code));
    noStore(res);
    res.json(ok(tokenJson(result)));
  });

  // ---- console ----
  const guard = ownerOnly(jwtOpts);

  router.get('/overview', guard, async (_req: Request, res: Response) => {
    const o = await service.overview();
    noStore(res);
    res.json(ok({ total: o.total, pending: o.pending, active: o.active, suspended: o.suspended, expired: o.expired, tenants: o.tenants.map(tenantJson) }));
  });

  router.post(
    '/tenants/:id/approve',
    guard,
    uuid('id'),
    body('plan_id').optional({ values: 'null' }).isUUID(),
    body('months').isInt({ min: 0, max: 120 }).withMessage('months must be 0-120 (0 = no end date)'),
    ...featureRules,
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const t = await service.approve(req.params.id, { planId: typeof req.body.plan_id === 'string' ? req.body.plan_id : null, months: Number(req.body.months), features: featuresOf(req.body.features) });
      res.json(ok(tenantJson(t)));
    },
  );

  router.put(
    '/tenants/:id',
    guard,
    uuid('id'),
    body('status').optional().isIn(['ACTIVE', 'SUSPENDED', 'PROVISIONING']),
    body('plan_id').optional({ values: 'null' }).isUUID(),
    body('subscription_ends_at').optional({ values: 'null' }).isISO8601().withMessage('subscription_ends_at must be a date-time'),
    ...featureRules,
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const b = req.body as Record<string, unknown>;
      const t = await service.update(req.params.id, {
        ...(b.status !== undefined ? { status: b.status as 'ACTIVE' | 'SUSPENDED' | 'PROVISIONING' } : {}),
        ...('plan_id' in b ? { planId: typeof b.plan_id === 'string' ? b.plan_id : null } : {}),
        ...('subscription_ends_at' in b ? { subscriptionEndsAt: typeof b.subscription_ends_at === 'string' ? new Date(b.subscription_ends_at) : null } : {}),
        ...(b.features !== undefined ? { features: featuresOf(b.features) } : {}),
      });
      res.json(ok(tenantJson(t)));
    },
  );

  router.post('/tenants/:id/extend', guard, uuid('id'), body('months').isInt({ min: 1, max: 120 }), validate, async (req: Request<{ id: string }>, res: Response) => {
    res.json(ok(tenantJson(await service.extend(req.params.id, Number(req.body.months)))));
  });

  router.get('/plans', guard, async (_req: Request, res: Response) => {
    noStore(res);
    res.json(ok((await service.listPlans()).map(planJson)));
  });
  router.post('/plans', guard, ...planRules, validate, async (req: Request, res: Response) => {
    res.status(201).json(ok({ id: await service.createPlan(planInput(req.body as Record<string, unknown>)) }));
  });
  router.put('/plans/:id', guard, uuid('id'), ...planRules, validate, async (req: Request<{ id: string }>, res: Response) => {
    await service.updatePlan(req.params.id, planInput(req.body as Record<string, unknown>));
    res.json(ok({ id: req.params.id }));
  });
  router.delete('/plans/:id', guard, uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    await service.deletePlan(req.params.id);
    res.status(204).end();
  });

  return router;
}
