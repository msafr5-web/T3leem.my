import {
  addMonths,
  allocateInstallments,
  budgetStatus,
  decideVat,
  evenInstallments,
  fromCents,
  instructorPayCents,
  monthStart,
  nextMonthStart,
  toCents,
  vatOn,
} from '../../src/modules/institute/finance/finance.logic';

describe('money conversion', () => {
  it('round-trips amounts without floating point drift', () => {
    expect(toCents('0.1') + toCents('0.2')).toBe(30); // 0.1 + 0.2 in floats is 0.30000000000000004
    expect(toCents('1234.5')).toBe(123450);
    expect(toCents('7')).toBe(700);
    expect(fromCents(123450)).toBe('1234.50');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(-250)).toBe('-2.50');
    for (const bad of ['', '-1', '1.234', '1,5', 'abc', '12345678901', ' 5']) expect(() => toCents(bad)).toThrow(RangeError);
  });
});

describe('dates', () => {
  it('month helpers', () => {
    expect(monthStart('2026-11-17')).toBe('2026-11-01');
    expect(nextMonthStart('2026-11-01')).toBe('2026-12-01');
    expect(nextMonthStart('2026-12-01')).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-12-10', 14)).toBe('2028-02-10');
  });
});

describe('instalments', () => {
  it('splits evenly and puts the odd halalas on the last instalment, summing exactly', () => {
    const parts = evenInstallments(toCents('1000.00'), 3, '2026-11-30');
    expect(parts.map((p) => fromCents(p.cents))).toEqual(['333.33', '333.33', '333.34']);
    expect(parts.map((p) => p.dueOn)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30']);
    expect(parts.reduce((n, p) => n + p.cents, 0)).toBe(100000);
    expect(evenInstallments(100, 1, '2026-01-01')).toEqual([{ dueOn: '2026-01-01', cents: 100 }]);
  });

  it('settles the oldest first and flags overdue; the due day itself is not overdue', () => {
    const inst = [
      { dueOn: '2026-12-01', amountCents: 40000 },
      { dueOn: '2026-11-01', amountCents: 40000 },
      { dueOn: '2027-01-01', amountCents: 40000 },
    ];
    const v = allocateInstallments(inst, 50000, '2026-11-20');
    expect(v.map((x) => [x.dueOn, x.paidCents, x.state])).toEqual([
      ['2026-11-01', 40000, 'PAID'],
      ['2026-12-01', 10000, 'PARTIAL'],
      ['2027-01-01', 0, 'UPCOMING'],
    ]);
    expect(allocateInstallments(inst, 0, '2026-11-20').map((x) => x.state)).toEqual(['OVERDUE', 'UPCOMING', 'UPCOMING']);
    expect(allocateInstallments(inst, 0, '2026-11-01')[0]?.state).toBe('UPCOMING'); // due today
    expect(allocateInstallments(inst, 0, '2026-11-02')[0]?.state).toBe('OVERDUE');
    // a part-payment on a past-due instalment is still overdue for the rest
    expect(allocateInstallments(inst, 10000, '2026-11-20')[0]).toMatchObject({ paidCents: 10000, remainingCents: 30000, state: 'OVERDUE' });
    expect(allocateInstallments(inst, 120000, '2026-11-20').every((x) => x.state === 'PAID')).toBe(true);
    expect(allocateInstallments([], 500, '2026-11-20')).toEqual([]);
  });
});

describe('budget status', () => {
  it('is OK below the threshold, WARNING from it, EXCEEDED above the budget', () => {
    const b = 100000; // 1000.00
    expect(budgetStatus(b, 79999, 80)).toMatchObject({ level: 'OK', percent: 79 });
    expect(budgetStatus(b, 80000, 80)).toMatchObject({ level: 'WARNING', percent: 80 });
    expect(budgetStatus(b, 100000, 80)).toMatchObject({ level: 'WARNING', percent: 100, remainingCents: 0 }); // exactly on budget is not over it
    expect(budgetStatus(b, 100001, 80)).toMatchObject({ level: 'EXCEEDED', remainingCents: -1 });
    expect(budgetStatus(b, 50000, 50)).toMatchObject({ level: 'WARNING' });
    expect(budgetStatus(0, 0, 80)).toMatchObject({ level: 'OK', percent: null });
    expect(budgetStatus(0, 1, 80)).toMatchObject({ level: 'EXCEEDED', percent: null });
  });
});

describe('instructor pay', () => {
  it('pays whole minutes at the hourly rate, rounded to the nearest halala', () => {
    expect(instructorPayCents(120, toCents('150.00'))).toBe(30000);
    expect(instructorPayCents(90, toCents('150.00'))).toBe(22500);
    expect(instructorPayCents(1, toCents('100.00'))).toBe(167); // 1.6667 -> 1.67
    expect(instructorPayCents(0, toCents('150.00'))).toBe(0);
  });
});

describe('VAT on an invoice', () => {
  const decide = (over: object = {}) => decideVat({ registered: true, citizenship: 'OTHER', programStateBorne: true, standardRatePercent: 15, ...over });
  it('is decided from registration, citizenship and the programme, and the State-borne case needs both a citizen and a qualifying programme', () => {
    expect(decide({ registered: false })).toEqual({ treatment: 'NONE', rateBp: 0 });
    expect(decide({ registered: false, citizenship: 'SAUDI' })).toEqual({ treatment: 'NONE', rateBp: 0 });
    expect(decide()).toEqual({ treatment: 'STANDARD', rateBp: 1500 }); // expatriate
    expect(decide({ citizenship: 'SAUDI' })).toEqual({ treatment: 'STATE_BORNE', rateBp: 0 });
    expect(decide({ citizenship: 'SAUDI', programStateBorne: false })).toEqual({ treatment: 'STANDARD', rateBp: 1500 });
    expect(decide({ standardRatePercent: 5 })).toEqual({ treatment: 'STANDARD', rateBp: 500 });
  });
  it('rounds the VAT to the halala on the net after discount', () => {
    expect(vatOn(90000, 1500)).toBe(13500); // 900.00 -> 135.00
    expect(vatOn(10001, 1500)).toBe(1500); // 100.01 -> 15.0015 -> 15.00
    expect(vatOn(10003, 1500)).toBe(1500); // 15.0045 -> 15.00
    expect(vatOn(10004, 1500)).toBe(1501); // 15.006 -> 15.01
    expect(vatOn(12345, 0)).toBe(0);
  });
});
