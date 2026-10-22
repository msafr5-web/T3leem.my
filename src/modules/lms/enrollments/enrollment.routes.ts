import { Router } from 'express';
import { body, header } from 'express-validator';
import { PaymentMethod, UserRole } from '@prisma/client';
import { authenticate, requireRoles, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import type { EnrollmentController } from './enrollment.controller';

const checkoutValidators = [
  body('course_id').isUUID().withMessage('course_id must be a UUID'),
  body('payment_method')
    .isIn(Object.values(PaymentMethod))
    .withMessage(`payment_method must be one of ${Object.values(PaymentMethod).join(', ')}`),
  body('payment_token').isString().trim().isLength({ min: 1, max: 512 }).withMessage('payment_token is required'),
  header('idempotency-key').optional().isString().isLength({ min: 8, max: 128 }),
];

/** Mounted under /api/v1/enrollments, behind tenantContextMiddleware + rate limiter. */
export function buildEnrollmentRouter(controller: EnrollmentController, jwt: JwtVerifyOptions): Router {
  const router = Router();

  router.post(
    '/checkout',
    authenticate(jwt),
    requireRoles(UserRole.LEARNER),
    ...checkoutValidators,
    validate,
    controller.checkout,
  );

  return router;
}
