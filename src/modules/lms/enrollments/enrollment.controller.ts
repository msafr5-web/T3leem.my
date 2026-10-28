import type { Request, Response } from 'express';
import type { PaymentMethod } from '@prisma/client';
import { requireAuthContext } from '../../../shared/middlewares/auth.middleware';
import { ok } from '../../../shared/utils/api-response';
import { halalasToNumber } from '../../../shared/utils/money';
import type { CheckoutService } from './checkout.service';

interface CheckoutBody {
  course_id: string;
  payment_method: PaymentMethod;
  payment_token: string;
}

/** HTTP adapter only: maps request -> command and result -> contract. No business logic, no DB. */
export class EnrollmentController {
  constructor(private readonly checkoutService: CheckoutService) {}

  enrollFree = async (req: Request<Record<string, never>, unknown, { course_id: string }>, res: Response): Promise<void> => {
    const { tenantId, user } = requireAuthContext(req);
    const result = await this.checkoutService.enrollFree({ tenantId, userId: user.id, courseId: req.body.course_id });
    res.status(201).json(ok({ enrollment_id: result.enrollmentId, status: result.status }));
  };

  checkout = async (req: Request<Record<string, never>, unknown, CheckoutBody>, res: Response): Promise<void> => {
    const { tenantId, tenant, user } = requireAuthContext(req);

    const result = await this.checkoutService.checkout({
      tenantId,
      seller: { name: tenant.name, legalName: tenant.legalName, vatNumber: tenant.vatNumber },
      userId: user.id,
      courseId: req.body.course_id,
      paymentMethod: req.body.payment_method,
      paymentToken: req.body.payment_token,
      idempotencyKey: req.get('idempotency-key'),
    });

    res.status(200).json(
      ok({
        enrollment_id: result.enrollmentId,
        status: result.status,
        invoice: {
          invoice_number: result.invoice.invoiceNumber,
          total_amount: halalasToNumber(result.invoice.totalHalalas),
          vat_amount: halalasToNumber(result.invoice.vatHalalas),
          zatca_qr_base64: result.invoice.qrBase64,
        },
      }),
    );
  };
}
