import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import type { Express } from 'express';
import ffmpegPath from 'ffmpeg-static';
import { createApp } from './app';
import { forTenant, prisma } from './config/database';
import { env, jwtPrivateKey, jwtPublicKey, zoomCredentials } from './config/env';
import { createBullConnection, redis } from './config/redis';
import { AuthController } from './modules/auth/auth.controller';
import { PrismaAuthRepository } from './modules/auth/auth.repository';
import { AuthService } from './modules/auth/auth.service';
import { JwtTokenSigner } from './modules/auth/token-signer';
import { SandboxPaymentGateway } from './modules/billing/gateways/sandbox.gateway';
import { ManualMeetingScheduler, ZoomMeetingScheduler } from './modules/live/meeting-scheduler';
import { PrismaZoomWebhookRepository } from './modules/live/zoom-webhook.repository';
import { ZoomWebhookService } from './modules/live/zoom-webhook.service';
import { PrismaContentRepository } from './modules/lms/content/content.repository';
import { ContentService } from './modules/lms/content/content.service';
import { PrismaRecordedCourseRepository } from './modules/lms/recorded/recorded.repository';
import { PrismaQuizRepository } from './modules/lms/quiz/quiz.repository';
import { QuizService } from './modules/lms/quiz/quiz.service';
import { PrismaHealthRepository } from './modules/lms/health/health.repository';
import { HealthService } from './modules/lms/health/health.service';
import { RecordedCourseService } from './modules/lms/recorded/recorded.service';
import { YoutubeMetadataClient } from './modules/lms/recorded/youtube';
import { CourseController } from './modules/lms/courses/course.controller';
import { PrismaCourseCatalogRepository } from './modules/lms/courses/course.repository';
import { CourseCatalogService } from './modules/lms/courses/course.service';
import { CheckoutService } from './modules/lms/enrollments/checkout.service';
import { EnrollmentController } from './modules/lms/enrollments/enrollment.controller';
import { PrismaEnrollmentRepository } from './modules/lms/enrollments/enrollment.repository';
import { PrismaLearningRepository } from './modules/lms/learning/learning.repository';
import { LearningService } from './modules/lms/learning/learning.service';
import { PrismaMediaRepository } from './modules/lms/media/media.repository';
import { FfmpegTranscoder } from './modules/lms/media/transcoder';
import { VideoService, type MediaToken, type VideoJob, type VideoQueue } from './modules/lms/media/video.service';
import { ProviderController } from './modules/provider/provider.controller';
import { PrismaProviderRepository } from './modules/provider/provider.repository';
import { ProviderService } from './modules/provider/provider.service';
import { BrandingService } from './modules/tenant/branding.service';
import { DomainService } from './modules/tenant/domain.service';
import { RegistrationService } from './modules/tenant/registration.service';
import { SmtpMailer, UnconfiguredMailer } from './shared/services/mailer';
import { TenantResolverService } from './modules/tenant/tenant-resolver.service';
import { TenantRepository } from './modules/tenant/tenant.repository';
import { createRateLimiter } from './shared/middlewares/rate-limiter.middleware';
import { logger } from './shared/services/logger';
import { BullVideoQueue, DeferredZatcaQueue, InlineVideoQueue, QueueProducer, type ZatcaQueue } from './shared/services/queue.producer';
import { LocalFileStorage } from './shared/services/storage';
import { FieldCipher, HmacTokens } from './shared/utils/crypto';
import { hashPassword, verifyPassword } from './shared/utils/password';

export interface ServerApp {
  app: Express;
  /** Releases pools and connections (graceful shutdown). */
  close(): Promise<void>;
}

/**
 * Video pipeline wiring, shared by the API and the worker process (src/worker.ts).
 * With Redis: jobs go to BullMQ for the worker. Without: they run in-process, one at a time.
 */
export function createVideoService(opts: { inlineFallback?: boolean } = {}): { video: VideoService; queue: VideoQueue; close(): Promise<void> } {
  if (!ffmpegPath) throw new Error('ffmpeg binary not available for this platform (ffmpeg-static)');
  const connection = createBullConnection();
  const bull = connection ? new BullVideoQueue<VideoJob>(connection) : null;
  const inline = !bull && opts.inlineFallback ? new InlineVideoQueue<VideoJob>() : null;
  const queue: VideoQueue = bull ?? inline ?? { enqueue: async () => { throw new Error('No video queue configured'); } };

  const video = new VideoService({
    repository: new PrismaMediaRepository(),
    storage: new LocalFileStorage(env.STORAGE_DIR),
    transcoder: new FfmpegTranscoder(ffmpegPath),
    cipher: new FieldCipher(env.FIELD_ENCRYPTION_KEY_BASE64),
    tokens: new HmacTokens<MediaToken>(env.MEDIA_SIGNING_SECRET),
    queue,
    maxUploadBytes: env.MAX_VIDEO_MB * 1024 * 1024,
  });
  inline?.setProcessor((job) => video.process(job));
  if (inline) logger.info('REDIS_URL not set: video jobs run inside the API process');

  return {
    video,
    queue,
    async close() {
      await Promise.allSettled([bull?.close(), inline?.idle(), connection?.quit()]);
    },
  };
}

