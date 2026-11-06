/**
 * The institute cost engine: pure functions over plain data (no I/O, no clock), driven by an approved cost policy.
 * Money is integer halalas, time is integer minutes, areas / power are integer hundredths, so every figure is exact and
 * a report can be re-computed to the halala from the same inputs and the same policy version.
 *
 * Accounting basis (SOCPA-endorsed IFRS): depreciation is straight-line over the useful life to the residual value (IAS 16);
 * tuition can be recognised over time in proportion to hours delivered (IFRS 15, input method). Tax (ZATCA) depreciation
 * groups are a different calculation for zakat / income tax and are intentionally NOT used for management cost.
 */
import { instructorPayCents, monthStart, nextMonthStart } from '../finance/finance.logic';
import type { TariffCategory } from './tariff';

// ------------------------------------------------------------------ policy

export type ElectricityAllocation = 'AREA' | 'POWER_HOURS' | 'METER';
export type DepreciationStart = 'PURCHASE_MONTH' | 'NEXT_MONTH';
export type OverheadBasis = 'AREA' | 'HOURS';
export type RevenueBasis = 'CASH' | 'OVER_TIME';

/** The decisions the accountant approves. Stored with a version; a report always names the version it used. */
export interface CostPolicyParams {
  electricity: {
    tariffCategory: TariffCategory;
    allocation: ElectricityAllocation;
    /** VAT rate in percent, applied when estimating what a bill should be (15 at the time of writing). */
    vatRatePercent: number;
    /**
     * Whether the institute is registered for VAT (mandatory above SAR 375,000 of taxable supplies in 12 months). Only a registered
     * person can deduct input VAT; an unregistered one bears it as a cost.
     */
    vatRegistered: boolean;
    /**
     * The share of the VAT on the bill that can be deducted, in percent. ZATCA's input-tax guideline: a person making only taxable
     * supplies (standard or zero rated; private education is taxable, the State bearing the VAT for citizens) deducts in full (100);
     * with exempt supplies as well, the overhead VAT (electricity and water are named) is apportioned to the taxable share.
     */
    vatRecoveryPercent: number;
    /** Main breaker size in amperes per branch id, for the fixed charge. */
    breakerAmps: Record<string, number>;
  };
  depreciation: {
    start: DepreciationStart;
    /** Used when an asset has no useful life of its own. */
    defaultLifeMonths: number;
  };
  /** How branch overhead (expenses not tied to a room, assets not placed in a room) is spread over the rooms. */
  overhead: { basis: OverheadBasis };
  /** Hours a room could be used in a month; the occupancy denominator. */
  occupancy: { availableHoursPerMonth: number };
  revenue: { basis: RevenueBasis };
}

export const DEFAULT_POLICY: CostPolicyParams = {
  // Defaults follow the official positions: metered use first (the cause), connected load x hours as the proxy, area as the last resort;
  // input VAT deductible in full for a registered, fully taxable institute; tuition recognised over time (IFRS 15).
  electricity: { tariffCategory: 'COMMERCIAL', allocation: 'METER', vatRatePercent: 15, vatRegistered: true, vatRecoveryPercent: 100, breakerAmps: {} },
  depreciation: { start: 'PURCHASE_MONTH', defaultLifeMonths: 60 },
  overhead: { basis: 'AREA' },
  occupancy: { availableHoursPerMonth: 176 },
  revenue: { basis: 'OVER_TIME' },
};

// ------------------------------------------------------------------ exact allocation

/**
 * Splits `totalCents` in proportion to `weights` with no halala lost or invented (largest remainder; ties go to the lower index).
 * Uses BigInt because total x weight can exceed 2^53. Returns null when every weight is zero (nothing to split by).
 */
export function allocateByWeights(totalCents: number, weights: number[]): number[] | null {
  const sum = weights.reduce((n, w) => n + BigInt(w), 0n);
  if (sum === 0n) return null;
  const total = BigInt(totalCents);
  const base = weights.map((w) => (total * BigInt(w)) / sum);
  const rems = weights.map((w, i) => ({ i, r: (total * BigInt(w)) % sum }));
  let left = Number(total - base.reduce((n, b) => n + b, 0n));
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = base.map(Number);
  for (const { i } of rems) {
    if (left <= 0) break;
    out[i] = (out[i] as number) + 1;
    left -= 1;
  }
  return out;
}

// ------------------------------------------------------------------ depreciation (IAS 16, straight-line)

