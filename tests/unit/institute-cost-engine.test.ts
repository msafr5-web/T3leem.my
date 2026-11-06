/** Reference values below are worked out by hand (not copied from the engine's own output). */
import {
  DEFAULT_POLICY,
  allocateByWeights,
  allocateElectricity,
  computeProgramCosts,
  computeRoomCosts,
  monthlyDepreciation,
  type CostPolicyParams,
  type CostRoom,
  type DepAsset,
} from '../../src/modules/institute/cost/cost.engine';
import { estimateBill, tariffOn, type BillEstimate } from '../../src/modules/institute/cost/tariff';

describe('exact allocation', () => {
  it('never loses or invents a halala, gives the odd one to the largest remainder', () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]); // tie -> lowest index
    expect(allocateByWeights(100, [1, 1, 1])!.reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateByWeights(900000, [8000, 6000])).toEqual([514286, 385714]); // 5142.86 + 3857.14 = 9000.00
    expect(allocateByWeights(10, [0, 5, 0])).toEqual([0, 10, 0]);
    expect(allocateByWeights(10, [0, 0])).toBeNull();
    expect(allocateByWeights(0, [3, 4])).toEqual([0, 0]);
    // huge weights x totals stay exact (they overflow floating point)
    const big = allocateByWeights(999_999_999_999, [9_999_999_999, 9_999_999_999, 9_999_999_999]) as number[];
    expect(big.reduce((a, b) => a + b, 0)).toBe(999_999_999_999);
  });
});

