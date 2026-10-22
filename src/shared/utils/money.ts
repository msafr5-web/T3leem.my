/**
 * Money is handled as integer halalas (1 SAR = 100 halalas) to avoid floating-point drift
 * in VAT arithmetic. Conversion to strings/decimals happens only at the edges.
 */

/** 115000 -> "1150.00" (exact, no float formatting). */
export function formatHalalas(halalas: number): string {
  if (!Number.isSafeInteger(halalas) || halalas < 0) {
    throw new RangeError(`Invalid halalas amount: ${halalas}`);
  }
  const riyals = Math.floor(halalas / 100);
  const remainder = halalas % 100;
  return `${riyals}.${remainder.toString().padStart(2, '0')}`;
}

/** 115000 -> 1150 (for JSON number fields in API responses). */
export const halalasToNumber = (halalas: number): number => Number(formatHalalas(halalas));

/** VAT on a VAT-exclusive amount, rounded half-up to the nearest halala. */
export function calculateVatHalalas(netHalalas: number, ratePercent: number): number {
  if (!Number.isSafeInteger(netHalalas) || netHalalas < 0) {
    throw new RangeError(`Invalid net amount: ${netHalalas}`);
  }
  return Math.round((netHalalas * ratePercent) / 100);
}
