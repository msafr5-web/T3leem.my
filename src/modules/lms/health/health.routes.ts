import express, { Router, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireRoles, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import { HttpError } from '../../../shared/utils/http-error';
import { HEALTH_LIMITS } from './health.excel';
import type { HealthQuestionRow, HealthSectorRow } from './health.repository';
import { HEALTH_PRACTICE, type HealthService, type QuestionDraft } from './health.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);

const sectorJson = (s: HealthSectorRow) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  title: s.title,
  sort_order: s.sortOrder,
  active: s.active,
  question_count: s.questionCount,
  total_count: s.totalCount,
});

const questionJson = (q: HealthQuestionRow) => ({
  id: q.id,
  code: q.code,
  sector_id: q.sectorId,
  body: q.body,
  options: q.options,
  correct_index: q.correctIndex,
  explanation: q.explanation,
  active: q.active,
});

const listQuery = [
  query('sector_id').optional().isUUID(),
  query('q').optional().isString().isLength({ max: 100 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0, max: 100_000 }),
];

const listArgs = (req: Request) => ({
  sectorId: typeof req.query.sector_id === 'string' ? req.query.sector_id : undefined,
  search: typeof req.query.q === 'string' ? req.query.q : undefined,
  limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
  offset: req.query.offset === undefined ? undefined : Number(req.query.offset),
});

const draftRules = [
  body('sector_id').isUUID().withMessage('sector_id must be a UUID'),
  body('body').isString().trim().isLength({ min: 1, max: HEALTH_LIMITS.maxBodyLength }).withMessage('body is required'),
  body('options').isArray({ min: HEALTH_LIMITS.options.min, max: HEALTH_LIMITS.options.max }).withMessage('options must be a list of 2-6'),
  body('options.*').isString().isLength({ min: 1, max: HEALTH_LIMITS.maxOptionLength }),
  body('correct_index').isInt({ min: 0, max: HEALTH_LIMITS.options.max - 1 }).withMessage('correct_index must be an option index'),
  body('explanation').optional({ values: 'null' }).isString().isLength({ max: HEALTH_LIMITS.maxExplanationLength }),
  body('active').optional().isBoolean(),
];

const draftOf = (b: Record<string, unknown>): QuestionDraft & { code?: string } => ({
  sectorId: String(b.sector_id),
  body: String(b.body),
  options: (b.options as unknown[]).map(String),
  correctIndex: Number(b.correct_index),
  explanation: typeof b.explanation === 'string' ? b.explanation : '',
  active: b.active === undefined ? true : b.active === true || b.active === 'true',
  code: typeof b.code === 'string' && b.code.trim() ? b.code : undefined,
});

