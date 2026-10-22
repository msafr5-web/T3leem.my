import express, { type Express, type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { TenantPrismaClient } from './config/database';
import type { JwtVerifyOptions } from './shared/middlewares/auth.middleware';
import { errorHandler, notFoundHandler } from './shared/middlewares/error-handler.middleware';
import { createTenantContextMiddleware, type TenantResolver } from './shared/middlewares/tenant-context.middleware';
import type { AuthController } from './modules/auth/auth.controller';
import { buildAuthRouter } from './modules/auth/auth.routes';
import type { CourseController } from './modules/lms/courses/course.controller';
import { buildCourseRouter } from './modules/lms/courses/course.routes';
import type { EnrollmentController } from './modules/lms/enrollments/enrollment.controller';
import { buildEnrollmentRouter } from './modules/lms/enrollments/enrollment.routes';
import { buildTenantRouter } from './modules/tenant/tenant.controller';

export interface AppDependencies {
  tenantResolver: TenantResolver;
  scopeDb: (tenantId: string) => TenantPrismaClient;
  rateLimiter: RequestHandler;
  loginRateLimiter: RequestHandler;
  jwt: JwtVerifyOptions;
  corsOrigins: string[];
  authController: AuthController;
  courseController: CourseController;
  enrollmentController: EnrollmentController;
}

/**
 * Builds the Express app from injected dependencies (no I/O at import time), so integration
 * tests can mount it with Supertest against a test database or fakes.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();

  // Behind Nginx / the K8s ingress / Vercel's edge: trust exactly one hop so req.ip and req.hostname are real.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: deps.corsOrigins,
      credentials: true,
      exposedHeaders: ['x-tenant-id', 'Retry-After', 'RateLimit-Remaining'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  // Liveness probe — public, tenant-agnostic.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const api = express.Router();
  // Order matters: tenant first (rate-limit keys and auth both depend on req.tenantId).
  api.use(createTenantContextMiddleware(deps.tenantResolver, deps.scopeDb));
  api.use(deps.rateLimiter);
  api.use('/tenant', buildTenantRouter());
  api.use('/auth', buildAuthRouter(deps.authController, deps.loginRateLimiter));
  api.use('/courses', buildCourseRouter(deps.courseController));
  api.use('/enrollments', buildEnrollmentRouter(deps.enrollmentController, deps.jwt));

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
