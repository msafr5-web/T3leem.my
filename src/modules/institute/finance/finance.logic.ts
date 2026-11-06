/**
 * Money rules of the institute, as pure functions (no I/O) so every figure is exactly testable.
 * All arithmetic is in integer halalas (cents); decimals only appear at the edges as "123.45" strings.
 */

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

/** "123.4" -> 12340. Rejects anything that is not a plain amount with at most two decimals. */
export function toCents(amount: string): number {
  if (!AMOUNT.test(amount)) throw new RangeError(`Invalid amount: ${amount}`);
  const [whole, frac = ''] = amount.split('.') as [string, string?];
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

/** 12340 -> "123.40" */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** First day (YYYY-MM-01) of the month a date (YYYY-MM-DD) falls in. */
export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

/** First day of the month after `monthStartDate` (YYYY-MM-01). */
export function nextMonthStart(monthStartDate: string): string {
  const [y, m] = monthStartDate.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Adds whole months to a YYYY-MM-DD date, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Splits a net amount into `count` monthly instalments; the odd halalas go to the last one so the sum is exact. */
export function evenInstallments(netCents: number, count: number, firstDue: string): { dueOn: string; cents: number }[] {
  const base = Math.floor(netCents / count);
  return Array.from({ length: count }, (_, i) => ({ dueOn: addMonths(firstDue, i), cents: i === count - 1 ? netCents - base * (count - 1) : base }));
}

export type InstallmentState = 'PAID' | 'PARTIAL' | 'OVERDUE' | 'UPCOMING';
export interface InstallmentView {
  dueOn: string;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  state: InstallmentState;
}

/**
 * Payments settle the oldest instalment first. An instalment with something still owed and a due date before
 * `today` is OVERDUE (even if partly paid); the due day itself is not yet overdue.
 */
export function allocateInstallments(installments: { dueOn: string; amountCents: number }[], paidCents: number, today: string): InstallmentView[] {
  let left = Math.max(0, paidCents);
  return [...installments]
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0))
    .map((i) => {
      const paid = Math.min(left, i.amountCents);
      left -= paid;
      const remaining = i.amountCents - paid;
      const state: InstallmentState = remaining === 0 ? 'PAID' : i.dueOn < today ? 'OVERDUE' : paid > 0 ? 'PARTIAL' : 'UPCOMING';
      return { dueOn: i.dueOn, amountCents: i.amountCents, paidCents: paid, remainingCents: remaining, state };
    });
}

export type BudgetLevel = 'OK' | 'WARNING' | 'EXCEEDED';
export interface BudgetStatus {
  spentCents: number;
  remainingCents: number;
  /** Whole percent of the budget used (rounded down); null when the budget is zero. */
  percent: number | null;
  level: BudgetLevel;
}

/** WARNING from the configured threshold (default 80%), EXCEEDED once spending passes the budget. Zero budget with spending = EXCEEDED. */
export function budgetStatus(budgetCents: number, spentCents: number, warnPercent: number): BudgetStatus {
  const percent = budgetCents === 0 ? null : Math.floor((spentCents * 100) / budgetCents);
  const level: BudgetLevel = spentCents > budgetCents ? 'EXCEEDED' : percent !== null && spentCents * 100 >= warnPercent * budgetCents ? 'WARNING' : 'OK';
  return { spentCents, remainingCents: budgetCents - spentCents, percent, level };
}

/** Pay for taught time: whole minutes at an hourly rate, rounded to the nearest halala. */
export const instructorPayCents = (minutes: number, hourlyRateCents: number): number => Math.round((minutes * hourlyRateCents) / 60);

export type VatTreatment = 'NONE' | 'STANDARD' | 'STATE_BORNE';

/**
 * Which VAT an invoice carries, decided once at issue time and then frozen on the invoice.
 *  - Institute not registered for VAT: none (it cannot charge VAT).
 *  - A Saudi citizen in a programme whose fees qualify for the State bearing the VAT (private education, Royal Order A/86): the
 *    citizen is charged no VAT and the invoice must name the beneficiary's national ID (STATE_BORNE).
 *  - Everyone else (expatriates, citizens in a non-qualifying programme, no programme): standard rate.
 */
export function decideVat(input: { registered: boolean; citizenship: 'SAUDI' | 'OTHER'; programStateBorne: boolean; standardRatePercent: number }): { treatment: VatTreatment; rateBp: number } {
  if (!input.registered) return { treatment: 'NONE', rateBp: 0 };
  if (input.citizenship === 'SAUDI' && input.programStateBorne) return { treatment: 'STATE_BORNE', rateBp: 0 };
  return { treatment: 'STANDARD', rateBp: Math.round(input.standardRatePercent * 100) };
}

/** VAT on a net amount (after discount) at `rateBp` basis points, rounded to the halala. */
export const vatOn = (netCents: number, rateBp: number): number => Math.round((netCents * rateBp) / 10_000);
