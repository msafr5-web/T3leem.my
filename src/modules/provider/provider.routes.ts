import { Router } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { ClassroomStatus, CourseType, MeetingProvider, PlanStatus, PlanType, UserRole } from '@prisma/client';
import { authenticate, requireRoles, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { validate } from '../../shared/middlewares/validate.middleware';
import type { ProviderController } from './provider.controller';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const optionalText = (field: string, max: number) => body(field).optional({ values: 'null' }).isString().isLength({ max });
const optionalDate = (field: string) => body(field).optional({ values: 'falsy' }).matches(DATE_ONLY).withMessage(`${field} must be YYYY-MM-DD`);

/** Shared by create (all required fields enforced) and update (every field optional). */
function courseValidators(mode: 'create' | 'update'): ValidationChain[] {
  const req = (chain: ValidationChain) => (mode === 'create' ? chain : chain.optional());
  return [
    req(body('title')).isString().trim().isLength({ min: 3, max: 200 }).withMessage('title must be 3-200 characters'),
    req(body('type')).isIn(Object.values(CourseType)),
    req(body('price')).isFloat({ min: 0, max: 1_000_000 }).withMessage('price must be 0 - 1,000,000 SAR'),
    req(body('trainer_id')).isUUID().withMessage('trainer_id must be a UUID'),
    optionalText('description', 5000),
    optionalText('license_number', 100),
    optionalText('license_authority', 200),
    optionalDate('license_expires_on'),
    optionalText('accreditation_number', 100),
    body('training_hours').optional({ values: 'falsy' }).isFloat({ min: 0.5, max: 2000 }).withMessage('training_hours must be 0.5 - 2000'),
    body('duration_days').optional({ values: 'falsy' }).isInt({ min: 1, max: 730 }).withMessage('duration_days must be 1 - 730'),
    body('is_published').optional().isBoolean(),
  ];
}

/** Public, tenant-scoped reads used by the academy website. Mounted under /api/v1. */
export function buildProviderPublicRouter(controller: ProviderController): Router {
  const router = Router();
  router.get('/plans', controller.publicPlans);
  router.get('/trainers', controller.publicTrainers);
  router.get('/classrooms/upcoming', controller.upcomingClassrooms);
  return router;
}

const uuidParam = param('id').isUUID().withMessage('id must be a UUID');

/** Provider dashboard. Mounted under /api/v1/admin — TENANT_ADMIN only. */
export function buildProviderAdminRouter(controller: ProviderController, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use(authenticate(jwt), requireRoles(UserRole.TENANT_ADMIN));

  router.get('/overview', controller.overview);
  router.get('/integrations', controller.integrations);

  router.get('/courses', controller.listCourses);
  router.get('/courses/:id', param('id').isUUID(), validate, controller.getCourse);
  router.post('/courses', ...courseValidators('create'), validate, controller.createCourse);
  router.put('/courses/:id', param('id').isUUID(), ...courseValidators('update'), validate, controller.updateCourse);
  router.delete('/courses/:id', uuidParam, validate, controller.deleteCourse);

  router.get('/trainers', controller.listTrainers);
  router.post(
    '/trainers',
    body('full_name').isString().trim().isLength({ min: 3, max: 120 }).withMessage('full_name must be 3-120 characters'),
    optionalText('specialization', 200),
    optionalText('bio', 2000),
    body('email').optional({ values: 'falsy' }).isEmail(),
    validate,
    controller.createTrainer,
  );
  router.put(
    '/trainers/:id',
    uuidParam,
    body('full_name').optional().isString().trim().isLength({ min: 3, max: 120 }),
    optionalText('specialization', 200),
    optionalText('bio', 2000),
    body('email').optional({ values: 'falsy' }).isEmail(),
    validate,
    controller.updateTrainer,
  );
  router.delete('/trainers/:id', uuidParam, validate, controller.deleteTrainer);

  router.get('/trainees', controller.listTrainees);
  router.post(
    '/trainees',
    body('email').isString().trim().isEmail().withMessage('A valid email is required'),
    body('full_name').isString().trim().isLength({ min: 3, max: 120 }),
    body('password').isString().isLength({ min: 8, max: 128 }).withMessage('password must be at least 8 characters'),
    validate,
    controller.createTrainee,
  );
  router.put('/trainees/:id', uuidParam, body('full_name').isString().trim().isLength({ min: 3, max: 120 }), validate, controller.updateTrainee);
  router.delete('/trainees/:id', uuidParam, validate, controller.deleteTrainee);

  router.get('/plans', controller.listPlans);
  router.post(
    '/plans',
    body('title').isString().trim().isLength({ min: 3, max: 200 }),
    body('type').isIn(Object.values(PlanType)),
    body('status').optional().isIn(Object.values(PlanStatus)),
    optionalText('description', 5000),
    optionalDate('starts_on'),
    optionalDate('ends_on'),
    body('course_ids').isArray({ max: 50 }).withMessage('course_ids must be an array'),
    body('course_ids.*').isUUID(),
    validate,
    controller.createPlan,
  );
  router.put(
    '/plans/:id',
    uuidParam,
    body('title').optional().isString().trim().isLength({ min: 3, max: 200 }),
    body('type').optional().isIn(Object.values(PlanType)),
    body('status').optional().isIn(Object.values(PlanStatus)),
    optionalText('description', 5000),
    optionalDate('starts_on'),
    optionalDate('ends_on'),
    body('course_ids').optional().isArray({ max: 50 }),
    body('course_ids.*').isUUID(),
    validate,
    controller.updatePlan,
  );
  router.delete('/plans/:id', uuidParam, validate, controller.deletePlan);

  router.get('/classrooms', controller.listClassrooms);
  router.post(
    '/classrooms',
    body('title').isString().trim().isLength({ min: 3, max: 200 }),
    body('starts_at').isISO8601({ strict: true }).withMessage('starts_at must be an ISO 8601 date-time'),
    body('duration_minutes').isInt({ min: 15, max: 720 }),
    body('capacity').optional({ values: 'falsy' }).isInt({ min: 1, max: 10_000 }),
    body('course_id').optional({ values: 'falsy' }).isUUID(),
    body('trainer_id').optional({ values: 'falsy' }).isUUID(),
    body('provider').optional().isIn(Object.values(MeetingProvider)),
    // https only: the link is shown to trainees and must not be a javascript: or http: URL.
    body('join_url').optional({ values: 'falsy' }).isURL({ protocols: ['https'], require_protocol: true }),
    validate,
    controller.createClassroom,
  );
  router.get('/classrooms/:id', uuidParam, validate, controller.getClassroom);
  router.put(
    '/classrooms/:id',
    uuidParam,
    body('title').optional().isString().trim().isLength({ min: 3, max: 200 }),
    body('starts_at').optional().isISO8601({ strict: true }),
    body('duration_minutes').optional().isInt({ min: 15, max: 720 }),
    body('capacity').optional({ values: 'falsy' }).isInt({ min: 1, max: 10_000 }),
    body('course_id').optional({ values: 'falsy' }).isUUID(),
    body('trainer_id').optional({ values: 'falsy' }).isUUID(),
    body('provider').optional().isIn(Object.values(MeetingProvider)),
    body('join_url').optional({ values: 'falsy' }).isURL({ protocols: ['https'], require_protocol: true }),
    body('status').optional().isIn(Object.values(ClassroomStatus)),
    validate,
    controller.updateClassroom,
  );
  router.delete('/classrooms/:id', uuidParam, validate, controller.deleteClassroom);
  router.get('/classrooms/:id/attendance', uuidParam, validate, controller.attendance);

  return router;
}