describe('SEC tariff', () => {
  it('finds the tariff in force on a date, and none where none is on record', () => {
    expect(tariffOn('COMMERCIAL', '2026-12-31')?.id).toBe('SE-2018-COMMERCIAL');
    expect(tariffOn('COMMERCIAL', '2027-01-01')?.id).toBe('SE-2027-COMMERCIAL');
    expect(tariffOn('COMMERCIAL', '2017-12-31')).toBeNull();
    expect(tariffOn('GOVERNMENT', '2026-06-01')).toBeNull(); // the pre-2027 government rate is not on record
    expect(tariffOn('GOVERNMENT', '2027-06-01')?.tiers).toEqual([{ upToKwh: null, halalasPerKwh: 35 }]);
  });

  it('prices a 2027 commercial bill: tiers at 25 / 35 halalas, fixed charge by breaker prorated by days/30, then VAT', () => {
    // 6000 kWh x 0.25 = 1500.00 ; 4000 kWh x 0.35 = 1400.00 ; energy 2900.00
    // fixed: 500 SAR (100-199 A) x 31/30 = 516.67 ; VAT 15% of (2900.00 + 516.67) = 512.50 ; total 3929.17
    const e = estimateBill({ category: 'COMMERCIAL', periodStart: '2027-01-01', periodEnd: '2027-01-31', kwh: 10000, breakerAmps: 150, vatRatePercent: 15 }) as BillEstimate;
    expect(e.tiers).toEqual([{ kwh: 6000, halalasPerKwh: 25, cents: 150000 }, { kwh: 4000, halalasPerKwh: 35, cents: 140000 }]);
    expect([e.energyCents, e.fixedCents, e.vatCents, e.totalCents]).toEqual([290000, 51667, 51250, 392917]);
    expect(e.warnings).toEqual([]);
  });

  it('uses only the first tier up to 6000 kWh, the boundary kWh included', () => {
    const at = (kwh: number) => estimateBill({ category: 'COMMERCIAL', periodStart: '2027-03-01', periodEnd: '2027-03-30', kwh, breakerAmps: 20, vatRatePercent: 15 }) as BillEstimate;
    expect(at(6000).energyCents).toBe(150000);
    expect(at(6000).tiers).toHaveLength(1);
    expect(at(6001).energyCents).toBe(150035); // 6000 x 0.25 + 1 x 0.35
    expect(at(0).energyCents).toBe(0);
    expect(at(0).fixedCents).toBe(35000); // the fixed charge is owed even with no consumption (30 days = full month)
  });

  it('prices a 2026 commercial bill at 22 / 32 halalas and says the fixed charge of that period is not on record', () => {
    // 6000 x 0.22 = 1320.00 ; 4000 x 0.32 = 1280.00 ; energy 2600.00 ; VAT 390.00 ; 2990.00
    const e = estimateBill({ category: 'COMMERCIAL', periodStart: '2026-10-01', periodEnd: '2026-10-31', kwh: 10000, breakerAmps: 150, vatRatePercent: 15 }) as BillEstimate;
    expect([e.energyCents, e.fixedCents, e.vatCents, e.totalCents]).toEqual([260000, null, 39000, 299000]);
    expect(e.warnings).toEqual(['FIXED_CHARGE_NOT_ON_RECORD']);
  });

  it('refuses to guess: no tariff, a period that crosses the change date, bad input; flags unknown breaker', () => {
    const base = { category: 'COMMERCIAL' as const, kwh: 100, breakerAmps: 100, vatRatePercent: 15 };
    expect(estimateBill({ ...base, periodStart: '2026-12-15', periodEnd: '2027-01-14' })).toEqual({ failure: 'PERIOD_STRADDLES_TARIFF_CHANGE' });
    expect(estimateBill({ ...base, category: 'GOVERNMENT', periodStart: '2026-06-01', periodEnd: '2026-06-30' })).toEqual({ failure: 'NO_TARIFF_ON_RECORD' });
    expect(estimateBill({ ...base, periodStart: '2027-02-10', periodEnd: '2027-02-01' })).toEqual({ failure: 'INVALID_PERIOD' });
    expect(estimateBill({ ...base, kwh: -1, periodStart: '2027-02-01', periodEnd: '2027-02-28' })).toEqual({ failure: 'INVALID_PERIOD' });
    expect((estimateBill({ ...base, breakerAmps: null, periodStart: '2027-02-01', periodEnd: '2027-02-28' }) as BillEstimate).warnings).toEqual(['BREAKER_SIZE_UNKNOWN']);
    expect((estimateBill({ ...base, breakerAmps: 10, periodStart: '2027-02-01', periodEnd: '2027-02-28' }) as BillEstimate).warnings).toEqual(['BREAKER_BELOW_MINIMUM']);
  });

  it('breaker bands: 20-99 / 100-199 / 200-299 / 300+', () => {
    const fixed = (amps: number) => (estimateBill({ category: 'COMMERCIAL', periodStart: '2027-04-01', periodEnd: '2027-04-30', kwh: 0, breakerAmps: amps, vatRatePercent: 0 }) as BillEstimate).fixedCents;
    expect([20, 99, 100, 199, 200, 299, 300, 1000].map(fixed)).toEqual([35000, 35000, 50000, 50000, 70000, 70000, 90000, 90000]);
    expect(estimateBill({ category: 'CHARITY', periodStart: '2027-04-01', periodEnd: '2027-04-30', kwh: 7000, breakerAmps: 50, vatRatePercent: 15 })).toMatchObject({ energyCents: 6000 * 17 + 1000 * 21, fixedCents: 14000 });
  });
});

