import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { TenantPrismaClient } from './config/database';
import type { JwtVerifyOptions } from './shared/middlewares/auth.middleware';
import { errorHandler, notFoundHandler } from './shared/middlewares/error-handler.middleware';
import { createTenantContextMiddleware, type TenantResolver } from './shared/middlewares/tenant-context.middleware';
import type { AuthController } from './modules/auth/auth.controller';
import { buildAuthRouter } from './modules/auth/auth.routes';
import type { ZoomWebhookService } from './modules/live/zoom-webhook.service';
import type { ContentService } from './modules/lms/content/content.service';
import { buildQuizAdminRouter, buildQuizLearnerRouter } from './modules/lms/quiz/quiz.routes';
import type { QuizService } from './modules/lms/quiz/quiz.service';
import { buildRecordedAdminRouter, buildRecordedLearnerRouter } from './modules/lms/recorded/recorded.routes';
import type { RecordedCourseService } from './modules/lms/recorded/recorded.service';
import { buildContentAdminRouter } from './modules/lms/content/content.routes';
import type { CourseController } from './modules/lms/courses/course.controller';
import { buildCourseRouter } from './modules/lms/courses/course.routes';
import type { EnrollmentController } from './modules/lms/enrollments/enrollment.controller';
import { buildEnrollmentRouter } from './modules/lms/enrollments/enrollment.routes';
import { buildCertificateVerifyRouter, buildLearnerRouter } from './modules/lms/learning/learning.routes';
import type { LearningService } from './modules/lms/learning/learning.service';
import { buildMediaRouter } from './modules/lms/media/media.routes';
import type { VideoService } from './modules/lms/media/video.service';
import { buildPlatformRouter, type ProviderDirectorySource } from './modules/platform/platform.routes';
import type { ProviderController } from './modules/provider/provider.controller';
import { buildProviderAdminRouter, buildProviderPublicRouter } from './modules/provider/provider.routes';
import type { BrandingService } from './modules/tenant/branding.service';
import type { DomainService } from './modules/tenant/domain.service';
import type { RegistrationService } from './modules/tenant/registration.service';
import { buildTenantRouter } from './modules/tenant/tenant.controller';

export interface AppDependencies {
  tenantResolver: TenantResolver;
  scopeDb: (tenantId: string) => TenantPrismaClient;
  rateLimiter: RequestHandler;
  loginRateLimiter: RequestHandler;
  signupRateLimiter: RequestHandler;
  jwt: JwtVerifyOptions;
  corsOrigins: string[];
  authController: AuthController;
  courseController: CourseController;
  enrollmentController: EnrollmentController;
  providerController: ProviderController;
  providerDirectory: ProviderDirectorySource;
  brandingService: BrandingService;
  registrationService: RegistrationService;
  domainService: DomainService;
  contentService: ContentService;
  recordedCourseService: RecordedCourseService;
  quizService: QuizService;
  learningService: LearningService;
  videoService: VideoService;
  zoomWebhooks: ZoomWebhookService;
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

  // Zoom webhooks need the EXACT raw bytes to verify the HMAC signature, so this route is
  // registered before the JSON parser would consume and re-serialize the body.
  app.post('/api/v1/webhooks/zoom', deps.rateLimiter, express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const reply = await deps.zoomWebhooks.handle(raw, req.get('x-zm-request-timestamp'), req.get('x-zm-signature'));
    res.json(reply);
  });

  app.use(express.json({ limit: '100kb' }));

  // Liveness probe — public, tenant-agnostic.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Platform-wide endpoints (no tenant). Mounted BEFORE the tenant-scoped router.
  app.use(
    '/api/v1/platform',
    deps.rateLimiter,
    buildPlatformRouter(deps.providerDirectory, deps.registrationService, deps.signupRateLimiter, deps.domainService),
  );
  app.use('/api/v1/certificates', deps.rateLimiter, buildCertificateVerifyRouter(deps.learningService));

  const api = express.Router();
  // Order matters: tenant first (rate-limit keys and auth both depend on req.tenantId).
  api.use(createTenantContextMiddleware(deps.tenantResolver, deps.scopeDb));
  // Video delivery sits before the rate limiter: a player fetches a segment every few seconds,
  // which would trip the per-minute API limit. It's protected by signed, expiring tokens instead.
  api.use('/media', buildMediaRouter(deps.videoService));
  api.use(deps.rateLimiter);
  api.use('/tenant', buildTenantRouter(deps.brandingService, deps.domainService, deps.jwt));
  api.use('/auth', buildAuthRouter(deps.authController, deps.loginRateLimiter, deps.signupRateLimiter));
  api.use('/courses', buildCourseRouter(deps.courseController));
  api.use('/enrollments', buildEnrollmentRouter(deps.enrollmentController, deps.jwt));
  api.use('/me', buildLearnerRouter(deps.learningService, deps.videoService, deps.jwt));
  api.use('/me', buildRecordedLearnerRouter(deps.recordedCourseService, deps.jwt));
  api.use('/me', buildQuizLearnerRouter(deps.quizService, deps.jwt));
  api.use('/admin', buildProviderAdminRouter(deps.providerController, deps.jwt));
  api.use('/admin', buildContentAdminRouter(deps.contentService, deps.videoService, deps.learningService, deps.jwt));
  api.use('/admin', buildRecordedAdminRouter(deps.recordedCourseService, deps.jwt));
  api.use('/admin', buildQuizAdminRouter(deps.quizService, deps.jwt));
  api.use('/', buildProviderPublicRouter(deps.providerController));

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
