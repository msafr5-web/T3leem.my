import { Router, type Request, type Response } from 'express';
import { body, param } from 'express-validator';
import { UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireRoles, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { validate } from '../../shared/middlewares/validate.middleware';
import { ok } from '../../shared/utils/api-response';
import { RULES } from './attendance.engine';
import { buildAttendanceWorkbook } from './attendance.excel';
import type { AttendanceService, CourseReport } from './attendance.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const kindRule = body('kind').isIn(['LIVE', 'DAY']).withMessage('kind must be LIVE or DAY');
const refRule = body('ref').isUUID().withMessage('ref must be a UUID');

/** The trainee checks in to sessions: /api/v1/me/attendance (any signed-in user of the academy, own data only). */
export function buildAttendanceLearnerRouter(service: AttendanceService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use(authenticate(jwt));

  router.get('/attendance/sessions', async (req: Request, res: Response) => {
    const { tenantId, user } = requireAuthContext(req);
    const list = await service.mySessions(tenantId, user.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      ok(
        list.map((m) => ({
          kind: m.session.kind,
          ref: m.session.ref,
          title: m.session.title,
          course_title: m.session.courseTitle,
          starts_at: m.session.startsAt.toISOString(),
          ends_at: m.session.endsAt.toISOString(),
          state: m.state,
          check_in_opens_at: m.checkInOpensAt.toISOString(),
          checked_in_at: m.checkedInAt?.toISOString() ?? null,
          result: m.result,
        })),
      ),
    );
  });

  // Step 1: the code is e-mailed to the trainee (it never appears in the response).
  router.post('/attendance/request', kindRule, refRule, validate, async (req: Request, res: Response) => {
    const { tenantId, tenant, user } = requireAuthContext(req);
    const r = await service.requestCheckIn(tenantId, tenant.name, user.id, req.body.kind, String(req.body.ref));
    res.setHeader('Cache-Control', 'no-store');
    res.status(202).json(ok({ challenge_id: r.challengeId, expires_in: r.expiresInSec }));
  });

  router.post(
    '/attendance/confirm',
    kindRule,
    refRule,
    body('challenge_id').isUUID().withMessage('challenge_id must be a UUID'),
    body('code').isString().trim().matches(/^\d{6}$/).withMessage('code must be 6 digits'),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, user } = requireAuthContext(req);
      const r = await service.confirmCheckIn(tenantId, user.id, req.body.kind, String(req.body.ref), String(req.body.challenge_id), String(req.body.code));
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok({ checked_in_at: r.checkedInAt.toISOString(), late: r.late, join_url: r.joinUrl }));
    },
  );

  return router;
}

const reportJson = (r: CourseReport) => ({
  course: r.course,
  rules: { pass_percent: RULES.passPercent, late_percent_of_session: RULES.lateFraction * 100, leave_grace_minutes: RULES.leaveGraceMinutes },
  passing_trainees: r.passingTrainees,
  sessions: r.sessions.map((s) => ({ kind: s.kind, ref: s.ref, title: s.title, starts_at: s.startsAt.toISOString(), ends_at: s.endsAt.toISOString(), held: s.held })),
  trainees: r.trainees.map((t) => ({
    user_id: t.userId,
    name: t.name,
    admin_enrolled: t.adminEnrolled,
    statuses: t.statuses,
    summary: { held: t.summary.held, attended: t.summary.attended, late: t.summary.late, absent: t.summary.absent, percent: t.summary.percent, passes: t.summary.passes },
  })),
});

/** The academy's admin follows attendance: /api/v1/admin/attendance (TENANT_ADMIN only). */
export function buildAttendanceAdminRouter(service: AttendanceService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  const admin = [authenticate(jwt), requireRoles(UserRole.TENANT_ADMIN)];
  const uuid = param('id').isUUID().withMessage('id must be a UUID');

  router.get('/attendance/courses', ...admin, async (req: Request, res: Response) => {
    const rows = await service.overview(requireAuthContext(req).tenantId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok(rows.map((r) => ({ course_id: r.courseId, title: r.title, sessions: r.sessions, held: r.held, trainees: r.trainees, passing_trainees: r.passingTrainees }))));
  });

  router.get('/attendance/courses/:id', ...admin, uuid, validate, async (req: Request<{ id: string }>, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok(reportJson(await service.courseReport(requireAuthContext(req).tenantId, req.params.id))));
  });

  router.get('/attendance/courses/:id/export', ...admin, uuid, validate, async (req: Request<{ id: string }>, res: Response) => {
    const report = await service.courseReport(requireAuthContext(req).tenantId, req.params.id);
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(await buildAttendanceWorkbook(report));
  });

  return router;
}
