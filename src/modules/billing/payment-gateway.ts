import type { PaymentMethod } from '@prisma/client';

export interface ChargeRequest {
  amountHalalas: number;
  currency: 'SAR';
  method: PaymentMethod;
  /** Tokenized card/wallet reference from the client-side SDK — raw PANs never reach our servers. */
  token: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface ChargeResult {
  reference: string;
}

export class PaymentDeclinedError extends Error {
  constructor(public readonly reason: string) {
    super(`Payment declined: ${reason}`);
    this.name = 'PaymentDeclinedError';
  }
}

/** Port for Mada / Stripe / HyperPay adapters. */
export interface PaymentGateway {
  /** Captures funds or throws PaymentDeclinedError. */
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(reference: string, amountHalalas: number, reason: string): Promise<void>;
}
