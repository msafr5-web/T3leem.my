/**
 * Shared fixture for HTTP contract tests: the real Express app and middleware chain
 * (helmet, tenant context, RS256 auth, RBAC, validation, error envelope) wired to real
 * services over in-memory repositories, so it runs without Postgres or Redis.
 */
import { generateKeyPairSync } from 'node:crypto';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { createApp } from '../../../src/app';
import type { TenantPrismaClient } from '../../../src/config/database';
import { AuthController } from '../../../src/modules/auth/auth.controller';
import type { AuthRepository, LoginCandidate } from '../../../src/modules/auth/auth.repository';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { JwtTokenSigner } from '../../../src/modules/auth/token-signer';
import { PaymentDeclinedError } from '../../../src/modules/billing/payment-gateway';
import { CourseController } from '../../../src/modules/lms/courses/course.controller';
import type { CourseCatalogRepository, CourseDetailRow } from '../../../src/modules/lms/courses/course.repository';
import { CourseCatalogService } from '../../../src/modules/lms/courses/course.service';
import { CheckoutService } from '../../../src/modules/lms/enrollments/checkout.service';
import { EnrollmentController } from '../../../src/modules/lms/enrollments/enrollment.controller';
import type { EnrollmentCheckoutRepository } from '../../../src/modules/lms/enrollments/enrollment.repository';
import type { TenantResolver } from '../../../src/shared/middlewares/tenant-context.middleware';
import type { ResolvedTenant } from '../../../src/shared/types/express';
import { hashPassword, verifyPassword } from '../../../src/shared/utils/password';

export const TENANT_A = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';
export const TENANT_B = '0b9f4e6a-2c1d-4e8f-8a7b-6c5d4e3f2a10';
export const SUSPENDED = '5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716';
export const USER = 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a01';
export const COURSE = 'c0a80121-872f-41ed-a1eb-0242ac120002';
export const LEARNER_EMAIL = 'learner@alfaisal.test';
export const LEARNER_PASSWORD = 'Demo@2026';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
export const jwtOpts = { publicKey: publicPem, issuer: 't3leem.my', audience: 't3leem.my/api' };

export const sign = (claims: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
  jwt.sign(claims, privateKey, { algorithm: 'RS256', issuer: jwtOpts.issuer, audience: jwtOpts.audience, expiresIn: '5m', ...opts });

export const learnerToken = sign({ sub: USER, tid: TENANT_A, role: 'LEARNER' });

const brand = { primaryColor: '#0d6b62' };
const tenants: Record<string, ResolvedTenant> = {
  [TENANT_A]: { id: TENANT_A, slug: 'alfaisal', name: 'Al-Faisal', status: 'ACTIVE', legalName: 'Al-Faisal Academy', vatNumber: '300000000000003', brandSettings: brand },
  [TENANT_B]: { id: TENANT_B, slug: 'gulf', name: 'Gulf Institute', status: 'ACTIVE', legalName: null, vatNumber: '311111111111113', brandSettings: {} },
  [SUSPENDED]: { id: SUSPENDED, slug: 'old', name: 'Old', status: 'SUSPENDED', legalName: null, vatNumber: null, brandSettings: {} },
};

const resolver: TenantResolver = {
  findById: async (id) => tenants[id] ?? null,
  findBySlug: async (slug) => Object.values(tenants).find((t) => t.slug === slug) ?? null,
  findByHost: async (host) => Object.values(tenants).find((t) => host === `${t.slug}.t3leem.my`) ?? null,
};

const pmp: CourseDetailRow = {
  id: COURSE,
  title: 'PMP',
  type: 'RECORDED',
  priceHalalas: 100000,
  moduleCount: 1,
  lessonCount: 2,
  modules: [
    {
      id: 'd1000000-0000-4000-8000-000000000001',
      title: 'Basics',
      lessons: [
        { id: 'e1000000-0000-4000-8000-000000000001', title: 'Intro', contentType: 'VIDEO' },
        { id: 'e1000000-0000-4000-8000-000000000002', title: 'Guide', contentType: 'PDF' },
      ],
    },
  ],
};

// Hashing is slow by design; do it once for the whole file.
const learnerHash = hashPassword(LEARNER_PASSWORD);
const dummyHash = hashPassword('dummy-password-for-timing');

export function buildApp(opts: { signingKey?: string | null } = {}) {
  const enrolled = new Set<string>();

  // Each fake mimics RLS: data exists only inside TENANT_A.
  const enrollmentRepo: EnrollmentCheckoutRepository = {
    findCourseForCheckout: async (tenantId, courseId) =>
      tenantId === TENANT_A && courseId === COURSE ? { id: COURSE, title: 'PMP', isPublished: true, priceHalalas: 100000 } : null,
    hasEnrollment: async (t, u, c) => enrolled.has(`${t}:${u}:${c}`),
    createPaidEnrollment: async (input) => {
      enrolled.add(`${input.tenantId}:${input.userId}:${input.courseId}`);
      return { enrollmentId: 'e581f122-872f-41ed-a1eb-0242ac120002', enrollmentStatus: 'ACTIVE', invoiceId: 'inv-1', invoiceNumber: 'INV-2026-00892' };
    },
  };
  const catalogRepo: CourseCatalogRepository = {
    listPublished: async (tenantId) => (tenantId === TENANT_A ? [pmp] : []),
    findPublished: async (tenantId, id) => (tenantId === TENANT_A && id === COURSE ? pmp : null),
  };
  const authRepo: AuthRepository = {
    findByEmail: async (tenantId, email): Promise<LoginCandidate | null> =>
      tenantId === TENANT_A && email === LEARNER_EMAIL ? { id: USER, email, role: 'LEARNER', passwordHash: await learnerHash } : null,
  };

  const checkout = new CheckoutService({
    repository: enrollmentRepo,
    paymentGateway: {
      charge: async (r) => {
        if (r.token.startsWith('tok_decline')) throw new PaymentDeclinedError('declined');
        return { reference: 'pay_1' };
      },
      refund: async () => undefined,
    },
    zatcaQueue: { enqueueZatcaSync: async () => undefined },
    vatRatePercent: 15,
    clock: () => new Date('2026-10-22T19:40:00Z'),
  });
  const auth = new AuthService({
    repository: authRepo,
    signer: new JwtTokenSigner(opts.signingKey === null ? undefined : (opts.signingKey ?? privatePem), {
      issuer: jwtOpts.issuer,
      audience: jwtOpts.audience,
      ttlSeconds: 900,
    }),
    verifyPassword,
    dummyHash,
  });
  const passThrough: RequestHandler = (_req, _res, next) => next();

  return createApp({
    tenantResolver: resolver,
    scopeDb: () => ({}) as TenantPrismaClient,
    rateLimiter: passThrough,
    loginRateLimiter: passThrough,
    jwt: jwtOpts,
    corsOrigins: [],
    authController: new AuthController(auth),
    courseController: new CourseController(new CourseCatalogService(catalogRepo, 15)),
    enrollmentController: new EnrollmentController(checkout),
  });
}
