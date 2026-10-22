import { calculateVatHalalas, formatHalalas } from '../../shared/utils/money';
import { ZatcaTlvEncoder } from '../../shared/utils/zatca-tlv.encoder';

export interface SimplifiedInvoiceInput {
  sellerName: string;
  vatNumber: string;
  netHalalas: number;
  vatRatePercent: number;
  issuedAt: Date;
}

export interface SimplifiedInvoiceAmounts {
  netHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
  /** Tags 1–5 QR, shown immediately. The zatca-sync worker replaces it with the Phase 2
   *  QR (tags 1–9) once the XML is signed and reported. */
  qrBase64: string;
}

const VAT_NUMBER_RE = /^3\d{13}3$/;

/** ZATCA timestamps are ISO 8601 without milliseconds, e.g. 2026-10-22T19:40:00Z. */
export const toZatcaTimestamp = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

export const formatInvoiceNumber = (year: number, sequence: number): string =>
  `INV-${year}-${sequence.toString().padStart(5, '0')}`;

export function buildSimplifiedInvoice(input: SimplifiedInvoiceInput): SimplifiedInvoiceAmounts {
  if (!VAT_NUMBER_RE.test(input.vatNumber)) {
    // ZATCA VAT registration numbers are 15 digits, starting and ending with 3.
    throw new RangeError(`Invalid ZATCA VAT number: ${input.vatNumber}`);
  }
  const vatHalalas = calculateVatHalalas(input.netHalalas, input.vatRatePercent);
  const totalHalalas = input.netHalalas + vatHalalas;

  const qrBase64 = ZatcaTlvEncoder.encode({
    sellerName: input.sellerName,
    vatNumber: input.vatNumber,
    timestamp: toZatcaTimestamp(input.issuedAt),
    totalWithVat: formatHalalas(totalHalalas),
    vatTotal: formatHalalas(vatHalalas),
  });

  return { netHalalas: input.netHalalas, vatHalalas, totalHalalas, qrBase64 };
}
