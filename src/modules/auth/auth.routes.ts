import { Router, type RequestHandler } from 'express';
import { body } from 'express-validator';
import { validate } from '../../shared/middlewares/validate.middleware';
import type { AuthController } from './auth.controller';

/**
 * Mounted under /api/v1/auth. Both limiters are much stricter than the API default:
 * login against password guessing, register against scripted account creation.
 */
export function buildAuthRouter(controller: AuthController, loginLimiter: RequestHandler, registerLimiter: RequestHandler): Router {
  const router = Router();

  router.post(
    '/login',
    loginLimiter,
    // No normalizeEmail(): it rewrites provider-specific addresses (dots, +tags) and would stop
    // matching the stored email. The service lowercases and trims, which is all we need.
    body('email').isString().trim().isEmail().withMessage('A valid email is required'),
    body('password').isString().isLength({ min: 1, max: 256 }).withMessage('password is required'),
    validate,
    controller.login,
  );

  router.post(
    '/register',
    registerLimiter,
    body('full_name').isString().trim().isLength({ min: 3, max: 120 }).withMessage('full_name must be 3-120 characters'),
    body('email').isString().trim().isEmail().withMessage('A valid email is required'),
    body('password').isString().isLength({ min: 8, max: 128 }).withMessage('password must be at least 8 characters'),
    validate,
    controller.register,
  );

  return router;
}