describe('depreciation, straight-line (IAS 16)', () => {
  const asset = (over: Partial<DepAsset> = {}): DepAsset => ({ id: 'a', roomId: 'r1', status: 'IN_SERVICE', purchaseDate: '2026-01-15', retiredOn: null, costCents: 1_200_000, residualBp: 1000, usefulLifeMonths: 36, ...over });
  const pol = { start: 'PURCHASE_MONTH' as const, defaultLifeMonths: 60 };
  const total = (a: DepAsset, p = pol) => Array.from({ length: 80 }, (_, i) => `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`).reduce((n, m) => n + monthlyDepreciation(a, m, p), 0);

  it('12,000.00 with 10% residual over 36 months is 300.00 a month, and adds up to exactly 10,800.00', () => {
    expect(monthlyDepreciation(asset(), '2026-01-01', pol)).toBe(30000);
    expect(monthlyDepreciation(asset(), '2028-12-01', pol)).toBe(30000); // 36th month
    expect(monthlyDepreciation(asset(), '2029-01-01', pol)).toBe(0); // life over
    expect(monthlyDepreciation(asset(), '2025-12-01', pol)).toBe(0); // before purchase
    expect(total(asset())).toBe(1_080_000);
  });

  it('spreads an amount that does not divide evenly without losing a halala', () => {
    const a = asset({ costCents: 100_000, residualBp: 0, usefulLifeMonths: 3 });
    expect([1, 2, 3, 4].map((m) => monthlyDepreciation(a, `2026-0${m}-01`, pol))).toEqual([33333, 33334, 33333, 0]);
    expect(total(a)).toBe(100_000);
  });

  it('can start the month after purchase, uses the default life, and honours the residual', () => {
    const next = { start: 'NEXT_MONTH' as const, defaultLifeMonths: 60 };
    expect(monthlyDepreciation(asset(), '2026-01-01', next)).toBe(0);
    expect(monthlyDepreciation(asset(), '2026-02-01', next)).toBe(30000);
    const noLife = asset({ usefulLifeMonths: null, costCents: 600_000, residualBp: 0 });
    expect(monthlyDepreciation(noLife, '2026-06-01', pol)).toBe(10000); // 6,000.00 / 60
    expect(total(noLife)).toBe(600_000);
    expect(monthlyDepreciation(asset({ residualBp: 10_000 }), '2026-03-01', pol)).toBe(0); // fully residual: nothing to depreciate
  });

  it('stops after the month an asset is retired; unknown purchase date or retirement date means no charge', () => {
    const gone = asset({ status: 'RETIRED', retiredOn: '2026-06-20' });
    expect(monthlyDepreciation(gone, '2026-06-01', pol)).toBe(30000);
    expect(monthlyDepreciation(gone, '2026-07-01', pol)).toBe(0);
    expect(monthlyDepreciation(asset({ status: 'RETIRED', retiredOn: null }), '2026-06-01', pol)).toBe(0);
    expect(monthlyDepreciation(asset({ purchaseDate: null }), '2026-06-01', pol)).toBe(0);
    expect(monthlyDepreciation(asset({ costCents: 0 }), '2026-06-01', pol)).toBe(0);
    expect(monthlyDepreciation(asset({ status: 'MAINTENANCE' }), '2026-06-01', pol)).toBe(30000); // in the workshop is still owned and ageing
  });
});

