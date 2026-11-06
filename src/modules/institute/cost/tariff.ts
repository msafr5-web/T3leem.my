/**
 * Saudi electricity consumption tariffs (Saudi Energy, formerly Saudi Electricity Company).
 *
 * What is on record, and how sure we are (re-check against the official tariff table before relying on a figure):
 *  - Until 31 Dec 2026, commercial (which includes private health and private education): 22 halalas/kWh up to
 *    6,000 kWh per month and 32 halalas above, per the regulator's tariff guide as reported by Saudi Gazette.
 *    The monthly "meter reading, maintenance and billing" fee of that period is NOT recorded here (amount unverified),
 *    so an estimate for those months is energy only.
 *  - From 1 Jan 2027 (announced by Saudi Energy on 25 Oct 2026): per-category consumption rates and a fixed monthly
 *    charge by circuit-breaker size, prorated by bill days / 30. VAT is added separately. Consumption before the
 *    effective date is billed at the tariff in force when it was consumed.
 *
 * Tariffs are data, not code paths: a new tariff is a new row with its own effective dates, so older bills keep
 * being explained by the tariff that applied to them.
 */

export type TariffCategory = 'COMMERCIAL' | 'GOVERNMENT' | 'INDUSTRIAL' | 'AGRICULTURAL' | 'CHARITY';
export const TARIFF_CATEGORIES: readonly TariffCategory[] = ['COMMERCIAL', 'GOVERNMENT', 'INDUSTRIAL', 'AGRICULTURAL', 'CHARITY'];

export interface Tier {
  /** Upper bound of the tier in kWh per bill month; null = no upper bound. */
  upToKwh: number | null;
  halalasPerKwh: number;
}
export interface FixedCharge {
  /** Breaker size band [fromAmp, toAmpExclusive); null upper = open ended. */
  fromAmp: number;
  toAmpExclusive: number | null;
  sar: number;
}
export interface Tariff {
  id: string;
  category: TariffCategory;
  /** Inclusive, YYYY-MM-DD. */
  effectiveFrom: string;
  /** Inclusive, YYYY-MM-DD; null = still in force. */
  effectiveTo: string | null;
  tiers: Tier[];
  /** Null = the fixed charge of this period is not on record (estimate is energy only). */
  fixedCharges: FixedCharge[] | null;
  source: string;
}

const BREAKERS_STANDARD: FixedCharge[] = [
  { fromAmp: 20, toAmpExclusive: 100, sar: 350 },
  { fromAmp: 100, toAmpExclusive: 200, sar: 500 },
  { fromAmp: 200, toAmpExclusive: 300, sar: 700 },
  { fromAmp: 300, toAmpExclusive: null, sar: 900 },
];
const BREAKERS_SMALL: FixedCharge[] = [
  { fromAmp: 20, toAmpExclusive: 100, sar: 140 },
  { fromAmp: 100, toAmpExclusive: 200, sar: 160 },
  { fromAmp: 200, toAmpExclusive: 300, sar: 180 },
  { fromAmp: 300, toAmpExclusive: null, sar: 200 },
];
const NEW = { effectiveFrom: '2027-01-01', effectiveTo: null, source: 'Saudi Energy tariff announcement, 25 Oct 2026 (effective 1 Jan 2027)' } as const;

export const TARIFFS: readonly Tariff[] = [
  {
    id: 'SE-2018-COMMERCIAL',
    category: 'COMMERCIAL',
    effectiveFrom: '2018-01-01',
    effectiveTo: '2026-12-31',
    tiers: [{ upToKwh: 6000, halalasPerKwh: 22 }, { upToKwh: null, halalasPerKwh: 32 }],
    fixedCharges: null,
    source: 'Regulator tariff guide (22 / 32 halalas), as reported by Saudi Gazette',
  },
  { id: 'SE-2027-COMMERCIAL', category: 'COMMERCIAL', ...NEW, tiers: [{ upToKwh: 6000, halalasPerKwh: 25 }, { upToKwh: null, halalasPerKwh: 35 }], fixedCharges: BREAKERS_STANDARD },
  { id: 'SE-2027-GOVERNMENT', category: 'GOVERNMENT', ...NEW, tiers: [{ upToKwh: null, halalasPerKwh: 35 }], fixedCharges: BREAKERS_STANDARD },
  { id: 'SE-2027-INDUSTRIAL', category: 'INDUSTRIAL', ...NEW, tiers: [{ upToKwh: null, halalasPerKwh: 23 }], fixedCharges: BREAKERS_STANDARD },
  { id: 'SE-2027-AGRICULTURAL', category: 'AGRICULTURAL', ...NEW, tiers: [{ upToKwh: 6000, halalasPerKwh: 19 }, { upToKwh: null, halalasPerKwh: 23 }], fixedCharges: BREAKERS_SMALL },
  { id: 'SE-2027-CHARITY', category: 'CHARITY', ...NEW, tiers: [{ upToKwh: 6000, halalasPerKwh: 17 }, { upToKwh: null, halalasPerKwh: 21 }], fixedCharges: BREAKERS_SMALL },
];

