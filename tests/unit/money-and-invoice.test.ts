import { calculateVatHalalas, formatHalalas, halalasToNumber } from '../../src/shared/utils/money';
import { ZatcaTlvEncoder } from '../../src/shared/utils/zatca-tlv.encoder';
import {
  buildSimplifiedInvoice,
  formatInvoiceNumber,
  toZatcaTimestamp,
} from '../../src/modules/zatca/simplified-invoice';

describe('money', () => {
  it('formats halalas exactly', () => {
    expect(formatHalalas(115000)).toBe('1150.00');
    expect(formatHalalas(1999)).toBe('19.99');
    expect(formatHalalas(5)).toBe('0.05');
    expect(formatHalalas(0)).toBe('0.00');
    expect(halalasToNumber(115050)).toBe(1150.5);
  });

  it('rejects negative or non-integer amounts', () => {
    expect(() => formatHalalas(-1)).toThrow(RangeError);
    expect(() => formatHalalas(1.5)).toThrow(RangeError);
    expect(() => calculateVatHalalas(-1, 15)).toThrow(RangeError);
  });

  it('computes 15% VAT rounded half-up to the halala', () => {
    expect(calculateVatHalalas(100000, 15)).toBe(15000);
    expect(calculateVatHalalas(1999, 15)).toBe(300); // 299.85 -> 300
    expect(calculateVatHalalas(1, 15)).toBe(0); // 0.15 -> 0
  });
});

describe('simplified invoice', () => {
  const issuedAt = new Date('2026-10-22T19:40:00.123Z');

  it('formats ZATCA timestamps without milliseconds', () => {
    expect(toZatcaTimestamp(issuedAt)).toBe('2026-10-22T19:40:00Z');
  });

  it('formats sequential invoice numbers', () => {
    expect(formatInvoiceNumber(2026, 892)).toBe('INV-2026-00892');
  });

  it('builds the SWET sample amounts (1000 net -> 150 VAT -> 1150 total) and a matching QR', () => {
    const result = buildSimplifiedInvoice({
      sellerName: 'Rukn Academy',
      vatNumber: '300000000000003',
      netHalalas: 100000,
      vatRatePercent: 15,
      issuedAt,
    });

    expect(result).toMatchObject({ netHalalas: 100000, vatHalalas: 15000, totalHalalas: 115000 });
    const tlv = ZatcaTlvEncoder.decode(result.qrBase64);
    expect(tlv.get(3)?.toString()).toBe('2026-10-22T19:40:00Z');
    expect(tlv.get(4)?.toString()).toBe('1150.00');
    expect(tlv.get(5)?.toString()).toBe('150.00');
  });

  it('rejects malformed VAT numbers', () => {
    expect(() =>
      buildSimplifiedInvoice({ sellerName: 'x', vatNumber: '123', netHalalas: 100, vatRatePercent: 15, issuedAt }),
    ).toThrow(RangeError);
  });
});