describe('electricity allocation', () => {
  const rooms: CostRoom[] = [
    { id: 'R1', name: 'معمل', areaX100: 8000, kwX100: 1200 },
    { id: 'R2', name: 'قاعة', areaX100: 6000, kwX100: 500 },
  ];
  const held = { R1: 132 * 60, R2: 132 * 60 };
  const base = { costCents: 900_000, billKwhX100: null, rooms, heldMinutes: held, readingsKwhX100: {} };

  it('by area: 80 / 140 and 60 / 140 of 9,000.00', () => {
    expect(allocateElectricity({ ...base, method: 'AREA' }).byRoom).toEqual({ R1: 514286, R2: 385714 });
  });
  it('by power x hours: the lab bears 70.59%', () => {
    // 12 kW x 132 h = 1584 ; 5 kW x 132 h = 660 ; shares 1584/2244 and 660/2244
    const r = allocateElectricity({ ...base, method: 'POWER_HOURS' });
    expect(r.byRoom).toEqual({ R1: 635294, R2: 264706 });
    expect(r.methodUsed).toBe('POWER_HOURS');
  });
  it('power x hours: a room that taught nothing bears nothing; if nobody taught it falls back to area and says so', () => {
    expect(allocateElectricity({ ...base, method: 'POWER_HOURS', heldMinutes: { R1: 600, R2: 0 } }).byRoom).toEqual({ R1: 900000, R2: 0 });
    const none = allocateElectricity({ ...base, method: 'POWER_HOURS', heldMinutes: {} });
    expect(none.methodUsed).toBe('AREA');
    expect(none.warnings).toEqual([{ code: 'NO_USAGE_FALLBACK_AREA' }]);
    expect(allocateElectricity({ ...base, method: 'POWER_HOURS', rooms: [{ ...(rooms[0] as CostRoom), kwX100: 0 }, rooms[1] as CostRoom] }).warnings).toEqual([{ code: 'ROOM_POWER_MISSING', detail: 'R1' }]);
  });
  it('by meter: metered kWh share of the bill, the rest (common areas) by area', () => {
    // bill 10,000 kWh; R1 sub-meter 6,000 kWh, R2 none. Metered cost = 9,000.00 x 6000/10000 = 5,400.00 to R1.
    // Unmetered 3,600.00 is shared by area 80:60 -> 2,057.14 / 1,542.86
    const r = allocateElectricity({ ...base, method: 'METER', billKwhX100: 1_000_000, readingsKwhX100: { R1: 600_000 } });
    expect(r.methodUsed).toBe('METER');
    expect(r.byRoom).toEqual({ R1: 540000 + 205714, R2: 154286 });
    expect(r.byRoom.R1! + r.byRoom.R2!).toBe(900_000);
  });
  it('by meter: readings that exceed the bill are used as proportions; no readings or no bill kWh fall back', () => {
    const over = allocateElectricity({ ...base, method: 'METER', billKwhX100: 1_000_000, readingsKwhX100: { R1: 900_000, R2: 300_000 } });
    expect(over.byRoom).toEqual({ R1: 675000, R2: 225000 });
    expect(over.warnings).toEqual([{ code: 'READINGS_EXCEED_BILL_KWH' }]);
    expect(allocateElectricity({ ...base, method: 'METER', billKwhX100: null, readingsKwhX100: { R1: 1 } }).warnings).toEqual([{ code: 'NO_BILL_KWH_FALLBACK_POWER_HOURS' }]);
    expect(allocateElectricity({ ...base, method: 'METER', billKwhX100: 1_000_000, readingsKwhX100: {} }).methodUsed).toBe('POWER_HOURS');
  });
  it('no rooms: nothing to allocate, reported', () => {
    expect(allocateElectricity({ ...base, method: 'AREA', rooms: [] })).toEqual({ methodUsed: 'AREA', byRoom: {}, warnings: [{ code: 'NO_ROOMS' }] });
  });
});