/** Provider dashboard: sectors, question bank, Excel in/out, fee and access (TENANT_ADMIN). */
export function buildHealthAdminRouter(service: HealthService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const admin = [authenticate(jwt), requireRoles(UserRole.TENANT_ADMIN)];
  const actorOf = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, actor: { userId: user.id, role: user.role, ip: req.ip ?? null } };
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

  router.get('/health', ...admin, async (req: Request, res: Response) => {
    const o = await service.overview(requireAuthContext(req).tenantId);
    noStore(res);
    res.json(
      ok({
        settings: { enabled: o.settings.enabled, trial_ends_at: o.settings.trialEndsAt?.toISOString() ?? null, price: o.settings.price },
        sectors: o.sectors.map(sectorJson),
        active_subscribers: o.entitled,
        server_now: o.serverNow.toISOString(),
      }),
    );
  });

  router.put(
    '/health/settings',
    ...admin,
    body('enabled').isBoolean(),
    body('trial_ends_at').optional({ values: 'null' }).isISO8601().withMessage('trial_ends_at must be a date-time'),
    body('price').optional({ values: 'null' }).isFloat({ min: 0, max: 100_000 }).withMessage('price must be 0-100000'),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, actor } = actorOf(req);
      const price = req.body.price === null || req.body.price === undefined || req.body.price === '' ? null : Number(req.body.price);
      await service.updateSettings(tenantId, actor, {
        enabled: req.body.enabled === true || req.body.enabled === 'true',
        trialEndsAt: typeof req.body.trial_ends_at === 'string' && req.body.trial_ends_at ? new Date(req.body.trial_ends_at) : null,
        price: price !== null && price > 0 ? price : null,
      });
      res.json(ok({ saved: true }));
    },
  );

  router.post(
    '/health/access',
    ...admin,
    body('email').isEmail().withMessage('email is invalid'),
    body('days').isInt({ min: 1, max: 3650 }).withMessage('days must be 1-3650'),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, actor } = actorOf(req);
      const expiresAt = await service.grantAccess(tenantId, actor, String(req.body.email), Number(req.body.days));
      res.status(201).json(ok({ expires_at: expiresAt.toISOString() }));
    },
  );

  const sectorRules = [
    body('name').isString().trim().isLength({ min: 1, max: 80 }).withMessage('name is required'),
    body('title').optional({ values: 'null' }).isString().isLength({ max: 200 }),
  ];

  router.post('/health/sectors', ...admin, ...sectorRules, body('slug').optional({ values: 'null' }).isString().trim().isLength({ max: 40 }), validate, async (req: Request, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    const id = await service.createSector(tenantId, actor, { name: String(req.body.name), title: String(req.body.title ?? ''), slug: typeof req.body.slug === 'string' ? req.body.slug : undefined });
    res.status(201).json(ok({ id }));
  });

  router.put(
    '/health/sectors/:id',
    ...admin,
    uuid('id'),
    ...sectorRules,
    body('sort_order').optional().isInt({ min: 0, max: 1000 }),
    body('active').optional().isBoolean(),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const { tenantId, actor } = actorOf(req);
      await service.updateSector(tenantId, actor, req.params.id, {
        name: String(req.body.name),
        title: String(req.body.title ?? ''),
        sortOrder: req.body.sort_order === undefined ? 0 : Number(req.body.sort_order),
        active: req.body.active === undefined ? true : req.body.active === true || req.body.active === 'true',
      });
      res.json(ok({ id: req.params.id }));
    },
  );

  router.delete('/health/sectors/:id', ...admin, uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    await service.deleteSector(tenantId, actor, req.params.id);
    res.status(204).end();
  });

  router.get('/health/questions', ...admin, ...listQuery, validate, async (req: Request, res: Response) => {
    const r = await service.adminQuestions(requireAuthContext(req).tenantId, listArgs(req));
    noStore(res);
    res.json(ok({ total: r.total, questions: r.rows.map(questionJson) }));
  });

  router.post('/health/questions', ...admin, ...draftRules, validate, async (req: Request, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    const id = await service.createQuestion(tenantId, actor, draftOf(req.body as Record<string, unknown>));
    res.status(201).json(ok({ id }));
  });

  router.put('/health/questions/:id', ...admin, uuid('id'), ...draftRules, validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    await service.updateQuestion(tenantId, actor, req.params.id, draftOf(req.body as Record<string, unknown>));
    res.json(ok({ id: req.params.id }));
  });

  router.delete('/health/questions/:id', ...admin, uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    await service.deleteQuestion(tenantId, actor, req.params.id);
    res.status(204).end();
  });

  // One click: the bundled starter bank (6 sectors, 660 questions). Re-running only refreshes those codes.
  router.post('/health/starter', ...admin, async (req: Request, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    const r = await service.installStarter(tenantId, actor);
    res.status(201).json(ok({ sectors_created: r.sectorsCreated, created: r.created, updated: r.updated }));
  });

  router.get('/health/export', ...admin, query('template').optional().isIn(['0', '1']), validate, async (req: Request, res: Response) => {
    const file = await service.exportSheet(requireAuthContext(req).tenantId, req.query.template === '1');
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="health-questions.xlsx"');
    noStore(res);
    res.send(file);
  });

  // The workbook arrives as the raw request body (application/octet-stream), not JSON/multipart.
  router.post(
    '/health/import',
    ...admin,
    query('mode').optional().isIn(['append', 'replace']),
    validate,
    express.raw({ type: () => true, limit: HEALTH_LIMITS.maxFileBytes }),
    async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw HttpError.unprocessable('FILE_REQUIRED', 'Upload an Excel or CSV file');
      const { tenantId, actor } = actorOf(req);
      res.status(201).json(ok(await service.importSheet(tenantId, actor, req.body, req.query.mode === 'replace' ? 'replace' : 'append')));
    },
  );
  return router;
}