/** The tariff of `category` in force on `date` (YYYY-MM-DD), or null when none is on record for that day. */
export function tariffOn(category: TariffCategory, date: string): Tariff | null {
  return TARIFFS.find((t) => t.category === category && t.effectiveFrom <= date && (t.effectiveTo === null || date <= t.effectiveTo)) ?? null;
}

export interface BillEstimate {
  tariffId: string;
  /** Consumption charge in halalas (cents). */
  energyCents: number;
  /** Fixed charge in halalas; null when the tariff period has no recorded fixed charge or the breaker size is unknown. */
  fixedCents: number | null;
  vatCents: number;
  totalCents: number;
  /** Energy per tier actually used, for the explanation line on a report. */
  tiers: { kwh: number; halalasPerKwh: number; cents: number }[];
  warnings: ('FIXED_CHARGE_NOT_ON_RECORD' | 'BREAKER_SIZE_UNKNOWN' | 'BREAKER_BELOW_MINIMUM')[];
}
export type EstimateFailure = 'NO_TARIFF_ON_RECORD' | 'PERIOD_STRADDLES_TARIFF_CHANGE' | 'INVALID_PERIOD';

const daysInclusive = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * What the bill should be for a billing period under the tariff in force. All money is in halalas (integers).
 * Tiers are applied to the kWh of the whole bill (the 6,000 kWh limit is monthly; it is not prorated), the fixed charge is
 * prorated by bill days / 30, VAT is `vatRatePercent` of (energy + fixed). A period that spans a tariff change is refused
 * rather than guessed, because how the threshold splits across the two tariffs is not published.
 */
export function estimateBill(input: {
  category: TariffCategory;
  periodStart: string;
  periodEnd: string;
  /** kWh with at most 2 decimals. */
  kwh: number;
  breakerAmps: number | null;
  vatRatePercent: number;
}): BillEstimate | { failure: EstimateFailure } {
  const days = daysInclusive(input.periodStart, input.periodEnd);
  if (!(days >= 1) || input.kwh < 0) return { failure: 'INVALID_PERIOD' };
  const first = tariffOn(input.category, input.periodStart);
  const last = tariffOn(input.category, input.periodEnd);
  if (!first || !last) return { failure: 'NO_TARIFF_ON_RECORD' };
  if (first.id !== last.id) return { failure: 'PERIOD_STRADDLES_TARIFF_CHANGE' };

  let left = Math.round(input.kwh * 100); // hundredths of a kWh, exact integers
  let floor = 0;
  const tiers: BillEstimate['tiers'] = [];
  let energy = 0;
  for (const t of first.tiers) {
    const cap = t.upToKwh === null ? Infinity : Math.round(t.upToKwh * 100) - floor;
    const used = Math.min(left, cap);
    if (used > 0) {
      const cents = Math.round((used * t.halalasPerKwh) / 100); // (kWh/100) * halalas = cents
      tiers.push({ kwh: used / 100, halalasPerKwh: t.halalasPerKwh, cents });
      energy += cents;
    }
    left -= used;
    floor = t.upToKwh === null ? floor : Math.round(t.upToKwh * 100);
    if (left <= 0) break;
  }

  const warnings: BillEstimate['warnings'] = [];
  let fixed: number | null = null;
  if (first.fixedCharges === null) warnings.push('FIXED_CHARGE_NOT_ON_RECORD');
  else if (input.breakerAmps === null) warnings.push('BREAKER_SIZE_UNKNOWN');
  else {
    const band = first.fixedCharges.find((f) => input.breakerAmps! >= f.fromAmp && (f.toAmpExclusive === null || input.breakerAmps! < f.toAmpExclusive));
    if (!band) warnings.push('BREAKER_BELOW_MINIMUM');
    else fixed = Math.round((band.sar * 100 * days) / 30);
  }

  const vat = Math.round(((energy + (fixed ?? 0)) * input.vatRatePercent) / 100);
  return { tariffId: first.id, energyCents: energy, fixedCents: fixed, vatCents: vat, totalCents: energy + (fixed ?? 0) + vat, tiers, warnings };
}