describe('room costs', () => {
  const rooms: CostRoom[] = [
    { id: 'R1', name: 'معمل', areaX100: 8000, kwX100: 1200 },
    { id: 'R2', name: 'قاعة', areaX100: 6000, kwX100: 500 },
  ];
  // Not registered for VAT: the whole bill is a cost (the figures below are then the bill as paid)
  const policy: CostPolicyParams = { ...DEFAULT_POLICY, electricity: { ...DEFAULT_POLICY.electricity, allocation: 'POWER_HOURS', vatRegistered: false, vatRecoveryPercent: 0 } };
  const computer: DepAsset = { id: 'pc', roomId: 'R1', status: 'IN_SERVICE', purchaseDate: '2026-01-10', retiredOn: null, costCents: 1_200_000, residualBp: 1000, usefulLifeMonths: 36 };
  const input = {
    month: '2026-09-01',
    policy,
    rooms,
    heldMinutes: { R1: 132 * 60, R2: 132 * 60 },
    readingsKwhX100: {},
    bill: { amountCents: 900_000, vatCents: null, kwhX100: null },
    assets: [computer],
    expenses: [{ roomId: 'R1', amountCents: 150_000 }, { roomId: null, amountCents: 140_000 }],
  };

  it('adds electricity, depreciation, direct expenses and a share of overhead per room, summing exactly to the pooled cost', () => {
    const r = computeRoomCosts(input);
    const [r1, r2] = r.rooms as [(typeof r.rooms)[number], (typeof r.rooms)[number]];
    // overhead 1,400.00 by area 80:60 -> 800.00 / 600.00
    expect([r1.electricityCents, r1.depreciationCents, r1.directExpenseCents, r1.overheadCents]).toEqual([635294, 30000, 150000, 80000]);
    expect(r1.totalCents).toBe(895294);
    expect([r2.electricityCents, r2.depreciationCents, r2.directExpenseCents, r2.overheadCents, r2.totalCents]).toEqual([264706, 0, 0, 60000, 324706]);
    expect(r.totalCents).toBe(900_000 + 30_000 + 150_000 + 140_000); // bill + depreciation + both expenses, nothing lost
    expect(r1.costPerHourCents).toBe(Math.round((895294 * 60) / 7920)); // 67.83 per hour
    expect(r1.occupancyPercent).toBe(75); // 132 / 176 hours
  });

  it('takes input VAT out of the electricity cost as far as it is deductible: stated VAT, or estimated from the rate and flagged', () => {
    const registered = (percent: number) => ({ ...policy, electricity: { ...policy.electricity, vatRegistered: true, vatRecoveryPercent: percent } });
    // fully taxable: 9,000.00 less the 1,173.91 VAT stated on the bill
    const stated = computeRoomCosts({ ...input, policy: registered(100), bill: { amountCents: 900_000, vatCents: 117_391, kwhX100: null } });
    expect(stated.electricity.costCents).toBe(782_609);
    expect(stated.warnings.some((w) => w.code === 'BILL_NET_OF_VAT_ESTIMATED')).toBe(false);
    // VAT not stated: 9,000.00 x 15 / 115 = 1,173.91 estimated, and flagged
    const estimated = computeRoomCosts({ ...input, policy: registered(100) });
    expect(estimated.electricity.costCents).toBe(782_609);
    expect(estimated.warnings).toContainEqual({ code: 'BILL_NET_OF_VAT_ESTIMATED' });
    // mixed activity: only the taxable share is deducted (50% of 1,173.91 = 586.96 rounded), the rest stays a cost
    expect(computeRoomCosts({ ...input, policy: registered(50), bill: { amountCents: 900_000, vatCents: 117_391, kwhX100: null } }).electricity.costCents).toBe(900_000 - 58_696);
    // a share of 66.67% (the ZATCA guideline's own example) of 5,000 would be 3,333.50 -> checked on the bill amount here
    expect(computeRoomCosts({ ...input, policy: registered(66.67), bill: { amountCents: 1_150_000, vatCents: 150_000, kwhX100: null } }).electricity.costCents).toBe(1_150_000 - 100_005);
  });

  it('an institute not registered for VAT cannot deduct anything, whatever the percentage says; and says nothing about estimating', () => {
    const unreg = { ...policy, electricity: { ...policy.electricity, vatRegistered: false, vatRecoveryPercent: 100 } };
    const r = computeRoomCosts({ ...input, policy: unreg, bill: { amountCents: 900_000, vatCents: 117_391, kwhX100: null } });
    expect(r.electricity.costCents).toBe(900_000);
    expect(computeRoomCosts({ ...input, policy: unreg }).warnings.some((w) => w.code === 'BILL_NET_OF_VAT_ESTIMATED')).toBe(false);
  });

  it('defaults follow the official positions: metered use, VAT deductible in full when registered, revenue over time', () => {
    expect(DEFAULT_POLICY.electricity).toMatchObject({ allocation: 'METER', vatRegistered: true, vatRecoveryPercent: 100, tariffCategory: 'COMMERCIAL', vatRatePercent: 15 });
    expect(DEFAULT_POLICY.revenue.basis).toBe('OVER_TIME');
  });

  it('reports what it cannot cost instead of guessing: no bill, assets without date / cost, retired without a date', () => {
    const r = computeRoomCosts({
      ...input,
      bill: null,
      assets: [{ ...computer, id: 'nodate', purchaseDate: null }, { ...computer, id: 'nocost', costCents: 0 }, { ...computer, id: 'gone', status: 'RETIRED' }],
    });
    expect(r.warnings).toEqual(expect.arrayContaining([{ code: 'NO_BILL' }, { code: 'ASSET_NO_PURCHASE_DATE', detail: 'nodate' }, { code: 'ASSET_NO_COST', detail: 'nocost' }, { code: 'ASSET_RETIRED_WITHOUT_DATE', detail: 'gone' }]));
    expect(r.rooms.every((x) => x.electricityCents === 0 && x.depreciationCents === 0)).toBe(true);
  });

  it('spreads overhead by hours when the policy asks for it, and a room that taught nothing has no hourly cost', () => {
    const byHours = computeRoomCosts({ ...input, policy: { ...policy, overhead: { basis: 'HOURS' } }, heldMinutes: { R1: 600, R2: 0 } });
    expect(byHours.rooms.map((x) => x.overheadCents)).toEqual([140_000, 0]);
    expect(byHours.rooms[1]!.costPerHourCents).toBeNull();
    expect(byHours.rooms[1]!.occupancyPercent).toBe(0);
    // an asset in a room that does not exist (or no room) is overhead, not lost
    const loose = computeRoomCosts({ ...input, assets: [{ ...computer, roomId: null }], expenses: [] });
    expect(loose.overheadCents).toBe(30_000);
    expect(loose.rooms.reduce((n, x) => n + x.overheadCents, 0)).toBe(30_000);
  });
});

