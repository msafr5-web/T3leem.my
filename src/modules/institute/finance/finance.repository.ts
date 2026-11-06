import { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import type { Actor } from '../../provider/provider.types';

/** Money travels as "123.45" strings and dates as "YYYY-MM-DD", never as floats / local-time Dates. */
export interface ExpenseRow {
  id: string;
  branchId: string;
  roomId: string | null;
  category: string;
  amount: string;
  incurredOn: string;
  vendor: string | null;
  description: string | null;
}
export type ExpenseInput = Omit<ExpenseRow, 'id'>;

export interface BillRow {
  id: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  kwh: string | null;
  /** VAT included in `amount` as stated on the bill; null = not stated. */
  vatAmount: string | null;
}
export type BillInput = Omit<BillRow, 'id'>;

export interface BudgetRow {
  id: string;
  branchId: string;
  category: string | null;
  /** First day of the month. */
  period: string;
  amount: string;
  warnPercent: number;
}
export type BudgetInput = Omit<BudgetRow, 'id'>;

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
export interface PaymentRow {
  id: string;
  invoiceId: string;
  branchId: string;
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  voided: boolean;
  voidReason: string | null;
}
export interface InvoiceRow {
  id: string;
  branchId: string;
  studentId: string;
  description: string;
  amount: string;
  discount: string;
  issuedOn: string;
  status: 'OPEN' | 'CANCELLED';
  /** VAT frozen at issue: NONE (not registered), STANDARD (rate in basis points) or STATE_BORNE (citizen, State bears it). */
  vatTreatment: 'NONE' | 'STANDARD' | 'STATE_BORNE';
  vatRateBp: number;
  /** VAT charged to the student, on top of amount - discount. */
  vatAmount: string;
  beneficiaryIdLast4: string | null;
  installments: { id: string; dueOn: string; amount: string }[];
  payments: PaymentRow[];
}
export interface InvoiceInput {
  branchId: string;
  studentId: string;
  description: string;
  amount: string;
  discount: string;
  issuedOn: string;
  vatTreatment: 'NONE' | 'STANDARD' | 'STATE_BORNE';
  vatRateBp: number;
  vatAmount: string;
  /** The student's sealed national ID, copied as a snapshot onto a State-borne invoice. */
  beneficiaryIdEnc: string | null;
  beneficiaryIdLast4: string | null;
  installments: { dueOn: string; amount: string }[];
}
export interface PaymentInput {
  invoiceId: string;
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
}

export type PayoutMethod = 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER';
export interface PayoutRow {
  id: string;
  branchId: string;
  instructorId: string;
  /** First day of the month the pay is for. */
  period: string;
  amount: string;
  duesAmount: string;
  minutes: number;
  hourlyRate: string;
  paidOn: string;
  method: PayoutMethod;
  reference: string | null;
  voided: boolean;
  voidReason: string | null;
}
export interface PayoutInput {
  branchId: string;
  instructorId: string;
  period: string;
  amount: string;
  /** The month's dues (minutes x rate) when paid, and what they were computed from. */
  duesAmount: string;
  minutes: number;
  hourlyRate: string;
  paidOn: string;
  method: PayoutMethod;
  reference: string | null;
}
export interface VatSummaryRow {
  branchId: string;
  treatment: 'NONE' | 'STANDARD' | 'STATE_BORNE';
  invoices: number;
  /** Sum of amount - discount of the invoices issued in the month. */
  netAmount: string;
  vatAmount: string;
}

export interface ClosedPeriodRow {
  id: string;
  branchId: string;
  period: string;
  closedBy: string;
  closedAt: Date;
}

/** `closed` = the month is locked (the database refused); `overpaid` = more than the invoice still owes. */
export type FWrite<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not_found' }
  | { kind: 'duplicate' }
  | { kind: 'closed' }
  | { kind: 'overpaid'; outstanding: string }
  | { kind: 'cancelled' }
  | { kind: 'has_payments' }
  | { kind: 'not_found_instructor' };

export interface FinanceRepository {
  listExpenses(tenantId: string, f: { branchId: string | null; from?: string; to?: string; category?: string }): Promise<ExpenseRow[]>;
  getExpense(tenantId: string, id: string): Promise<ExpenseRow | null>;
  createExpense(tenantId: string, actor: Actor, input: ExpenseInput): Promise<FWrite<ExpenseRow>>;
  deleteExpense(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>>;

  listBills(tenantId: string, branchId: string | null): Promise<BillRow[]>;
  getBill(tenantId: string, id: string): Promise<BillRow | null>;
  createBill(tenantId: string, actor: Actor, input: BillInput): Promise<FWrite<BillRow>>;
  deleteBill(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>>;

  listBudgets(tenantId: string, f: { branchId: string | null; period?: string }): Promise<BudgetRow[]>;
  getBudget(tenantId: string, id: string): Promise<BudgetRow | null>;
  saveBudget(tenantId: string, actor: Actor, input: BudgetInput): Promise<FWrite<BudgetRow>>;
  deleteBudget(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>>;
  /** Spending of a month [from, toExclusive) per branch and category; electricity bills count under 'ELECTRICITY'. */
  spend(tenantId: string, branchId: string | null, from: string, toExclusive: string): Promise<{ branchId: string; category: string; amount: string }[]>;
  /** Active (not voided) student payments received in [from, toExclusive), per branch. */
  income(tenantId: string, branchId: string | null, from: string, toExclusive: string): Promise<{ branchId: string; amount: string }[]>;

  listInvoices(tenantId: string, f: { branchId: string | null; studentId?: string }): Promise<InvoiceRow[]>;
  getInvoice(tenantId: string, id: string): Promise<InvoiceRow | null>;
  createInvoice(tenantId: string, actor: Actor, input: InvoiceInput): Promise<FWrite<InvoiceRow>>;
  cancelInvoice(tenantId: string, actor: Actor, id: string): Promise<FWrite<InvoiceRow>>;
  recordPayment(tenantId: string, actor: Actor, input: PaymentInput): Promise<FWrite<PaymentRow>>;
  voidPayment(tenantId: string, actor: Actor, paymentId: string, reason: string): Promise<FWrite<PaymentRow>>;
  getPayment(tenantId: string, id: string): Promise<PaymentRow | null>;

  /** VAT of the invoices issued in [from, toExclusive), per branch and treatment (cancelled invoices excluded). */
  vatSummary(tenantId: string, branchId: string | null, from: string, toExclusive: string): Promise<VatSummaryRow[]>;

  listPayouts(tenantId: string, f: { branchId: string | null; period: string }): Promise<PayoutRow[]>;
  getPayout(tenantId: string, id: string): Promise<PayoutRow | null>;
  /** Locks the instructor, then refuses a payout beyond the month's dues (`overpaid` carries what is still owed). */
  createPayout(tenantId: string, actor: Actor, input: PayoutInput): Promise<FWrite<PayoutRow>>;
  voidPayout(tenantId: string, actor: Actor, id: string, reason: string): Promise<FWrite<PayoutRow>>;

  listClosed(tenantId: string, branchId: string | null): Promise<ClosedPeriodRow[]>;
  getClosed(tenantId: string, id: string): Promise<ClosedPeriodRow | null>;
  closePeriod(tenantId: string, actor: Actor, branchId: string, period: string): Promise<FWrite<ClosedPeriodRow>>;
  reopenPeriod(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>>;

  /** Minutes taught in held (not cancelled / not future) sessions starting in [from, toExclusive), per instructor. */
  heldMinutes(tenantId: string, branchId: string | null, from: Date, toExclusive: Date): Promise<{ instructorId: string; minutes: number }[]>;
}

const audit = (tx: Prisma.TransactionClient, tenantId: string, actor: Actor, action: string, entityId: string, metadata: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType: 'institute', entityId, metadata, ipAddress: actor.ip } });

const code = (e: unknown): string | null => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null);
const isUnique = (e: unknown) => code(e) === 'P2002';
/** See institute.repository: RESTRICT violations (23001) arrive as unknown request errors. */
const isFk = (e: unknown) => {
  if (code(e) === 'P2003') return true;
  if (e instanceof Prisma.PrismaClientUnknownRequestError) return /23001|23503|violates RESTRICT|foreign key constraint/i.test(e.message);
  return false;
};
/** The database trigger refused a write in a closed month (message carries the marker). */
const isClosed = (e: unknown): boolean => e instanceof Error && e.message.includes('institute_period_closed');

const day = (d: Date): string => d.toISOString().slice(0, 10);
const dayOrNull = (d: Date | null): string | null => (d ? day(d) : null);
const date = (s: string): Date => new Date(`${s}T00:00:00Z`);
const money = (d: Prisma.Decimal): string => d.toFixed(2);

const toExpense = (e: { id: string; branchId: string; roomId: string | null; category: string; amount: Prisma.Decimal; incurredOn: Date; vendor: string | null; description: string | null }): ExpenseRow => ({
  id: e.id, branchId: e.branchId, roomId: e.roomId, category: e.category, amount: money(e.amount), incurredOn: day(e.incurredOn), vendor: e.vendor, description: e.description,
});
const toBill = (b: { id: string; branchId: string; periodStart: Date; periodEnd: Date; amount: Prisma.Decimal; kwh: Prisma.Decimal | null; vatAmount: Prisma.Decimal | null }): BillRow => ({
  id: b.id, branchId: b.branchId, periodStart: day(b.periodStart), periodEnd: day(b.periodEnd), amount: money(b.amount), kwh: b.kwh ? money(b.kwh) : null, vatAmount: b.vatAmount ? money(b.vatAmount) : null,
});
const toBudget = (b: { id: string; branchId: string; category: string | null; period: Date; amount: Prisma.Decimal; warnPercent: number }): BudgetRow => ({
  id: b.id, branchId: b.branchId, category: b.category, period: day(b.period), amount: money(b.amount), warnPercent: b.warnPercent,
});
type PaymentDb = { id: string; invoiceId: string; branchId: string; amount: Prisma.Decimal; paidOn: Date; method: string; reference: string | null; voidedAt: Date | null; voidReason: string | null };
const toPayment = (p: PaymentDb): PaymentRow => ({
  id: p.id, invoiceId: p.invoiceId, branchId: p.branchId, amount: money(p.amount), paidOn: day(p.paidOn), method: p.method as PaymentMethod, reference: p.reference, voided: p.voidedAt !== null, voidReason: p.voidReason,
});
type InvoiceDb = {
  id: string; branchId: string; studentId: string; description: string; amount: Prisma.Decimal; discount: Prisma.Decimal; issuedOn: Date; status: string;
  vatTreatment: string; vatRateBp: number; vatAmount: Prisma.Decimal; beneficiaryIdLast4: string | null;
  installments: { id: string; dueOn: Date; amount: Prisma.Decimal }[]; payments: PaymentDb[];
};
const invoiceInclude = { installments: { orderBy: { dueOn: 'asc' as const } }, payments: { orderBy: [{ paidOn: 'asc' as const }, { createdAt: 'asc' as const }] } };
const toInvoice = (i: InvoiceDb): InvoiceRow => ({
  id: i.id, branchId: i.branchId, studentId: i.studentId, description: i.description, amount: money(i.amount), discount: money(i.discount), issuedOn: day(i.issuedOn), status: i.status as 'OPEN' | 'CANCELLED',
  vatTreatment: i.vatTreatment as 'NONE' | 'STANDARD' | 'STATE_BORNE', vatRateBp: i.vatRateBp, vatAmount: money(i.vatAmount), beneficiaryIdLast4: i.beneficiaryIdLast4,
  installments: i.installments.map((x) => ({ id: x.id, dueOn: day(x.dueOn), amount: money(x.amount) })),
  payments: i.payments.map(toPayment),
});
type PayoutDb = { id: string; branchId: string; instructorId: string; period: Date; amount: Prisma.Decimal; duesAmount: Prisma.Decimal; minutes: number; hourlyRate: Prisma.Decimal; paidOn: Date; method: string; reference: string | null; voidedAt: Date | null; voidReason: string | null };
const toPayout = (p: PayoutDb): PayoutRow => ({
  id: p.id, branchId: p.branchId, instructorId: p.instructorId, period: day(p.period), amount: money(p.amount), duesAmount: money(p.duesAmount), minutes: p.minutes, hourlyRate: money(p.hourlyRate),
  paidOn: day(p.paidOn), method: p.method as PayoutMethod, reference: p.reference, voided: p.voidedAt !== null, voidReason: p.voidReason,
});
const toClosed = (c: { id: string; branchId: string; period: Date; closedBy: string; closedAt: Date }): ClosedPeriodRow => ({ id: c.id, branchId: c.branchId, period: day(c.period), closedBy: c.closedBy, closedAt: c.closedAt });

export class PrismaFinanceRepository implements FinanceRepository {
  // ---- expenses ----
  async listExpenses(tenantId: string, f: { branchId: string | null; from?: string; to?: string; category?: string }) {
    const rows = await forTenant(tenantId).expense.findMany({
      where: {
        tenantId,
        ...(f.branchId ? { branchId: f.branchId } : {}),
        ...(f.category ? { category: f.category } : {}),
        ...(f.from || f.to ? { incurredOn: { ...(f.from ? { gte: date(f.from) } : {}), ...(f.to ? { lte: date(f.to) } : {}) } } : {}),
      },
      orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    return rows.map(toExpense);
  }
  async getExpense(tenantId: string, id: string) {
    const e = await forTenant(tenantId).expense.findFirst({ where: { tenantId, id } });
    return e ? toExpense(e) : null;
  }
  createExpense(tenantId: string, actor: Actor, input: ExpenseInput): Promise<FWrite<ExpenseRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const e = await tx.expense.create({ data: { tenantId, ...input, amount: new Prisma.Decimal(input.amount), incurredOn: date(input.incurredOn) } });
        await audit(tx, tenantId, actor, 'institute.expense_recorded', e.id, { branchId: e.branchId, category: e.category, amount: money(e.amount), incurredOn: input.incurredOn });
        return { kind: 'ok' as const, value: toExpense(e) };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        if (isFk(err)) return { kind: 'not_found' as const };
        throw err;
      }
    });
  }
  deleteExpense(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const old = await tx.expense.findFirst({ where: { tenantId, id } });
        if (!old) return { kind: 'not_found' as const };
        await tx.expense.delete({ where: { id } });
        await audit(tx, tenantId, actor, 'institute.expense_deleted', id, { branchId: old.branchId, category: old.category, amount: money(old.amount), incurredOn: day(old.incurredOn) });
        return { kind: 'ok' as const, value: undefined };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        throw err;
      }
    });
  }

  // ---- utility bills ----
  async listBills(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).utilityBill.findMany({ where: { tenantId, ...(branchId ? { branchId } : {}) }, orderBy: [{ periodStart: 'desc' }] });
    return rows.map(toBill);
  }
  async getBill(tenantId: string, id: string) {
    const b = await forTenant(tenantId).utilityBill.findFirst({ where: { tenantId, id } });
    return b ? toBill(b) : null;
  }
  createBill(tenantId: string, actor: Actor, input: BillInput): Promise<FWrite<BillRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const b = await tx.utilityBill.create({
          data: { tenantId, branchId: input.branchId, periodStart: date(input.periodStart), periodEnd: date(input.periodEnd), amount: new Prisma.Decimal(input.amount), kwh: input.kwh === null ? null : new Prisma.Decimal(input.kwh), vatAmount: input.vatAmount === null ? null : new Prisma.Decimal(input.vatAmount) },
        });
        await audit(tx, tenantId, actor, 'institute.bill_recorded', b.id, { branchId: b.branchId, amount: money(b.amount), periodStart: input.periodStart });
        return { kind: 'ok' as const, value: toBill(b) };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        if (isUnique(err)) return { kind: 'duplicate' as const };
        if (isFk(err)) return { kind: 'not_found' as const };
        throw err;
      }
    });
  }
  deleteBill(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const old = await tx.utilityBill.findFirst({ where: { tenantId, id } });
        if (!old) return { kind: 'not_found' as const };
        await tx.utilityBill.delete({ where: { id } });
        await audit(tx, tenantId, actor, 'institute.bill_deleted', id, { branchId: old.branchId, amount: money(old.amount), periodStart: day(old.periodStart) });
        return { kind: 'ok' as const, value: undefined };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        throw err;
      }
    });
  }

  // ---- budgets ----
  async listBudgets(tenantId: string, f: { branchId: string | null; period?: string }) {
    const rows = await forTenant(tenantId).budget.findMany({ where: { tenantId, ...(f.branchId ? { branchId: f.branchId } : {}), ...(f.period ? { period: date(f.period) } : {}) }, orderBy: [{ period: 'desc' }, { category: 'asc' }] });
    return rows.map(toBudget);
  }
  async getBudget(tenantId: string, id: string) {
    const b = await forTenant(tenantId).budget.findFirst({ where: { tenantId, id } });
    return b ? toBudget(b) : null;
  }
  /** One budget per branch, month and category (null = branch total): saving again replaces the amount and threshold. */
  saveBudget(tenantId: string, actor: Actor, input: BudgetInput): Promise<FWrite<BudgetRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const existing = await tx.budget.findFirst({ where: { tenantId, branchId: input.branchId, period: date(input.period), category: input.category } });
        const data = { amount: new Prisma.Decimal(input.amount), warnPercent: input.warnPercent };
        const b = existing
          ? await tx.budget.update({ where: { id: existing.id }, data })
          : await tx.budget.create({ data: { tenantId, branchId: input.branchId, period: date(input.period), category: input.category, ...data } });
        await audit(tx, tenantId, actor, 'institute.budget_saved', b.id, { branchId: b.branchId, category: b.category, period: input.period, amount: money(b.amount), warnPercent: b.warnPercent });
        return { kind: 'ok' as const, value: toBudget(b) };
      } catch (err) {
        if (isUnique(err)) return { kind: 'duplicate' as const }; // lost a race with an identical save
        if (isFk(err)) return { kind: 'not_found' as const };
        throw err;
      }
    });
  }
  deleteBudget(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.budget.deleteMany({ where: { tenantId, id } });
      if (count === 0) return { kind: 'not_found' as const };
      await audit(tx, tenantId, actor, 'institute.budget_deleted', id, {});
      return { kind: 'ok' as const, value: undefined };
    });
  }
  async spend(tenantId: string, branchId: string | null, from: string, toExclusive: string) {
    const db = forTenant(tenantId);
    const where = { tenantId, ...(branchId ? { branchId } : {}) };
    const [expenses, bills] = await Promise.all([
      db.expense.groupBy({ by: ['branchId', 'category'], where: { ...where, incurredOn: { gte: date(from), lt: date(toExclusive) } }, _sum: { amount: true } }),
      db.utilityBill.groupBy({ by: ['branchId'], where: { ...where, periodStart: { gte: date(from), lt: date(toExclusive) } }, _sum: { amount: true } }),
    ]);
    // Instructor pay is cash going out in the month it is paid: it counts under its own category.
    const payouts = await db.instructorPayout.groupBy({ by: ['branchId'], where: { ...where, voidedAt: null, paidOn: { gte: date(from), lt: date(toExclusive) } }, _sum: { amount: true } });
    return [
      ...expenses.map((e) => ({ branchId: e.branchId, category: e.category, amount: money(e._sum.amount ?? new Prisma.Decimal(0)) })),
      ...bills.map((b) => ({ branchId: b.branchId, category: 'ELECTRICITY', amount: money(b._sum.amount ?? new Prisma.Decimal(0)) })),
      ...payouts.map((p) => ({ branchId: p.branchId, category: 'INSTRUCTOR_PAY', amount: money(p._sum.amount ?? new Prisma.Decimal(0)) })),
    ];
  }
  async income(tenantId: string, branchId: string | null, from: string, toExclusive: string) {
    const rows = await forTenant(tenantId).studentPayment.groupBy({
      by: ['branchId'],
      where: { tenantId, ...(branchId ? { branchId } : {}), voidedAt: null, paidOn: { gte: date(from), lt: date(toExclusive) } },
      _sum: { amount: true },
    });
    return rows.map((r) => ({ branchId: r.branchId, amount: money(r._sum.amount ?? new Prisma.Decimal(0)) }));
  }

  // ---- student invoices and payments ----
  async listInvoices(tenantId: string, f: { branchId: string | null; studentId?: string }) {
    const rows = await forTenant(tenantId).studentInvoice.findMany({
      where: { tenantId, ...(f.branchId ? { branchId: f.branchId } : {}), ...(f.studentId ? { studentId: f.studentId } : {}) },
      include: invoiceInclude,
      orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map(toInvoice);
  }
  async getInvoice(tenantId: string, id: string) {
    const i = await forTenant(tenantId).studentInvoice.findFirst({ where: { tenantId, id }, include: invoiceInclude });
    return i ? toInvoice(i) : null;
  }
  createInvoice(tenantId: string, actor: Actor, input: InvoiceInput): Promise<FWrite<InvoiceRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const inv = await tx.studentInvoice.create({
          data: {
            tenantId,
            branchId: input.branchId,
            studentId: input.studentId,
            description: input.description,
            amount: new Prisma.Decimal(input.amount),
            discount: new Prisma.Decimal(input.discount),
            issuedOn: date(input.issuedOn),
            vatTreatment: input.vatTreatment,
            vatRateBp: input.vatRateBp,
            vatAmount: new Prisma.Decimal(input.vatAmount),
            beneficiaryIdEnc: input.beneficiaryIdEnc,
            beneficiaryIdLast4: input.beneficiaryIdLast4,
            installments: { create: input.installments.map((x) => ({ tenantId, branchId: input.branchId, dueOn: date(x.dueOn), amount: new Prisma.Decimal(x.amount) })) },
          },
          include: invoiceInclude,
        });
        await audit(tx, tenantId, actor, 'institute.invoice_issued', inv.id, { branchId: inv.branchId, studentId: inv.studentId, amount: money(inv.amount), discount: money(inv.discount), instalments: input.installments.length });
        return { kind: 'ok' as const, value: toInvoice(inv) };
      } catch (err) {
        if (isFk(err)) return { kind: 'not_found' as const };
        throw err;
      }
    });
  }
  cancelInvoice(tenantId: string, actor: Actor, id: string): Promise<FWrite<InvoiceRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      // Lock the invoice so a payment racing with the cancel cannot slip in between the check and the update.
      await tx.$queryRaw`SELECT id FROM student_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const inv = await tx.studentInvoice.findFirst({ where: { tenantId, id }, include: invoiceInclude });
      if (!inv) return { kind: 'not_found' as const };
      if (inv.payments.some((p) => p.voidedAt === null)) return { kind: 'has_payments' as const };
      if (inv.status === 'CANCELLED') return { kind: 'ok' as const, value: toInvoice(inv) };
      await tx.studentInvoice.update({ where: { id }, data: { status: 'CANCELLED' } });
      await audit(tx, tenantId, actor, 'institute.invoice_cancelled', id, { branchId: inv.branchId });
      return { kind: 'ok' as const, value: toInvoice({ ...inv, status: 'CANCELLED' }) };
    });
  }
  recordPayment(tenantId: string, actor: Actor, input: PaymentInput): Promise<FWrite<PaymentRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        // Serialise payments on one invoice: lock the row, then compare with what is still owed.
        await tx.$queryRaw`SELECT id FROM student_invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
        const inv = await tx.studentInvoice.findFirst({ where: { tenantId, id: input.invoiceId }, include: { payments: true } });
        if (!inv) return { kind: 'not_found' as const };
        if (inv.status === 'CANCELLED') return { kind: 'cancelled' as const };
        const paid = inv.payments.filter((p) => p.voidedAt === null).reduce((n, p) => n.plus(p.amount), new Prisma.Decimal(0));
        const outstanding = inv.amount.minus(inv.discount).plus(inv.vatAmount).minus(paid); // what the student owes includes the VAT charged
        if (new Prisma.Decimal(input.amount).greaterThan(outstanding)) return { kind: 'overpaid' as const, outstanding: money(outstanding) };
        const p = await tx.studentPayment.create({
          data: { tenantId, branchId: inv.branchId, invoiceId: inv.id, amount: new Prisma.Decimal(input.amount), paidOn: date(input.paidOn), method: input.method, reference: input.reference },
        });
        await audit(tx, tenantId, actor, 'institute.payment_received', p.id, { invoiceId: inv.id, branchId: inv.branchId, amount: money(p.amount), paidOn: input.paidOn, method: input.method });
        return { kind: 'ok' as const, value: toPayment(p) };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        throw err;
      }
    });
  }
  async getPayment(tenantId: string, id: string) {
    const p = await forTenant(tenantId).studentPayment.findFirst({ where: { tenantId, id } });
    return p ? toPayment(p) : null;
  }
  voidPayment(tenantId: string, actor: Actor, paymentId: string, reason: string): Promise<FWrite<PaymentRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const p = await tx.studentPayment.findFirst({ where: { tenantId, id: paymentId } });
        if (!p) return { kind: 'not_found' as const };
        if (p.voidedAt) return { kind: 'ok' as const, value: toPayment(p) }; // already void: idempotent
        const v = await tx.studentPayment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason } });
        await audit(tx, tenantId, actor, 'institute.payment_voided', paymentId, { invoiceId: p.invoiceId, branchId: p.branchId, amount: money(p.amount), reason });
        return { kind: 'ok' as const, value: toPayment(v) };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        throw err;
      }
    });
  }

  // ---- VAT summary ----
  async vatSummary(tenantId: string, branchId: string | null, from: string, toExclusive: string) {
    const rows = await forTenant(tenantId).studentInvoice.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}), status: 'OPEN', issuedOn: { gte: date(from), lt: date(toExclusive) } },
      select: { branchId: true, vatTreatment: true, amount: true, discount: true, vatAmount: true },
    });
    const groups = new Map<string, { branchId: string; treatment: 'NONE' | 'STANDARD' | 'STATE_BORNE'; invoices: number; net: Prisma.Decimal; vat: Prisma.Decimal }>();
    for (const r of rows) {
      const key = `${r.branchId}|${r.vatTreatment}`;
      const g = groups.get(key) ?? { branchId: r.branchId, treatment: r.vatTreatment as 'NONE' | 'STANDARD' | 'STATE_BORNE', invoices: 0, net: new Prisma.Decimal(0), vat: new Prisma.Decimal(0) };
      g.invoices += 1;
      g.net = g.net.plus(r.amount).minus(r.discount);
      g.vat = g.vat.plus(r.vatAmount);
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ branchId: g.branchId, treatment: g.treatment, invoices: g.invoices, netAmount: money(g.net), vatAmount: money(g.vat) }));
  }

  // ---- instructor payouts ----
  async listPayouts(tenantId: string, f: { branchId: string | null; period: string }) {
    const rows = await forTenant(tenantId).instructorPayout.findMany({ where: { tenantId, period: date(f.period), ...(f.branchId ? { branchId: f.branchId } : {}) }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toPayout);
  }
  async getPayout(tenantId: string, id: string) {
    const p = await forTenant(tenantId).instructorPayout.findFirst({ where: { tenantId, id } });
    return p ? toPayout(p) : null;
  }
  createPayout(tenantId: string, actor: Actor, input: PayoutInput): Promise<FWrite<PayoutRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        // Serialise payouts to one instructor: lock the instructor row, then compare with what the month still owes.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM instructors WHERE id = ${input.instructorId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
        if (locked.length === 0) return { kind: 'not_found_instructor' as const };
        const paid = await tx.instructorPayout.aggregate({ where: { tenantId, instructorId: input.instructorId, period: date(input.period), voidedAt: null }, _sum: { amount: true } });
        const owed = new Prisma.Decimal(input.duesAmount).minus(paid._sum.amount ?? new Prisma.Decimal(0));
        if (new Prisma.Decimal(input.amount).greaterThan(owed)) return { kind: 'overpaid' as const, outstanding: money(owed.lessThan(0) ? new Prisma.Decimal(0) : owed) };
        const p = await tx.instructorPayout.create({
          data: {
            tenantId,
            branchId: input.branchId,
            instructorId: input.instructorId,
            period: date(input.period),
            amount: new Prisma.Decimal(input.amount),
            duesAmount: new Prisma.Decimal(input.duesAmount),
            minutes: input.minutes,
            hourlyRate: new Prisma.Decimal(input.hourlyRate),
            paidOn: date(input.paidOn),
            method: input.method,
            reference: input.reference,
          },
        });
        await audit(tx, tenantId, actor, 'institute.payout_recorded', p.id, { instructorId: p.instructorId, branchId: p.branchId, period: input.period, amount: money(p.amount), dues: money(p.duesAmount), paidOn: input.paidOn });
        return { kind: 'ok' as const, value: toPayout(p) };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        if (isFk(err)) return { kind: 'not_found' as const };
        throw err;
      }
    });
  }
  voidPayout(tenantId: string, actor: Actor, id: string, reason: string): Promise<FWrite<PayoutRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const p = await tx.instructorPayout.findFirst({ where: { tenantId, id } });
        if (!p) return { kind: 'not_found' as const };
        if (p.voidedAt) return { kind: 'ok' as const, value: toPayout(p) };
        const v = await tx.instructorPayout.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
        await audit(tx, tenantId, actor, 'institute.payout_voided', id, { instructorId: p.instructorId, branchId: p.branchId, amount: money(p.amount), reason });
        return { kind: 'ok' as const, value: toPayout(v) };
      } catch (err) {
        if (isClosed(err)) return { kind: 'closed' as const };
        throw err;
      }
    });
  }

  // ---- closed periods ----
  async listClosed(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).closedPeriod.findMany({ where: { tenantId, ...(branchId ? { branchId } : {}) }, orderBy: [{ period: 'desc' }] });
    return rows.map(toClosed);
  }
  async getClosed(tenantId: string, id: string) {
    const c = await forTenant(tenantId).closedPeriod.findFirst({ where: { tenantId, id } });
    return c ? toClosed(c) : null;
  }
  closePeriod(tenantId: string, actor: Actor, branchId: string, period: string): Promise<FWrite<ClosedPeriodRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const c = await tx.closedPeriod.create({ data: { tenantId, branchId, period: date(period), closedBy: actor.userId } });
        await audit(tx, tenantId, actor, 'institute.period_closed', c.id, { branchId, period });
        return { kind: 'ok' as const, value: toClosed(c) };
      } catch (err) {
        if (isUnique(err)) return { kind: 'duplicate' as const };
        if (isFk(err)) return { kind: 'not_found' as const };
        throw err;
      }
    });
  }
  reopenPeriod(tenantId: string, actor: Actor, id: string): Promise<FWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const old = await tx.closedPeriod.findFirst({ where: { tenantId, id } });
      if (!old) return { kind: 'not_found' as const };
      await tx.closedPeriod.delete({ where: { id } });
      await audit(tx, tenantId, actor, 'institute.period_reopened', id, { branchId: old.branchId, period: day(old.period) });
      return { kind: 'ok' as const, value: undefined };
    });
  }

  // ---- instructor dues ----
  heldMinutes(tenantId: string, branchId: string | null, from: Date, toExclusive: Date): Promise<{ instructorId: string; minutes: number }[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ instructor_id: string; minutes: number }[]>`
        SELECT instructor_id, (SUM(EXTRACT(EPOCH FROM (ends_at - starts_at))) / 60)::int AS minutes
        FROM class_sessions
        WHERE tenant_id = ${tenantId}::uuid AND status = 'HELD' AND starts_at >= ${from} AND starts_at < ${toExclusive}
          AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}::uuid)
        GROUP BY instructor_id`;
      return rows.map((r) => ({ instructorId: r.instructor_id, minutes: Number(r.minutes) }));
    });
  }
}
