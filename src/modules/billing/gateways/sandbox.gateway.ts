import { randomUUID } from 'node:crypto';
import { logger } from '../../../shared/services/logger';
import { PaymentDeclinedError, type ChargeRequest, type ChargeResult, type PaymentGateway } from '../payment-gateway';

/**
 * Local/staging gateway. Tokens starting with `tok_decline` are declined; anything else is captured.
 * env.ts refuses PAYMENT_GATEWAY=sandbox when NODE_ENV=production.
 */
export class SandboxPaymentGateway implements PaymentGateway {
  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (request.token.startsWith('tok_decline')) {
      throw new PaymentDeclinedError('sandbox_declined');
    }
    const reference = `sbx_${randomUUID()}`;
    logger.info('Sandbox charge captured', { reference, amountHalalas: request.amountHalalas, method: request.method });
    return { reference };
  }

  async refund(reference: string, amountHalalas: number, reason: string): Promise<void> {
    logger.info('Sandbox refund issued', { reference, amountHalalas, reason });
  }
}