/**
 * Composition root: the only place concrete infrastructure is wired together.
 * Shared by the long-running server (server.ts) and the Vercel function (api/index.ts).
 */
export function createServerApp(): ServerApp {
  const bullConnection = createBullConnection();
  const queueProducer = bullConnection ? new QueueProducer(bullConnection) : null;
  const zatcaQueue: ZatcaQueue = queueProducer ?? new DeferredZatcaQueue();
  if (!redis) logger.warn('REDIS_URL not set: in-memory rate limits, no tenant cache, ZATCA sync deferred');

  const authService = new AuthService({
    repository: new PrismaAuthRepository(),
    signer: new JwtTokenSigner(jwtPrivateKey, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      ttlSeconds: env.JWT_ACCESS_TTL_SEC,
    }),
    verifyPassword,
    hashPassword,
    dummyHash: hashPassword(randomBytes(16).toString('hex')),
  });

  const checkoutService = new CheckoutService({
    repository: new PrismaEnrollmentRepository(),
    paymentGateway: new SandboxPaymentGateway(),
    zatcaQueue,
    vatRatePercent: env.VAT_RATE_PERCENT,
  });

  const tenantRepository = new TenantRepository(prisma);
  const tenantResolver = new TenantResolverService(tenantRepository, redis, env.BASE_DOMAIN);
  const invalidateTenant = async (tenantId: string, oldDomain?: string | null) => {
    const tenant = await tenantRepository.findById(tenantId);
    if (tenant) await tenantResolver.invalidate(tenant, oldDomain).catch(() => undefined);
  };

  const catalogService = new CourseCatalogService(new PrismaCourseCatalogRepository(), env.VAT_RATE_PERCENT);
  const meetings = zoomCredentials ? new ZoomMeetingScheduler(zoomCredentials) : new ManualMeetingScheduler();
  if (!zoomCredentials) logger.info('Zoom not configured: virtual classroom links are entered manually');
  const providerService = new ProviderService({ repository: new PrismaProviderRepository(), hashPassword, meetings });

  const media = createVideoService({ inlineFallback: true });
  const learningService = new LearningService({ repository: new PrismaLearningRepository(), publicWebUrl: env.PUBLIC_WEB_URL });

  const app = createApp({
    tenantResolver,
    scopeDb: forTenant,
    rateLimiter: createRateLimiter({ redis, points: env.RATE_LIMIT_POINTS, durationSec: env.RATE_LIMIT_DURATION_SEC }),
    // 10 attempts / 15 min per tenant+IP: slows password guessing to a crawl.
    loginRateLimiter: createRateLimiter({ redis, points: 10, durationSec: 15 * 60, keyPrefix: 'rl:login' }),
    // Academy sign-up AND learner sign-up: 20 accounts per IP per hour (a classroom on one
    // corporate IP can still register; a script can't mass-create accounts).
    signupRateLimiter: createRateLimiter({ redis, points: 20, durationSec: 60 * 60, keyPrefix: 'rl:signup' }),
    jwt: { publicKey: jwtPublicKey, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
    corsOrigins: env.CORS_ORIGINS,
    authController: new AuthController(authService),
    courseController: new CourseController(catalogService),
    enrollmentController: new EnrollmentController(checkoutService),
    providerController: new ProviderController(providerService, catalogService),
    providerDirectory: tenantRepository,
    brandingService: new BrandingService(tenantRepository, (id) => invalidateTenant(id)),
    registrationService: new RegistrationService({
      repository: tenantRepository,
      hashPassword,
      enabled: env.PROVIDER_SIGNUP_ENABLED,
      webUrl: env.PUBLIC_WEB_URL,
      mailer:
        env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD
          ? new SmtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.MAIL_FROM })
          : new UnconfiguredMailer(),
    }),
    domainService: new DomainService(tenantRepository, env.BASE_DOMAIN, (name) => dns.resolveTxt(name), invalidateTenant),
    contentService: new ContentService({
      repository: new PrismaContentRepository(),
      removeLessonMedia: (tenantId, lessonId) => media.video.removeLessonMedia(tenantId, lessonId),
    }),
    recordedCourseService: new RecordedCourseService({
      repository: new PrismaRecordedCourseRepository(),
      youtube: new YoutubeMetadataClient(env.YOUTUBE_API_KEY),
    }),
    quizService: new QuizService({ repository: new PrismaQuizRepository() }),
    healthService: new HealthService({ repository: new PrismaHealthRepository() }),
    learningService,
    videoService: media.video,
    zoomWebhooks: new ZoomWebhookService({
      secretToken: env.ZOOM_WEBHOOK_SECRET_TOKEN,
      repository: new PrismaZoomWebhookRepository(),
      // Zoom wants a 200 within 3 s: queue the download + transcode, never do it in the request.
      enqueueRecording: (job) => media.queue.enqueue(job),
    }),
  });

  return {
    app,
    async close() {
      await Promise.allSettled([queueProducer?.close(), media.close(), prisma.$disconnect(), redis?.quit(), bullConnection?.quit()]);
    },
  };
}