describe('program costing and profit', () => {
  const policy: CostPolicyParams = { ...DEFAULT_POLICY, revenue: { basis: 'CASH' } }; // cash figures below; over-time cases set their own basis
  const rooms = [{ roomId: 'R1', name: 'x', electricityCents: 0, depreciationCents: 0, directExpenseCents: 0, overheadCents: 0, totalCents: 100_000, heldMinutes: 600, costPerHourCents: 10_000, occupancyPercent: 0 }];
  const program = (over: object = {}) => ({ id: 'P1', name: 'دبلوم', activeStudents: 4, totalMinutes: 6000, invoicedCents: 1_200_000, collectedCents: 300_000, deliveredBeforeMinutes: 0, deliveredUntilMinutes: 0, ...over });

  it('charges each session its room minutes plus the instructor pay, and the rest of the room is idle capacity', () => {
    // room 1,000.00 over 600 min: a 120-min session bears 200.00; instructor 150.00/h x 2 h = 300.00
    const r = computeProgramCosts({
      policy,
      rooms,
      sessions: [{ roomId: 'R1', instructorId: 'I1', programId: 'P1', minutes: 120 }, { roomId: 'R1', instructorId: 'I1', programId: 'P2', minutes: 60 }],
      hourlyRateCents: { I1: 15_000 },
      programs: [program(), program({ id: 'P2', name: 'آخر', activeStudents: 0 })],
    });
    expect(r.programs[0]).toMatchObject({ facilityCents: 20_000, instructorCents: 30_000, totalCostCents: 50_000, costPerStudentCents: 12_500, revenueCents: 300_000, profitCents: 250_000, heldMinutes: 120 });
    expect(r.programs[1]).toMatchObject({ facilityCents: 10_000, instructorCents: 15_000, costPerStudentCents: null });
    expect(r.idleCostCents).toBe(100_000 - 30_000); // 70% of the room's minutes were not used
  });

  it('a cash basis works but is flagged as a management view, not IFRS 15', () => {
    const cash = computeProgramCosts({ policy, rooms, sessions: [], hourlyRateCents: {}, programs: [program()] });
    expect(cash.warnings).toEqual([{ code: 'REVENUE_BASIS_NOT_IFRS15' }]);
    expect(cash.programs[0]!.revenueCents).toBe(300_000);
  });

  it('over time: invoiced total x the share of the program hours delivered in the month, never beyond the total', () => {
    const p = { ...policy, revenue: { basis: 'OVER_TIME' as const } };
    const run = (over: object) => computeProgramCosts({ policy: p, rooms, sessions: [], hourlyRateCents: {}, programs: [program(over)] }).programs[0]!.revenueCents;
    expect(run({ deliveredBeforeMinutes: 1200, deliveredUntilMinutes: 1800 })).toBe(120_000); // 600 of 6000 min = 10% of 12,000.00
    expect(run({ deliveredBeforeMinutes: 5700, deliveredUntilMinutes: 6600 })).toBe(60_000); // only the last 300 min count
    expect(run({ deliveredBeforeMinutes: 6300, deliveredUntilMinutes: 7000 })).toBe(0); // already fully recognised
    expect(run({})).toBe(0);
    const none = computeProgramCosts({ policy: p, rooms, sessions: [], hourlyRateCents: {}, programs: [program({ totalMinutes: 0 })] });
    expect(none.warnings).toEqual([{ code: 'NO_PROGRAM_HOURS', detail: 'P1' }]);
  });
});
