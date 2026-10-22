import { Router, type RequestHandler } from 'express';
import { body } from 'express-validator';
import { validate } from '../../shared/middlewares/validate.middleware';
import type { AuthController } from './auth.controller';

/** Mounted under /api/v1/auth. `loginLimiter` is a much stricter limiter than the API default (brute force). */
export function buildAuthRouter(controller: AuthController, loginLimiter: RequestHandler): Router {
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

  return router;
}
