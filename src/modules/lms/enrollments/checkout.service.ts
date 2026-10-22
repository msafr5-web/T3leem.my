import { randomUUID } from 'node:crypto';
import type { EnrollmentStatus, PaymentMethod } from '@prisma/client';
import { logger } from '../../../shared/services/logger';
import type { ZatcaQueue } from '../../../shared/services/queue.producer';
import { HttpError } from '../../../shared/utils/http-error';
import { PaymentDeclinedError, type PaymentGateway } from '../../billing/payment-gateway';
import { buildSimplifiedInvoice } from '../../zatca/simplified-invoice';
import type { EnrollmentCheckoutRepository } from './enrollment.repository';

export interface CheckoutCommand {
  tenantId: string;
  seller: { name: string; legalName: string | null; vatNumber: string | null };
  userId: string;
  courseId: string;
  paymentMethod: PaymentMethod;
  paymentToken: string;
  idempotencyKey?: string;
}

export interface CheckoutResult {
  enrollmentId: string;
  status: EnrollmentStatus;
  invoice: {
    invoiceNumber: string;
    totalHalalas: number;
    vatHalalas: number;
    qrBase64: string;
  };
}

export interface CheckoutServiceDeps {
  repository: EnrollmentCheckoutRepository;
  paymentGateway: PaymentGateway;
  zatcaQueue: ZatcaQueue;
  vatRatePercent: number;
  clock?: () => Date;
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

/**
 * Paid course checkout: validate -> charge -> persist (enrollment + invoice) -> enqueue ZATCA.
 *
 * The payment call is deliberately made OUTSIDE the DB transaction: holding a transaction
 * (and its row locks / pooled connection) open across a third-party network call would
 * throttle the whole tenant. Consistency is restored with a compensating refund if the
 * write fails after a successful charge.
 */
export class CheckoutService {
  private readonly clock: () => Date;

  constructor(private readonly deps: CheckoutServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async checkout(cmd: CheckoutCommand): Promise<CheckoutResult> {
    const { repository, paymentGateway, zatcaQueue, vatRatePercent } = this.deps;

    if (!cmd.seller.vatNumber) {
      throw HttpError.conflict('TENANT_BILLING_NOT_CONFIGURED', 'This academy cannot issue tax invoices yet');
    }

    const course = await repository.findCourseForCheckout(cmd.tenantId, cmd.courseId);
    if (!course || !course.isPublished) {
      throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    }
    if (course.priceHalalas === 0) {
      throw HttpError.unprocessable('COURSE_IS_FREE', 'Free courses do not go through checkout');
    }
    if (await repository.hasEnrollment(cmd.tenantId, cmd.userId, cmd.courseId)) {
      throw HttpError.conflict('ALREADY_ENROLLED', 'You are already enrolled in this course');
    }

    const issuedAt = this.clock();
    const invoice = buildSimplifiedInvoice({
      sellerName: cmd.seller.legalName ?? cmd.seller.name,
      vatNumber: cmd.seller.vatNumber,
      netHalalas: course.priceHalalas,
      vatRatePercent,
      issuedAt,
    });

    let paymentReference: string;
    try {
      const charge = await paymentGateway.charge({
        amountHalalas: invoice.totalHalalas,
        currency: 'SAR',
        method: cmd.paymentMethod,
        token: cmd.paymentToken,
        idempotencyKey: cmd.idempotencyKey ?? randomUUID(),
        metadata: { tenantId: cmd.tenantId, userId: cmd.userId, courseId: cmd.courseId },
      });
      paymentReference = charge.reference;
    } catch (err) {
      if (err instanceof PaymentDeclinedError) {
        throw HttpError.paymentRequired('PAYMENT_DECLINED', 'The payment was declined');
      }
      throw err;
    }

    let created;
    try {
      created = await repository.createPaidEnrollment({
        tenantId: cmd.tenantId,
        userId: cmd.userId,
        courseId: cmd.courseId,
        issuedAt,
        paymentMethod: cmd.paymentMethod,
        paymentReference,
        netHalalas: invoice.netHalalas,
        vatHalalas: invoice.vatHalalas,
        totalHalalas: invoice.totalHalalas,
        zatcaQr: invoice.qrBase64,
      });
    } catch (err) {
      // Charged but not enrolled: compensate. A concurrent duplicate checkout lands here too
      // (the unique constraint on enrollments rejects the loser).
      await paymentGateway
        .refund(paymentReference, invoice.totalHalalas, 'enrollment_persist_failed')
        .catch((refundErr: unknown) => {
          logger.error('CRITICAL: refund after failed enrollment did not succeed — manual action required', {
            refundErr,
            paymentReference,
            tenantId: cmd.tenantId,
            userId: cmd.userId,
          });
        });
      if (isUniqueViolation(err)) {
        throw HttpError.conflict('ALREADY_ENROLLED', 'You are already enrolled in this course');
      }
      throw err;
    }

    try {
      await zatcaQueue.enqueueZatcaSync({ tenantId: cmd.tenantId, invoiceId: created.invoiceId });
    } catch (err) {
      // The learner has paid and is enrolled — don't fail the request. The invoice stays
      // PENDING_ZATCA and is picked up by the reconciliation sweep.
      logger.error('Failed to enqueue ZATCA sync; invoice left PENDING_ZATCA', { err, invoiceId: created.invoiceId });
    }

    return {
      enrollmentId: created.enrollmentId,
      status: created.enrollmentStatus,
      invoice: {
        invoiceNumber: created.invoiceNumber,
        totalHalalas: invoice.totalHalalas,
        vatHalalas: invoice.vatHalalas,
        qrBase64: invoice.qrBase64,
      },
    };
  }
}
