/**
 * HTTP contract test for POST /api/v1/enrollments/checkout (SWET §9).
 * Exercises the real middleware chain (helmet, tenant context, RS256 auth, RBAC, validation,
 * error envelope) with in-memory infrastructure, so it runs without Postgres or Redis.
 * RLS itself is covered by rls-isolation.test.ts against a real database.
 */
import { generateKeyPairSync } from 'node:crypto';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../src/app';
import type { TenantPrismaClient } from '../../src/config/database';
import { PaymentDeclinedError } from '../../src/modules/billing/payment-gateway';
import { CheckoutService } from '../../src/modules/lms/enrollments/checkout.service';
import { EnrollmentController } from '../../src/modules/lms/enrollments/enrollment.controller';
import type { EnrollmentCheckoutRepository } from '../../src/modules/lms/enrollments/enrollment.repository';
import type { TenantResolver } from '../../src/shared/middlewares/tenant-context.middleware';
import type { ResolvedTenant } from '../../src/shared/types/express';
import { ZatcaTlvEncoder } from '../../src/shared/utils/zatca-tlv.encoder';

const TENANT_A = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';
const TENANT_B = '0b9f4e6a-2c1d-4e8f-8a7b-6c5d4e3f2a10';
const SUSPENDED = '5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716';
const USER = 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a01';
const COURSE = 'c0a80121-872f-41ed-a1eb-0242ac120002';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const jwtOpts = { publicKey: publicPem, issuer: 't3leem.my', audience: 't3leem.my/api' };