export interface DepAsset {
  id: string;
  roomId: string | null;
  status: 'IN_SERVICE' | 'MAINTENANCE' | 'RETIRED';
  /** YYYY-MM-DD, null = unknown (the asset cannot be depreciated and is reported as a warning). */
  purchaseDate: string | null;
  retiredOn: string | null;
  costCents: number;
  /** Residual (salvage) value as a percentage x100 of cost (10% = 1000), so it stays an integer. */
  residualBp: number;
  usefulLifeMonths: number | null;
}

/** Months from month-start `from` to month-start `to` (YYYY-MM-01), signed. */
export const monthIndex = (from: string, to: string): number => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/**
 * The depreciation charge of one asset for `month` (YYYY-MM-01). The depreciable amount (cost - residual) is spread over the
 * life by cumulative rounding, so the monthly charges add up to it exactly. Depreciation starts in the purchase month or the
 * month after (policy), ends after the last month of the life, and stops after the month an asset was retired.
 */
export function monthlyDepreciation(a: DepAsset, month: string, policy: Pick<CostPolicyParams['depreciation'], 'start' | 'defaultLifeMonths'>): number {
  if (a.purchaseDate === null || a.costCents <= 0) return 0;
  const life = a.usefulLifeMonths ?? policy.defaultLifeMonths;
  const first = policy.start === 'PURCHASE_MONTH' ? monthStart(a.purchaseDate) : nextMonthStart(monthStart(a.purchaseDate));
  const k = monthIndex(first, month) + 1; // 1-based month of the asset's life
  if (k < 1 || k > life) return 0;
  if (a.retiredOn !== null && month > monthStart(a.retiredOn)) return 0;
  if (a.status === 'RETIRED' && a.retiredOn === null) return 0; // retired on an unknown date: excluded, and reported
  const depreciable = Math.round((a.costCents * (10_000 - a.residualBp)) / 10_000);
  return Math.round((depreciable * k) / life) - Math.round((depreciable * (k - 1)) / life);
}

// ------------------------------------------------------------------ electricity allocation

export interface CostRoom {
  id: string;
  name: string;
  /** Hundredths of a square metre. */
  areaX100: number;
  /** Connected power, hundredths of a kW. */
  kwX100: number;
}

export type Warning =
  | { code: 'NO_BILL'; detail?: undefined }
  | { code: 'BILL_NET_OF_VAT_ESTIMATED'; detail?: undefined }
  | { code: 'NO_USAGE_FALLBACK_AREA'; detail?: undefined }
  | { code: 'NO_BILL_KWH_FALLBACK_POWER_HOURS'; detail?: undefined }
  | { code: 'READINGS_EXCEED_BILL_KWH'; detail?: undefined }
  | { code: 'ROOM_POWER_MISSING'; detail: string }
  | { code: 'ROOM_AREA_MISSING'; detail: string }
  | { code: 'ASSET_NO_PURCHASE_DATE'; detail: string }
  | { code: 'ASSET_RETIRED_WITHOUT_DATE'; detail: string }
  | { code: 'ASSET_NO_COST'; detail: string }
  | { code: 'NO_ROOMS'; detail?: undefined }
  | { code: 'NO_PROGRAM_HOURS'; detail: string }
  | { code: 'REVENUE_BASIS_NOT_IFRS15'; detail?: undefined };

export interface ElectricityInput {
  method: ElectricityAllocation;
  /** What the room costs bear: the bill net of recoverable VAT (or gross when VAT is not recoverable). */
  costCents: number;
  billKwhX100: number | null;
  rooms: CostRoom[];
  heldMinutes: Record<string, number>;
  /** Sub-meter readings of the month, hundredths of a kWh, by room id (only for METER). */
  readingsKwhX100: Record<string, number>;
}
export interface ElectricityResult {
  methodUsed: ElectricityAllocation;
  byRoom: Record<string, number>;
  warnings: Warning[];
}

/**
 * Spreads the month's electricity cost over the rooms.
 *  AREA: by floor area.  POWER_HOURS: by connected kW x hours actually taught (a lab with 12 kW running 100 h bears far more
 *  than a hall with 2 kW running 100 h).  METER: sub-metered rooms bear their metered share of the bill's kWh, and what no
 *  meter explains (corridors, lighting, common areas) is shared by area.
 * Anything that cannot be computed as asked falls back to a simpler method and says so in `warnings`.
 */
