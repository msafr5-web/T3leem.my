import { Router } from 'express';
import { param } from 'express-validator';
import { validate } from '../../../shared/middlewares/validate.middleware';
import type { CourseController } from './course.controller';

/** Mounted under /api/v1/courses. Public (PRD §6): the catalog is visible before login. */
export function buildCourseRouter(controller: CourseController): Router {
  const router = Router();
  router.get('/', controller.list);
  router.get('/:id', param('id').isUUID().withMessage('id must be a UUID'), validate, controller.get);
  return router;
}
