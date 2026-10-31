import { Router, type RequestHandler } from 'express';
import { body } from 'express-validator';
import { validate } from '../../shared/middlewares/validate.middleware';
import type { AuthController } from './auth.controller';

export const otpCodeRules = [
  body('challenge_id').isUUID().withMessage('challenge_id must be a UUID'),
  body('code').isString().trim().matches(/^\d{6}$/).withMessage('code must be 6 digits'),
];

/** No normalizeEmail(): it rewrites provider-specific addresses (dots, +tags) and would stop matching the stored email. */
export const otpEmailRule = body('email').isString().trim().isEmail().withMessage('A valid email is required');

/**
 * Mounted under /api/v1/auth. Sign-in is passwordless: an e-mailed 6-digit code (for owners, trainers
 * and trainees alike). Both limiters are much stricter than the API default.
 */
export function buildAuthRouter(controller: AuthController, loginLimiter: RequestHandler, registerLimiter: RequestHandler): Router {
  const router = Router();

  router.post('/otp/request', loginLimiter, otpEmailRule, validate, controller.requestOtp);
  router.post('/otp/resend', loginLimiter, body('challenge_id').isUUID().withMessage('challenge_id must be a UUID'), validate, controller.resendOtp);
  router.post('/otp/verify', loginLimiter, ...otpCodeRules, validate, controller.verifyOtp);

  router.get('/register-policy', controller.registerPolicy);

  router.post(
    '/register',
    registerLimiter,
    body('full_name').isString().trim().isLength({ min: 3, max: 120 }).withMessage('full_name must be 3-120 characters'),
    otpEmailRule,
    body('phone').optional({ values: 'falsy' }).isString().trim().matches(/^\+[1-9][0-9]{8,14}$/).withMessage('phone must be an international number such as +9665XXXXXXXX'),
    validate,
    controller.register,
  );

  return router;
}