export function allocateElectricity(input: ElectricityInput): ElectricityResult {
  const { rooms } = input;
  const warnings: Warning[] = [];
  const zero = Object.fromEntries(rooms.map((r) => [r.id, 0]));
  if (rooms.length === 0) return { methodUsed: input.method, byRoom: {}, warnings: [{ code: 'NO_ROOMS' }] };
  const split = (weights: number[], total: number): Record<string, number> => {
    const parts = allocateByWeights(total, weights);
    return parts ? Object.fromEntries(rooms.map((r, i) => [r.id, parts[i] as number])) : { ...zero };
  };
  const byArea = (total: number) => split(rooms.map((r) => r.areaX100), total);
  // Nothing to allocate (no bill recorded): zeros, and no noise about how it would have been split.
  if (input.costCents === 0) return { methodUsed: input.method, byRoom: zero, warnings: [] };
  for (const r of rooms) if (r.areaX100 <= 0) warnings.push({ code: 'ROOM_AREA_MISSING', detail: r.id });

  const powerHours = (): ElectricityResult => {
    for (const r of rooms) if (r.kwX100 <= 0 && (input.heldMinutes[r.id] ?? 0) > 0) warnings.push({ code: 'ROOM_POWER_MISSING', detail: r.id });
    const weights = rooms.map((r) => r.kwX100 * (input.heldMinutes[r.id] ?? 0));
    if (weights.every((w) => w === 0)) {
      warnings.push({ code: 'NO_USAGE_FALLBACK_AREA' });
      return { methodUsed: 'AREA', byRoom: byArea(input.costCents), warnings };
    }
    return { methodUsed: 'POWER_HOURS', byRoom: split(weights, input.costCents), warnings };
  };

  if (input.method === 'AREA') return { methodUsed: 'AREA', byRoom: byArea(input.costCents), warnings };
  if (input.method === 'POWER_HOURS') return powerHours();

  // METER
  if (!input.billKwhX100 || input.billKwhX100 <= 0) {
    warnings.push({ code: 'NO_BILL_KWH_FALLBACK_POWER_HOURS' });
    return powerHours();
  }
  const metered = rooms.map((r) => input.readingsKwhX100[r.id] ?? 0);
  const meteredSum = metered.reduce((n, v) => n + v, 0);
  if (meteredSum <= 0) {
    warnings.push({ code: 'NO_BILL_KWH_FALLBACK_POWER_HOURS' });
    return powerHours();
  }
  if (meteredSum > input.billKwhX100) {
    // Readings that add up to more than the bill cannot all be true: use them only as proportions of the whole bill.
    warnings.push({ code: 'READINGS_EXCEED_BILL_KWH' });
    return { methodUsed: 'METER', byRoom: split(metered, input.costCents), warnings };
  }
  const meteredCost = Math.round((input.costCents * meteredSum) / input.billKwhX100);
  const direct = allocateByWeights(meteredCost, metered) as number[];
  const common = byArea(input.costCents - meteredCost);
  return { methodUsed: 'METER', byRoom: Object.fromEntries(rooms.map((r, i) => [r.id, (direct[i] as number) + (common[r.id] as number)])), warnings };
}

// ------------------------------------------------------------------ room costs

export interface RoomCostInput {
  month: string; // YYYY-MM-01
  policy: CostPolicyParams;
  rooms: CostRoom[];
  heldMinutes: Record<string, number>;
  readingsKwhX100: Record<string, number>;
  /** The electricity bill of the month, or null when none was recorded. */
  bill: { amountCents: number; vatCents: number | null; kwhX100: number | null } | null;
  assets: DepAsset[];
  /** Expenses of the month: tied to a room, or branch overhead. Electricity is never here (it is a bill). */
  expenses: { roomId: string | null; amountCents: number }[];
}

export interface RoomCost {
  roomId: string;
  name: string;
  electricityCents: number;
  depreciationCents: number;
  directExpenseCents: number;
  overheadCents: number;
  totalCents: number;
  heldMinutes: number;
  /** Null when the room taught nothing this month (its whole cost is idle capacity). */
  costPerHourCents: number | null;
  /** Held hours as a share of the hours the room could have been used, in percent with one decimal. */
  occupancyPercent: number;
}
export interface RoomCostResult {
  rooms: RoomCost[];
  electricity: { methodUsed: ElectricityAllocation; costCents: number };
  overheadCents: number;
  totalCents: number;
  warnings: Warning[];
}