const sign = (claims: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
  jwt.sign(claims, privateKey, { algorithm: 'RS256', issuer: jwtOpts.issuer, audience: jwtOpts.audience, expiresIn: '5m', ...opts });

const learnerToken = sign({ sub: USER, tid: TENANT_A, role: 'LEARNER' });

const tenants: Record<string, ResolvedTenant> = {
  [TENANT_A]: { id: TENANT_A, slug: 'alfaisal', name: 'Al-Faisal', status: 'ACTIVE', legalName: 'Al-Faisal Academy', vatNumber: '300000000000003' },
  [TENANT_B]: { id: TENANT_B, slug: 'gulf', name: 'Gulf Institute', status: 'ACTIVE', legalName: null, vatNumber: '311111111111113' },
  [SUSPENDED]: { id: SUSPENDED, slug: 'old', name: 'Old', status: 'SUSPENDED', legalName: null, vatNumber: null },
};

const resolver: TenantResolver = {
  findById: async (id) => tenants[id] ?? null,
  findByHost: async (host) => Object.values(tenants).find((t) => host === `${t.slug}.t3leem.my`) ?? null,
};

function buildApp() {
  const enrolled = new Set<string>();
  const repository: EnrollmentCheckoutRepository = {
    // Mimics RLS: the course exists only inside TENANT_A.
    findCourseForCheckout: async (tenantId, courseId) =>
      tenantId === TENANT_A && courseId === COURSE ? { id: COURSE, title: 'PMP', isPublished: true, priceHalalas: 100000 } : null,
    hasEnrollment: async (t, u, c) => enrolled.has(`${t}:${u}:${c}`),
    createPaidEnrollment: async (input) => {
      enrolled.add(`${input.tenantId}:${input.userId}:${input.courseId}`);
      return { enrollmentId: 'e581f122-872f-41ed-a1eb-0242ac120002', enrollmentStatus: 'ACTIVE', invoiceId: 'inv-1', invoiceNumber: 'INV-2026-00892' };
    },
  };
  const service = new CheckoutService({
    repository,
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
  const passThrough: RequestHandler = (_req, _res, next) => next();

  return createApp({
    tenantResolver: resolver,
    scopeDb: () => ({}) as TenantPrismaClient,
    rateLimiter: passThrough,
    jwt: jwtOpts,
    corsOrigins: [],
    enrollmentController: new EnrollmentController(service),
  });
}

const validBody = { course_id: COURSE, payment_method: 'MADA', payment_token: 'tok_mada_3829103820192' };

describe('POST /api/v1/enrollments/checkout', () => {
  it('returns the SWET §9 contract and echoes x-tenant-id', async () => {
    const res = await request(buildApp())
      .post('/api/v1/enrollments/checkout')
      .set('x-tenant-id', TENANT_A)
      .set('Authorization', `Bearer ${learnerToken}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.headers['x-tenant-id']).toBe(TENANT_A);
    expect(res.body).toEqual({
      success: true,
      data: {
        enrollment_id: 'e581f122-872f-41ed-a1eb-0242ac120002',
        status: 'ACTIVE',
        invoice: {
          invoice_number: 'INV-2026-00892',
          total_amount: 1150,
          vat_amount: 150,
          zatca_qr_base64: expect.any(String),
        },
      },
    });
    const tlv = ZatcaTlvEncoder.decode(res.body.data.invoice.zatca_qr_base64);
    expect(tlv.get(1)?.toString()).toBe('Al-Faisal Academy');
    expect(tlv.get(4)?.toString()).toBe('1150.00');
  });

  it('resolves the tenant from the subdomain when no header is sent', async () => {
    const res = await request(buildApp())
      .post('/api/v1/enrollments/checkout')
      .set('Host', 'alfaisal.t3leem.my')
      .set('Authorization', `Bearer ${learnerToken}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.headers['x-tenant-id']).toBe(TENANT_A);
  });

  it('sets security headers via helmet', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  describe('tenant context', () => {
    it('400 when no tenant can be resolved', async () => {
      const res = await request(buildApp()).post('/api/v1/enrollments/checkout').send(validBody);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: { code: 'TENANT_CONTEXT_MISSING' } });
    });

    it('400 for a non-UUID x-tenant-id (blocks injection payloads early)', async () => {
      const res = await request(buildApp())
        .post('/api/v1/enrollments/checkout')
        .set('x-tenant-id', "x'; RESET app.current_tenant_id; --")
        .send(validBody);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TENANT_ID');
    });

    it('403 for a suspended tenant', async () => {
      const res = await request(buildApp()).post('/api/v1/enrollments/checkout').set('x-tenant-id', SUSPENDED).send(validBody);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TENANT_INACTIVE');
    });
  });

  describe('auth & RBAC', () => {
    const post = (token: string, tenant = TENANT_A) =>
      request(buildApp()).post('/api/v1/enrollments/checkout').set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(validBody);

    it('401 without a token', async () => {
      const res = await request(buildApp()).post('/api/v1/enrollments/checkout').set('x-tenant-id', TENANT_A).send(validBody);
      expect(res.status).toBe(401);
    });

    it('401 for an expired token', async () => {
      const res = await post(sign({ sub: USER, tid: TENANT_A, role: 'LEARNER' }, { expiresIn: -10 }));
      expect(res.status).toBe(401);
    });

    it('401 for an HS256 token forged with the public key (alg confusion)', async () => {
      const forged = jwt.sign({ sub: USER, tid: TENANT_A, role: 'LEARNER' }, publicPem, {
        algorithm: 'HS256',
        issuer: jwtOpts.issuer,
        audience: jwtOpts.audience,
      });
      const res = await post(forged);
      expect(res.status).toBe(401);
    });

    it('403 when a tenant-A token is replayed against tenant B via x-tenant-id', async () => {
      const res = await post(learnerToken, TENANT_B);
      expect(res.status).toBe(403);
    });

    it('403 for a non-learner role', async () => {
      const res = await post(sign({ sub: USER, tid: TENANT_A, role: 'INSTRUCTOR' }));
      expect(res.status).toBe(403);
    });
  });

  describe('validation & domain errors', () => {
    const post = (body: object, tenant = TENANT_A, token = learnerToken) =>
      request(buildApp()).post('/api/v1/enrollments/checkout').set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body);

    it('422 with per-field details for an invalid body', async () => {
      const res = await post({ course_id: 'nope', payment_method: 'CASH' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(
        expect.arrayContaining(['course_id', 'payment_method', 'payment_token']),
      );
    });

    it('400 for malformed JSON', async () => {
      const res = await request(buildApp())
        .post('/api/v1/enrollments/checkout')
        .set('x-tenant-id', TENANT_A)
        .set('Authorization', `Bearer ${learnerToken}`)
        .set('Content-Type', 'application/json')
        .send('{"course_id":');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });

    it('404 for a course belonging to another tenant', async () => {
      const tokenB = sign({ sub: USER, tid: TENANT_B, role: 'LEARNER' });
      const res = await post(validBody, TENANT_B, tokenB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
    });

    it('402 when the payment is declined', async () => {
      const res = await post({ ...validBody, payment_token: 'tok_decline_1' });
      expect(res.status).toBe(402);
    });

    it('409 on a second checkout for the same course', async () => {
      const app = buildApp();
      const send = () =>
        request(app).post('/api/v1/enrollments/checkout').set('x-tenant-id', TENANT_A).set('Authorization', `Bearer ${learnerToken}`).send(validBody);
      expect((await send()).status).toBe(200);
      const second = await send();
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ALREADY_ENROLLED');
    });
  });
});
