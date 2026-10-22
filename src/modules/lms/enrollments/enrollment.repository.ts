import type { EnrollmentStatus, PaymentMethod } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import { formatHalalas } from '../../../shared/utils/money';
import { formatInvoiceNumber } from '../../zatca/simplified-invoice';

export interface CheckoutCourse {
  id: string;
  title: string;
  isPublished: boolean;
  /** VAT-exclusive price in halalas. */
  priceHalalas: number;
}

export interface CreatePaidEnrollmentInput {
  tenantId: string;
  userId: string;
  courseId: string;
  issuedAt: Date;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  netHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
  zatcaQr: string;
}

export interface CreatedPaidEnrollment {
  enrollmentId: string;
  enrollmentStatus: EnrollmentStatus;
  invoiceId: string;
  invoiceNumber: string;
}

export interface EnrollmentCheckoutRepository {
  findCourseForCheckout(tenantId: string, courseId: string): Promise<CheckoutCourse | null>;
  hasEnrollment(tenantId: string, userId: string, courseId: string): Promise<boolean>;
  createPaidEnrollment(input: CreatePaidEnrollmentInput): Promise<CreatedPaidEnrollment>;
}

/**
 * All access is tenant-scoped through RLS. The explicit `tenantId` filters below are
 * defense in depth — RLS alone already hides other tenants' rows.
 */
export class PrismaEnrollmentRepository implements EnrollmentCheckoutRepository {
  async findCourseForCheckout(tenantId: string, courseId: string): Promise<CheckoutCourse | null> {
    const course = await forTenant(tenantId).course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true, title: true, isPublished: true, price: true },
    });
    if (!course) return null;
    return {
      id: course.id,
      title: course.title,
      isPublished: course.isPublished,
      priceHalalas: course.price.mul(100).toDecimalPlaces(0).toNumber(),
    };
  }

  async hasEnrollment(tenantId: string, userId: string, courseId: string): Promise<boolean> {
    const existing = await forTenant(tenantId).enrollment.findUnique({
      where: { tenantId_userId_courseId: { tenantId, userId, courseId } },
      select: { id: true },
    });
    return existing !== null;
  }

  /** Enrollment, invoice number and invoice commit atomically, or not at all. */
  createPaidEnrollment(input: CreatePaidEnrollmentInput): Promise<CreatedPaidEnrollment> {
    return withTenantTransaction(input.tenantId, async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: { tenantId: input.tenantId, userId: input.userId, courseId: input.courseId },
        select: { id: true, status: true },
      });

      // Atomic increment (INSERT ... ON CONFLICT DO UPDATE): the row lock serializes concurrent
      // checkouts in the same tenant, and a rollback releases the number, keeping it gap-free.
      const year = input.issuedAt.getUTCFullYear();
      const sequence = await tx.invoiceSequence.upsert({
        where: { tenantId_year: { tenantId: input.tenantId, year } },
        create: { tenantId: input.tenantId, year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
        select: { lastValue: true },
      });

      const invoice = await tx.invoice.create({
        data: {
          tenantId: input.tenantId,
          enrollmentId: enrollment.id,
          userId: input.userId,
          invoiceNumber: formatInvoiceNumber(year, sequence.lastValue),
          issuedAt: input.issuedAt,
          subtotalAmount: formatHalalas(input.netHalalas),
          vatAmount: formatHalalas(input.vatHalalas),
          totalAmount: formatHalalas(input.totalHalalas),
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          zatcaQr: input.zatcaQr,
        },
        select: { id: true, invoiceNumber: true },
      });

      return {
        enrollmentId: enrollment.id,
        enrollmentStatus: enrollment.status,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      };
    });
  }
}