export function computeRoomCosts(input: RoomCostInput): RoomCostResult {
  const { rooms, policy } = input;
  const warnings: Warning[] = [];

  // Electricity: what the institute actually bears = the bill less the input VAT it can deduct. The VAT is the one stated on the bill,
  // or estimated from the rate (and flagged) when the bill did not state it. Not registered = nothing deductible.
  let electricityCost = 0;
  if (!input.bill) warnings.push({ code: 'NO_BILL' });
  else {
    const recoveryBp = policy.electricity.vatRegistered ? Math.round(policy.electricity.vatRecoveryPercent * 100) : 0;
    let vat = input.bill.vatCents;
    if (vat === null) {
      vat = Math.round((input.bill.amountCents * policy.electricity.vatRatePercent) / (100 + policy.electricity.vatRatePercent));
      if (recoveryBp > 0) warnings.push({ code: 'BILL_NET_OF_VAT_ESTIMATED' });
    }
    electricityCost = input.bill.amountCents - Math.round((vat * recoveryBp) / 10_000);
  }

  const elec = allocateElectricity({ method: policy.electricity.allocation, costCents: electricityCost, billKwhX100: input.bill?.kwhX100 ?? null, rooms, heldMinutes: input.heldMinutes, readingsKwhX100: input.readingsKwhX100 });
  warnings.push(...elec.warnings);

  // Depreciation: assets in a room belong to it; the rest is branch overhead.
  const depByRoom: Record<string, number> = {};
  let unplacedDep = 0;
  for (const a of input.assets) {
    if (a.status === 'RETIRED' && a.retiredOn === null) warnings.push({ code: 'ASSET_RETIRED_WITHOUT_DATE', detail: a.id });
    else if (a.purchaseDate === null) warnings.push({ code: 'ASSET_NO_PURCHASE_DATE', detail: a.id });
    else if (a.costCents <= 0) warnings.push({ code: 'ASSET_NO_COST', detail: a.id });
    const d = monthlyDepreciation(a, input.month, policy.depreciation);
    if (a.roomId && rooms.some((r) => r.id === a.roomId)) depByRoom[a.roomId] = (depByRoom[a.roomId] ?? 0) + d;
    else unplacedDep += d;
  }

  const directByRoom: Record<string, number> = {};
  let overheadExpenses = 0;
  for (const e of input.expenses) {
    if (e.roomId && rooms.some((r) => r.id === e.roomId)) directByRoom[e.roomId] = (directByRoom[e.roomId] ?? 0) + e.amountCents;
    else overheadExpenses += e.amountCents;
  }

  const overheadTotal = unplacedDep + overheadExpenses;
  const hoursWeights = rooms.map((r) => input.heldMinutes[r.id] ?? 0);
  const areaWeights = rooms.map((r) => r.areaX100);
  const useHours = policy.overhead.basis === 'HOURS' && hoursWeights.some((w) => w > 0);
  const overheadParts = rooms.length === 0 ? null : allocateByWeights(overheadTotal, useHours ? hoursWeights : areaWeights);
  if (rooms.length > 0 && overheadTotal > 0 && !overheadParts) warnings.push({ code: 'ROOM_AREA_MISSING', detail: 'overhead' });

  const costs: RoomCost[] = rooms.map((r, i) => {
    const electricityCents = elec.byRoom[r.id] ?? 0;
    const depreciationCents = depByRoom[r.id] ?? 0;
    const directExpenseCents = directByRoom[r.id] ?? 0;
    const overheadCents = overheadParts ? (overheadParts[i] as number) : 0;
    const totalCents = electricityCents + depreciationCents + directExpenseCents + overheadCents;
    const minutes = input.heldMinutes[r.id] ?? 0;
    return {
      roomId: r.id,
      name: r.name,
      electricityCents,
      depreciationCents,
      directExpenseCents,
      overheadCents,
      totalCents,
      heldMinutes: minutes,
      costPerHourCents: minutes > 0 ? Math.round((totalCents * 60) / minutes) : null,
      occupancyPercent: policy.occupancy.availableHoursPerMonth > 0 ? Math.round((minutes / 60 / policy.occupancy.availableHoursPerMonth) * 1000) / 10 : 0,
    };
  });
  return { rooms: costs, electricity: { methodUsed: elec.methodUsed, costCents: electricityCost }, overheadCents: overheadTotal, totalCents: costs.reduce((n, c) => n + c.totalCents, 0), warnings };
}

// ------------------------------------------------------------------ program costing and profitability

