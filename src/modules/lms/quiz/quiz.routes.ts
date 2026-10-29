import express, { Router, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireRoles, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import { HttpError } from '../../../shared/utils/http-error';
import { QUIZ_LIMITS } from './quiz.excel';
import type { QuizQuestionRow } from './quiz.repository';
import { QUIZ_SETTING_LIMITS, type QuestionDraft, type QuizResult, type QuizService, type QuizStatus } from './quiz.service';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const questionJson = (q: QuizQuestionRow) => ({
  id: q.id,
  code: q.code,
  body: q.body,
  type: q.type,
  options: q.options,
  correct_answer: q.correctAnswer,
  difficulty: q.difficulty,
  day_id: q.moduleId,
});

const resultJson = (r: QuizResult) => ({
  score: r.score,
  max_score: r.maxScore,
  percent: r.percent,
  submitted_at: r.submittedAt.toISOString(),
  questions: r.questions.map((q) => ({
    id: q.id,
    body: q.body,
    type: q.type,
    options: q.options,
    your_answer: q.yourAnswer,
    correct_answer: q.correctAnswer,
    is_correct: q.isCorrect,
  })),
});

const statusJson = (s: QuizStatus) => ({
  available: s.available,
  window: s.window,
  opens_at: s.opensAt?.toISOString() ?? null,
  closes_at: s.closesAt?.toISOString() ?? null,
  duration_minutes: s.durationMinutes,
  question_count: s.questionCount,
  server_now: s.serverNow.toISOString(),
  attempt:
    s.attempt === null
      ? null
      : s.attempt.state === 'submitted'
        ? { state: 'submitted', result: resultJson(s.attempt.result) }
        : {
            state: 'in_progress',
            expires_at: s.attempt.expiresAt.toISOString(),
            questions: s.attempt.questions.map((q) => ({ id: q.id, body: q.body, type: q.type, options: q.options })),
          },
});

const questionRules = [
  body('day_id').optional({ values: 'null' }).isUUID().withMessage('day_id must be a UUID'),
  body('body').isString().trim().isLength({ min: 1, max: QUIZ_LIMITS.maxBodyLength }).withMessage('body is required'),
  body('type').isIn(['MCQ', 'TEXT']),
  body('options').optional().isArray({ max: QUIZ_LIMITS.options.max }).withMessage('options must be a list'),
  body('options.*').isString().isLength({ max: QUIZ_LIMITS.maxOptionLength }),
  body('correct_answer').optional({ values: 'null' }).isString().isLength({ max: QUIZ_LIMITS.maxBodyLength }),
  body('difficulty').optional().isIn(['EASY', 'MEDIUM', 'HARD']),
];

const draftOf = (b: Record<string, unknown>): QuestionDraft => ({
  dayId: typeof b.day_id === 'string' && b.day_id ? b.day_id : null,
  body: String(b.body),
  type: b.type === 'TEXT' ? 'TEXT' : 'MCQ',
  options: Array.isArray(b.options) ? b.options.map(String) : [],
  correctAnswer: typeof b.correct_answer === 'string' ? b.correct_answer : '',
  difficulty: b.difficulty === 'EASY' || b.difficulty === 'HARD' ? b.difficulty : 'MEDIUM',
});

/** Provider dashboard: question bank, Excel in/out, settings and results (TENANT_ADMIN). */
export function buildQuizAdminRouter(service: QuizService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const admin = [authenticate(jwt), requireRoles(UserRole.TENANT_ADMIN)];
  const actorOf = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, actor: { userId: user.id, role: user.role, ip: req.ip ?? null } };
  };

  router.get('/recorded-courses/:id/quiz', ...admin, uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const b = await service.bank(requireAuthContext(req).tenantId, req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      ok({
        settings: { duration_minutes: b.settings.durationMinutes, question_count: b.settings.questionCount },
        days: b.days.map((d) => ({ id: d.id, title: d.title, question_count: d.questionCount, opens_at: d.opensAt?.toISOString() ?? null, closes_at: d.closesAt?.toISOString() ?? null })),
        shared_count: b.sharedCount,
        questions: b.questions.map(questionJson),
      }),
    );
  });

  router.put(
    '/recorded-courses/:id/quiz-settings',
    ...admin,
    uuid('id'),
    body('duration_minutes').isInt(QUIZ_SETTING_LIMITS.durationMinutes).withMessage('duration_minutes must be 1-180'),
    body('question_count').isInt(QUIZ_SETTING_LIMITS.questionCount).withMessage('question_count must be 1-50'),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const { tenantId, actor } = actorOf(req);
      await service.updateSettings(tenantId, actor, req.params.id, { durationMinutes: Number(req.body.duration_minutes), questionCount: Number(req.body.question_count) });
      res.json(ok({ id: req.params.id }));
    },
  );

  // Body: { windows: [{ day_id, opens_at: ISO | null, closes_at: ISO | null }] }
  router.put(
    '/recorded-courses/:id/quiz-windows',
    ...admin,
    uuid('id'),
    body('windows').isArray({ min: 1, max: 100 }).withMessage('windows must be a list'),
    body('windows.*.day_id').isUUID().withMessage('day_id must be a UUID'),
    body('windows.*.opens_at').optional({ values: 'null' }).isISO8601().withMessage('opens_at must be a date-time'),
    body('windows.*.closes_at').optional({ values: 'null' }).isISO8601().withMessage('closes_at must be a date-time'),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const { tenantId, actor } = actorOf(req);
      const date = (v: unknown) => (typeof v === 'string' && v ? new Date(v) : null);
      const windows = (req.body.windows as Record<string, unknown>[]).map((w) => ({ moduleId: String(w.day_id), opensAt: date(w.opens_at), closesAt: date(w.closes_at) }));
      await service.updateWindows(tenantId, actor, req.params.id, windows);
      res.json(ok({ id: req.params.id }));
    },
  );

  router.get('/recorded-courses/:id/quiz/export', ...admin, uuid('id'), query('template').optional().isIn(['0', '1']), validate, async (req: Request<{ id: string }>, res: Response) => {
    const file = await service.exportSheet(requireAuthContext(req).tenantId, req.params.id, req.query.template === '1');
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="questions.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(file);
  });

  // The workbook arrives as the raw request body (application/octet-stream), not JSON/multipart.
  router.post(
    '/recorded-courses/:id/quiz/import',
    ...admin,
    uuid('id'),
    query('mode').optional().isIn(['append', 'replace']),
    validate,
    express.raw({ type: () => true, limit: QUIZ_LIMITS.maxFileBytes }),
    async (req: Request<{ id: string }>, res: Response) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw HttpError.unprocessable('FILE_REQUIRED', 'Upload an Excel or CSV file');
      const { tenantId, actor } = actorOf(req);
      const outcome = await service.importSheet(tenantId, actor, req.params.id, req.body, req.query.mode === 'replace' ? 'replace' : 'append');
      res.status(201).json(ok(outcome));
    },
  );

  // Build a question in the form (no Excel): same validation as the import.
  router.post('/recorded-courses/:id/quiz/questions', ...admin, uuid('id'), ...questionRules, validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    const id = await service.createQuestion(tenantId, actor, req.params.id, draftOf(req.body as Record<string, unknown>));
    res.status(201).json(ok({ id }));
  });

  router.put('/recorded-courses/:id/quiz/questions/:qid', ...admin, uuid('id'), uuid('qid'), ...questionRules, validate, async (req: Request<{ id: string; qid: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    await service.updateQuestion(tenantId, actor, req.params.id, req.params.qid, draftOf(req.body as Record<string, unknown>));
    res.json(ok({ id: req.params.qid }));
  });

  router.delete('/recorded-courses/:id/quiz/questions/:qid', ...admin, uuid('id'), uuid('qid'), validate, async (req: Request<{ id: string; qid: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    await service.deleteQuestion(tenantId, actor, req.params.id, req.params.qid);
    res.status(204).end();
  });

  router.get('/recorded-courses/:id/quiz/results', ...admin, uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const rows = await service.results(requireAuthContext(req).tenantId, req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      ok(
        rows.map((r) => ({
          id: r.id,
          learner_name: r.learnerName,
          learner_email: r.learnerEmail,
          day_title: r.dayTitle,
          started_at: r.startedAt.toISOString(),
          submitted_at: r.submittedAt?.toISOString() ?? null,
          score: r.score,
          max_score: r.maxScore,
          text_answers: r.textAnswers,
        })),
      ),
    );
  });
  return router;
}

/** Learner side: /api/v1/me/modules/:id/quiz — the day's quiz for enrolled learners. */
export function buildQuizLearnerRouter(service: QuizService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const who = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, user: { id: user.id, role: user.role } };
  };

  router.get('/modules/:id/quiz', authenticate(jwt), uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, user } = who(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok(statusJson(await service.status(tenantId, user, req.params.id))));
  });

  router.post('/modules/:id/quiz/start', authenticate(jwt), uuid('id'), validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, user } = who(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok(statusJson(await service.start(tenantId, user, req.params.id))));
  });

  router.post(
    '/modules/:id/quiz/submit',
    authenticate(jwt),
    uuid('id'),
    body('answers').isObject().withMessage('answers must be an object'),
    validate,
    async (req: Request<{ id: string }>, res: Response) => {
      const { tenantId, user } = who(req);
      res.json(ok(resultJson(await service.submit(tenantId, user, req.params.id, req.body.answers as Record<string, unknown>))));
    },
  );
  return router;
}
