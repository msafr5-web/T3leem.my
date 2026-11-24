import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireFeature, requireRoles, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { validate } from '../../shared/middlewares/validate.middleware';
import { ok } from '../../shared/utils/api-response';
import { HttpError } from '../../shared/utils/http-error';
import { QUIZ_LIMITS } from '../lms/quiz/quiz.excel';
import { XLSX_TYPE, draftOf, questionJson, questionRules } from '../lms/quiz/quiz.routes';
import type { QuizService } from '../lms/quiz/quiz.service';
import type { TrainerPortalService } from './trainer-portal.service';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);

/**
 * The trainer's own question bank: /api/v1/trainer/courses/:id/quiz... for the RECORDED courses they teach.
 *
 * Same engine and the same validation as the academy admin's bank (QuizService); the only differences are who may call it
 * (an INSTRUCTOR, and only for a course whose trainer record is theirs: anything else is a 404, never a 403, so course ids of
 * other trainers cannot be probed) and what is left out: the quiz settings, the opening windows and the learners' results
 * stay with the academy admin, who decides the pacing and sees the people.
 */
export function buildTrainerQuizRouter(trainers: TrainerPortalService, quiz: QuizService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const base = '/courses/:id/quiz';
  router.use('/courses/:id', requireFeature('recorded'));

  const guard = [authenticate(jwt), requireRoles(UserRole.INSTRUCTOR), uuid('id'), validate];
  const own = async (req: Request<{ id: string }>, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId, user } = requireAuthContext(req);
      await trainers.assertOwnsRecordedCourse(tenantId, user.id, req.params.id);
      next();
    } catch (err) {
      next(err);
    }
  };
  const actorOf = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, actor: { userId: user.id, role: user.role, ip: req.ip ?? null } };
  };
  const mine = [...guard, own];

  router.get(base, ...mine, async (req: Request<{ id: string }>, res: Response) => {
    const b = await quiz.bank(requireAuthContext(req).tenantId, req.params.id);
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

  router.get(`${base}/export`, ...mine, query('template').optional().isIn(['0', '1']), validate, async (req: Request<{ id: string }>, res: Response) => {
    const file = await quiz.exportSheet(requireAuthContext(req).tenantId, req.params.id, req.query.template === '1');
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="questions.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(file);
  });

  // The workbook arrives as the raw request body, like the admin's import. Ownership is checked BEFORE the body is read.
  router.post(`${base}/import`, ...mine, query('mode').optional().isIn(['append', 'replace']), validate, express.raw({ type: () => true, limit: QUIZ_LIMITS.maxFileBytes }), async (req: Request<{ id: string }>, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw HttpError.unprocessable('FILE_REQUIRED', 'Upload an Excel or CSV file');
    const { tenantId, actor } = actorOf(req);
    res.status(201).json(ok(await quiz.importSheet(tenantId, actor, req.params.id, req.body, req.query.mode === 'replace' ? 'replace' : 'append')));
  });

  router.post(`${base}/questions`, ...mine, ...questionRules, validate, async (req: Request<{ id: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    res.status(201).json(ok({ id: await quiz.createQuestion(tenantId, actor, req.params.id, draftOf(req.body as Record<string, unknown>)) }));
  });

  router.put(`${base}/questions/:qid`, ...mine, uuid('qid'), ...questionRules, validate, async (req: Request<{ id: string; qid: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    await quiz.updateQuestion(tenantId, actor, req.params.id, req.params.qid, draftOf(req.body as Record<string, unknown>));
    res.json(ok({ id: req.params.qid }));
  });

  router.delete(`${base}/questions/:qid`, ...mine, uuid('qid'), validate, async (req: Request<{ id: string; qid: string }>, res: Response) => {
    const { tenantId, actor } = actorOf(req);
    await quiz.deleteQuestion(tenantId, actor, req.params.id, req.params.qid);
    res.status(204).end();
  });

  return router;
}