export interface HeldSession {
  roomId: string;
  instructorId: string;
  programId: string;
  minutes: number;
}
export interface ProgramInput {
  id: string;
  name: string;
  /** Students currently enrolled and active in the program. */
  activeStudents: number;
  /** Total hours of all the program's subjects (the denominator of progress). */
  totalMinutes: number;
  /** Net of all open student invoices of the program's students. */
  invoicedCents: number;
  /** Collected (not voided) payments of the program's students dated in the month. */
  collectedCents: number;
  /** Hours of the program delivered before the month starts / by the month end (for over-time revenue). */
  deliveredBeforeMinutes: number;
  deliveredUntilMinutes: number;
}
export interface ProgramCost {
  programId: string;
  name: string;
  heldMinutes: number;
  facilityCents: number;
  instructorCents: number;
  totalCostCents: number;
  revenueCents: number;
  profitCents: number;
  costPerStudentCents: number | null;
  activeStudents: number;
}
export interface ProgramReport {
  programs: ProgramCost[];
  /** Room cost that no held session absorbed: capacity paid for and not used. */
  idleCostCents: number;
  warnings: Warning[];
}

/**
 * Each held session bears its room's cost for the minutes it used (room cost x minutes / room's held minutes) plus the
 * instructor's pay for those minutes. Programs add their sessions up. What the rooms cost beyond that is idle capacity.
 * Revenue follows the policy: CASH = collected in the month; OVER_TIME = invoiced total x share of the program's hours
 * delivered during the month (IFRS 15 input method), never more than the invoiced total in total.
 */
export function computeProgramCosts(input: {
  policy: CostPolicyParams;
  rooms: RoomCost[];
  sessions: HeldSession[];
  hourlyRateCents: Record<string, number>;
  programs: ProgramInput[];
}): ProgramReport {
  const roomById = new Map(input.rooms.map((r) => [r.roomId, r]));
  // A room's cost is shared by the sessions that used it. When they account for all of its held minutes the split is exact
  // (largest remainder), so nothing is gained or lost to rounding; otherwise each takes its proportional share.
  const byRoom = new Map<string, HeldSession[]>();
  for (const s of input.sessions) byRoom.set(s.roomId, [...(byRoom.get(s.roomId) ?? []), s]);
  const facilityOf = new Map<HeldSession, number>();
  for (const [roomId, list] of byRoom) {
    const room = roomById.get(roomId);
    if (!room || room.heldMinutes <= 0) continue;
    const used = list.reduce((n, s) => n + s.minutes, 0);
    const exact = used === room.heldMinutes ? allocateByWeights(room.totalCents, list.map((s) => s.minutes)) : null;
    list.forEach((s, i) => facilityOf.set(s, exact ? (exact[i] as number) : Math.round((room.totalCents * s.minutes) / room.heldMinutes)));
  }
  const acc = new Map<string, { minutes: number; facility: number; instructor: number }>();
  let absorbed = 0;
  for (const s of input.sessions) {
    const facility = facilityOf.get(s) ?? 0;
    const pay = instructorPayCents(s.minutes, input.hourlyRateCents[s.instructorId] ?? 0);
    absorbed += facility;
    const cur = acc.get(s.programId) ?? { minutes: 0, facility: 0, instructor: 0 };
    acc.set(s.programId, { minutes: cur.minutes + s.minutes, facility: cur.facility + facility, instructor: cur.instructor + pay });
  }
  const warnings: Warning[] = input.policy.revenue.basis === 'CASH' ? [{ code: 'REVENUE_BASIS_NOT_IFRS15' }] : [];
  const programs: ProgramCost[] = input.programs.map((p) => {
    const c = acc.get(p.id) ?? { minutes: 0, facility: 0, instructor: 0 };
    let revenue = p.collectedCents;
    if (input.policy.revenue.basis === 'OVER_TIME') {
      if (p.totalMinutes <= 0) {
        warnings.push({ code: 'NO_PROGRAM_HOURS', detail: p.id });
        revenue = 0;
      } else {
        const done = (m: number) => Math.min(m, p.totalMinutes);
        revenue = Math.round((p.invoicedCents * (done(p.deliveredUntilMinutes) - done(p.deliveredBeforeMinutes))) / p.totalMinutes);
      }
    }
    const total = c.facility + c.instructor;
    return {
      programId: p.id,
      name: p.name,
      heldMinutes: c.minutes,
      facilityCents: c.facility,
      instructorCents: c.instructor,
      totalCostCents: total,
      revenueCents: revenue,
      profitCents: revenue - total,
      costPerStudentCents: p.activeStudents > 0 ? Math.round(total / p.activeStudents) : null,
      activeStudents: p.activeStudents,
    };
  });
  const roomsTotal = input.rooms.reduce((n, r) => n + r.totalCents, 0);
  return { programs, idleCostCents: roomsTotal - absorbed, warnings };
}