/** Learner side: /api/v1/me/health — practice bank for any signed-in user of the tenant. */
export function buildHealthLearnerRouter(service: HealthService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const who = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, user: { id: user.id, role: user.role } };
  };
  const auth = authenticate(jwt);

  router.get('/health', auth, async (req: Request, res: Response) => {
    const { tenantId, user } = who(req);
    const s = await service.status(tenantId, user);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      ok({
        access: s.access,
        trial_ends_at: s.trialEndsAt?.toISOString() ?? null,
        price: s.price,
        server_now: s.serverNow.toISOString(),
        sectors: s.sectors.map((x) => ({ id: x.id, name: x.name, title: x.title, question_count: x.questionCount })),
      }),
    );
  });

  router.get('/health/questions', auth, ...listQuery, validate, async (req: Request, res: Response) => {
    const { tenantId, user } = who(req);
    const r = await service.browse(tenantId, user, listArgs(req));
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok({ total: r.total, questions: r.rows.map(questionJson) }));
  });

  router.get('/health/progress', auth, async (req: Request, res: Response) => {
    const { tenantId, user } = who(req);
    const p = await service.progress(tenantId, user);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      ok({
        favorites: p.states.filter((s) => s.isFavorite).map((s) => s.questionId),
        read: p.states.filter((s) => s.isRead).map((s) => s.questionId),
        answered: p.answered,
        correct: p.correct,
        sessions: p.sessionCount,
        history: p.sessions.map((s) => ({ id: s.clientSessionId, sector_id: s.sectorId, total: s.total, correct: s.correct, created_at: s.createdAt.toISOString() })),
      }),
    );
  });

  router.put(
    '/health/questions/:id/state',
    auth,
    uuid('id'),
    body('favorite').optional().isBoolean(),
    body('read').optional().isBoolean(),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const { tenantId, user } = who(req);
      const flag = (v: unknown) => (v === undefined ? undefined : v === true || v === 'true');
      await service.setState(tenantId, user, req.params.id, { favorite: flag(req.body.favorite), read: flag(req.body.read) });
      res.status(204).end();
    },
  );

  router.post(
    '/health/practice',
    auth,
    body('sector_id').optional({ values: 'null' }).isUUID(),
    body('count').optional().isInt({ min: HEALTH_PRACTICE.minCount, max: HEALTH_PRACTICE.maxCount }),
    body('favorites_only').optional().isBoolean(),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, user } = who(req);
      const questions = await service.practice(tenantId, user, {
        sectorId: typeof req.body.sector_id === 'string' ? req.body.sector_id : undefined,
        count: req.body.count === undefined ? HEALTH_PRACTICE.defaultCount : Number(req.body.count),
        favoritesOnly: req.body.favorites_only === true || req.body.favorites_only === 'true',
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok({ questions: questions.map((q) => ({ id: q.id, sector_id: q.sectorId, body: q.body, options: q.options })) }));
    },
  );

  router.post(
    '/health/answer',
    auth,
    body('question_id').isUUID(),
    body('option').isString().isLength({ min: 1, max: HEALTH_LIMITS.maxOptionLength }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, user } = who(req);
      const r = await service.answer(tenantId, user, String(req.body.question_id), String(req.body.option));
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok({ correct: r.correct, correct_option: r.correctOption, explanation: r.explanation }));
    },
  );

  router.post(
    '/health/sessions',
    auth,
    body('client_session_id').isString().isLength({ min: 8, max: 64 }),
    body('sector_id').optional({ values: 'null' }).isUUID(),
    body('total').isInt({ min: 1, max: 200 }),
    body('correct').isInt({ min: 0, max: 200 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, user } = who(req);
      await service.recordSession(tenantId, user, {
        clientSessionId: String(req.body.client_session_id),
        sectorId: typeof req.body.sector_id === 'string' ? req.body.sector_id : null,
        total: Number(req.body.total),
        correct: Number(req.body.correct),
      });
      res.status(201).json(ok({ saved: true }));
    },
  );
  return router;
}
