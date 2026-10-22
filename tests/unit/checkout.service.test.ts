import { CheckoutService, type CheckoutCommand } from '../../src/modules/lms/enrollments/checkout.service';
import type { EnrollmentCheckoutRepository } from '../../src/modules/lms/enrollments/enrollment.repository';
import { PaymentDeclinedError, type PaymentGateway } from '../../src/modules/billing/payment-gateway';
import type { ZatcaQueue } from '../../src/shared/services/queue.producer';
import { HttpError } from '../../src/shared/utils/http-error';

const TENANT = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';
const USER = 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a01';
const COURSE = 'c0a80121-872f-41ed-a1eb-0242ac120002';

function setup() {
  const repository: jest.Mocked<EnrollmentCheckoutRepository> = {
    findCourseForCheckout: jest.fn().mockResolvedValue({ id: COURSE, title: 'PMP', isPublished: true, priceHalalas: 100000 }),
    hasEnrollment: jest.fn().mockResolvedValue(false),
    createPaidEnrollment: jest.fn().mockResolvedValue({
      enrollmentId: 'e581f122-872f-41ed-a1eb-0242ac120002',
      enrollmentStatus: 'ACTIVE',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-2026-00892',
    }),
  };
  const paymentGateway: jest.Mocked<PaymentGateway> = {
    charge: jest.fn().mockResolvedValue({ reference: 'pay_123' }),
    refund: jest.fn().mockResolvedValue(undefined),
  };
  const zatcaQueue: jest.Mocked<ZatcaQueue> = { enqueueZatcaSync: jest.fn().mockResolvedValue(undefined) };
  const issuedAt = new Date('2026-10-22T19:40:00Z');
  const service = new CheckoutService({ repository, paymentGateway, zatcaQueue, vatRatePercent: 15, clock: () => issuedAt });
  return { service, repository, paymentGateway, zatcaQueue, issuedAt };
}

const command = (overrides: Partial<CheckoutCommand> = {}): CheckoutCommand => ({
  tenantId: TENANT,
  seller: { name: 'Al-Faisal', legalName: 'Al-Faisal Academy LLC', vatNumber: '300000000000003' },
  userId: USER,
  courseId: COURSE,
  paymentMethod: 'MADA',
  paymentToken: 'tok_mada_3829103820192',
  idempotencyKey: 'idem-key-123',
  ...overrides,
});

const expectHttpError = async (promise: Promise<unknown>, status: number, code: string) => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect(err).toMatchObject({ status, code });
};

describe('CheckoutService', () => {
  it('charges the VAT-inclusive total, persists enrollment + invoice, and enqueues ZATCA sync', async () => {
    const { service, repository, paymentGateway, zatcaQueue, issuedAt } = setup();

    const result = await service.checkout(command());

    expect(paymentGateway.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amountHalalas: 115000, currency: 'SAR', method: 'MADA', idempotencyKey: 'idem-key-123' }),
    );
    expect(repository.createPaidEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        issuedAt,
        paymentReference: 'pay_123',
        netHalalas: 100000,
        vatHalalas: 15000,
        totalHalalas: 115000,
      }),
    );
    expect(zatcaQueue.enqueueZatcaSync).toHaveBeenCalledWith({ tenantId: TENANT, invoiceId: 'inv-1' });
    expect(result).toEqual({
      enrollmentId: 'e581f122-872f-41ed-a1eb-0242ac120002',
      status: 'ACTIVE',
      invoice: { invoiceNumber: 'INV-2026-00892', totalHalalas: 115000, vatHalalas: 15000, qrBase64: expect.any(String) },
    });
  });

  it('falls back to the display name and a generated idempotency key', async () => {
    const { service, paymentGateway } = setup();
    await service.checkout(command({ seller: { name: 'Al-Faisal', legalName: null, vatNumber: '300000000000003' }, idempotencyKey: undefined }));
    expect(paymentGateway.charge.mock.calls[0]?.[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses when the tenant has no VAT number', async () => {
    const { service, paymentGateway } = setup();
    await expectHttpError(
      service.checkout(command({ seller: { name: 'x', legalName: null, vatNumber: null } })),
      409,
      'TENANT_BILLING_NOT_CONFIGURED',
    );
    expect(paymentGateway.charge).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['unpublished', { id: COURSE, title: 'x', isPublished: false, priceHalalas: 100 }],
  ])('returns 404 for a %s course (other tenants’ courses are invisible via RLS)', async (_label, course) => {
    const { service, repository } = setup();
    repository.findCourseForCheckout.mockResolvedValue(course);
    await expectHttpError(service.checkout(command()), 404, 'COURSE_NOT_FOUND');
  });

  it('rejects free courses', async () => {
    const { service, repository } = setup();
    repository.findCourseForCheckout.mockResolvedValue({ id: COURSE, title: 'x', isPublished: true, priceHalalas: 0 });
    await expectHttpError(service.checkout(command()), 422, 'COURSE_IS_FREE');
  });

  it('rejects an existing enrollment before charging', async () => {
    const { service, repository, paymentGateway } = setup();
    repository.hasEnrollment.mockResolvedValue(true);
    await expectHttpError(service.checkout(command()), 409, 'ALREADY_ENROLLED');
    expect(paymentGateway.charge).not.toHaveBeenCalled();
  });

  it('maps a declined payment to 402 and persists nothing', async () => {
    const { service, paymentGateway, repository } = setup();
    paymentGateway.charge.mockRejectedValue(new PaymentDeclinedError('insufficient_funds'));
    await expectHttpError(service.checkout(command()), 402, 'PAYMENT_DECLINED');
    expect(repository.createPaidEnrollment).not.toHaveBeenCalled();
  });

  it('propagates unexpected gateway errors', async () => {
    const { service, paymentGateway } = setup();
    paymentGateway.charge.mockRejectedValue(new Error('gateway timeout'));
    await expect(service.checkout(command())).rejects.toThrow('gateway timeout');
  });

  it('refunds and returns 409 when a concurrent checkout wins the unique constraint', async () => {
    const { service, repository, paymentGateway } = setup();
    repository.createPaidEnrollment.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expectHttpError(service.checkout(command()), 409, 'ALREADY_ENROLLED');
    expect(paymentGateway.refund).toHaveBeenCalledWith('pay_123', 115000, 'enrollment_persist_failed');
  });

  it('refunds and rethrows on other persistence failures, even if the refund itself fails', async () => {
    const { service, repository, paymentGateway } = setup();
    repository.createPaidEnrollment.mockRejectedValue(new Error('db down'));
    paymentGateway.refund.mockRejectedValue(new Error('refund failed'));
    await expect(service.checkout(command())).rejects.toThrow('db down');
    expect(paymentGateway.refund).toHaveBeenCalled();
  });

  it('still succeeds when enqueueing the ZATCA job fails (invoice stays PENDING_ZATCA)', async () => {
    const { service, zatcaQueue } = setup();
    zatcaQueue.enqueueZatcaSync.mockRejectedValue(new Error('redis down'));
    await expect(service.checkout(command())).resolves.toMatchObject({ status: 'ACTIVE' });
  });
});
