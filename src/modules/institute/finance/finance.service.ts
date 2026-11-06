import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import type { AcademicRepository } from '../academic/academic.repository';
import { can, inScope, type Action, type Principal, type Resource } from '../institute.access';
import type { InstituteRepository } from '../institute.repository';
import type { Caller, InstituteService } from '../institute.service';
import {
  allocateInstallments,
  budgetStatus,
  evenInstallments,
  fromCents,
  instructorPayCents,
  monthStart,
  nextMonthStart,
  toCents,
  type BudgetStatus,
  type InstallmentView,
} from './finance.logic';
import type {
  BillInput,
  BillRow,
  BudgetRow,
  ClosedPeriodRow,
  ExpenseInput,
  ExpenseRow,
  FWrite,
  FinanceRepository,
  InvoiceRow,
  PaymentInput,
  PaymentRow,
} from './finance.repository';

export interface InvoiceView {
  invoice: Omit<InvoiceRow, 'installments' | 'payments'>;
  netCents: number;
  paidCents: number;
  outstandingCents: number;
  /** True when any instalment is past due and not fully paid. */
  overdue: boolean;
  installments: InstallmentView[];
  payments: PaymentRow[];
}

export interface BudgetView {
  budget: BudgetRow;
  status: BudgetStatus;
}

/** Today in Saudi time (UTC+3, no daylight saving): the accounting day does not follow the server's zone. */
export const riyadhToday = (now: Date = new Date()): string => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

export class FinanceService {
  constructor(
    private readonly repo: FinanceRepository,
    private readonly inst: InstituteService,
    private readonly base: Pick<InstituteRepository, 'getBranch' | 'getRoom'>,
    private readonly academic: Pick<AcademicRepository, 'getStudent' | 'listInstructors'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private allow(p: Principal, resource: Resource, action: Action): void {
    if (!can(p.role, resource, action)) throw HttpError.forbidden('Your institute role does not allow this');
  }
  private actor(c: Caller): Actor {
    return { userId: c.userId, role: c.userRole, ip: c.ip };
  }
  private static missing(what: string): HttpError {
    return HttpError.notFound(`${what.toUpperCase()}_NOT_FOUND`, `${what} not found`);
  }
  private static written<T>(r: FWrite<T>, what: string): T {
    switch (r.kind) {
      case 'ok':
        return r.value;
      case 'duplicate':
        throw HttpError.conflict(`${what.toUpperCase()}_EXISTS`, `A ${what} like this already exists`);
      case 'closed':
        throw HttpError.conflict('PERIOD_CLOSED', 'This month is closed: nothing dated in it can be added, changed or removed');
      case 'overpaid':
        throw new HttpError(409, 'OVERPAID', `The payment is more than the ${r.outstanding} still owed on this invoice`, { outstanding: r.outstanding });
      case 'cancelled':
        throw HttpError.conflict('INVOICE_CANCELLED', 'A cancelled invoice takes no payments');
      case 'has_payments':
        throw HttpError.conflict('INVOICE_HAS_PAYMENTS', 'Void its payments before cancelling the invoice');
      default:
        throw FinanceService.missing(what);
    }
  }
  private scope(p: Principal, requested?: string): string | null | 'none' {
    if (p.branchId === null) return requested ?? null;
    return requested && requested !== p.branchId ? 'none' : p.branchId;
  }
  private async branchInScope(tenantId: string, p: Principal, branchId: string): Promise<void> {
    if (!inScope(p, branchId) || !(await this.base.getBranch(tenantId, branchId))) throw FinanceService.missing('branch');
  }

  // ---- expenses ----
  async listExpenses(tenantId: string, c: Caller, f: { branchId?: string; from?: string; to?: string; category?: string }): Promise<ExpenseRow[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'expense', 'read');
    const scope = this.scope(p, f.branchId);
    return scope === 'none' ? [] : this.repo.listExpenses(tenantId, { branchId: scope, from: f.from, to: f.to, category: f.category });
  }
  async recordExpense(tenantId: string, c: Caller, input: ExpenseInput): Promise<ExpenseRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'expense', 'write');
    await this.branchInScope(tenantId, p, input.branchId);
    // Electricity is booked once, as a bill: an expense with that name would count the same money twice in budgets and reports.
    if (input.category.trim().toUpperCase() === 'ELECTRICITY') throw HttpError.unprocessable('USE_UTILITY_BILL', 'Record electricity as a utility bill, not as an expense');
    if (input.roomId) {
      const room = await this.base.getRoom(tenantId, input.roomId);
      if (!room || room.branchId !== input.branchId) throw HttpError.unprocessable('ROOM_BRANCH_MISMATCH', 'The room is not in this branch');
    }
    return FinanceService.written(await this.repo.createExpense(tenantId, this.actor(c), input), 'expense');
  }
  async deleteExpense(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'expense', 'write');
    const e = await this.repo.getExpense(tenantId, id);
    if (!e || !inScope(p, e.branchId)) throw FinanceService.missing('expense');
    FinanceService.written(await this.repo.deleteExpense(tenantId, this.actor(c), id), 'expense');
  }

  // ---- electricity bills ----
  async listBills(tenantId: string, c: Caller, branchId?: string): Promise<BillRow[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'bill', 'read');
    const scope = this.scope(p, branchId);
    return scope === 'none' ? [] : this.repo.listBills(tenantId, scope);
  }
  async recordBill(tenantId: string, c: Caller, input: BillInput): Promise<BillRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'bill', 'write');
    await this.branchInScope(tenantId, p, input.branchId);
    return FinanceService.written(await this.repo.createBill(tenantId, this.actor(c), input), 'bill');
  }
  async deleteBill(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'bill', 'write');
    const b = await this.repo.getBill(tenantId, id);
    if (!b || !inScope(p, b.branchId)) throw FinanceService.missing('bill');
    FinanceService.written(await this.repo.deleteBill(tenantId, this.actor(c), id), 'bill');
  }

  // ---- budgets ----
  /** Budgets of one month with what has been spent against each; a total budget (no category) counts every category. */
  async budgets(tenantId: string, c: Caller, f: { branchId?: string; period: string }): Promise<BudgetView[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'budget', 'read');
    const scope = this.scope(p, f.branchId);
    if (scope === 'none') return [];
    const period = monthStart(f.period);
    const [budgets, spend] = await Promise.all([this.repo.listBudgets(tenantId, { branchId: scope, period }), this.repo.spend(tenantId, scope, period, nextMonthStart(period))]);
    return budgets.map((b) => {
      const mine = spend.filter((s) => s.branchId === b.branchId && (b.category === null || s.category.toLowerCase() === b.category.toLowerCase()));
      const spent = mine.reduce((n, s) => n + toCents(s.amount), 0);
      return { budget: b, status: budgetStatus(toCents(b.amount), spent, b.warnPercent) };
    });
  }
  async saveBudget(tenantId: string, c: Caller, input: BudgetRow): Promise<BudgetRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'budget', 'write');
    await this.branchInScope(tenantId, p, input.branchId);
    return FinanceService.written(await this.repo.saveBudget(tenantId, this.actor(c), { ...input, period: monthStart(input.period) }), 'budget');
  }
  async deleteBudget(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'budget', 'write');
    const b = await this.repo.getBudget(tenantId, id);
    if (!b || !inScope(p, b.branchId)) throw FinanceService.missing('budget');
    FinanceService.written(await this.repo.deleteBudget(tenantId, this.actor(c), id), 'budget');
  }

  // ---- student invoices and payments ----
  private view(i: InvoiceRow, today: string): InvoiceView {
    const { installments, payments, ...invoice } = i;
    const net = toCents(i.amount) - toCents(i.discount);
    const paid = i.status === 'CANCELLED' ? 0 : payments.filter((x) => !x.voided).reduce((n, x) => n + toCents(x.amount), 0);
    const parts = allocateInstallments(installments.map((x) => ({ dueOn: x.dueOn, amountCents: toCents(x.amount) })), paid, today);
    return { invoice, netCents: net, paidCents: paid, outstandingCents: i.status === 'CANCELLED' ? 0 : net - paid, overdue: i.status === 'OPEN' && parts.some((x) => x.state === 'OVERDUE'), installments: parts, payments };
  }
  async listInvoices(tenantId: string, c: Caller, f: { branchId?: string; studentId?: string }): Promise<InvoiceView[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'invoice', 'read');
    const scope = this.scope(p, f.branchId);
    if (scope === 'none') return [];
    const today = riyadhToday(this.now());
    return (await this.repo.listInvoices(tenantId, { branchId: scope, studentId: f.studentId })).map((i) => this.view(i, today));
  }
  async getInvoice(tenantId: string, c: Caller, id: string): Promise<InvoiceView> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'invoice', 'read');
    const i = await this.repo.getInvoice(tenantId, id);
    if (!i || !inScope(p, i.branchId)) throw FinanceService.missing('invoice');
    return this.view(i, riyadhToday(this.now()));
  }
  /**
   * Issues an invoice with its instalment plan. Either explicit instalments or `count` monthly ones from `firstDue`;
   * the plan must add up to amount minus discount to the halala, otherwise nothing is saved.
   */
  async issueInvoice(
    tenantId: string,
    c: Caller,
    input: { studentId: string; description: string; amount: string; discount: string; issuedOn: string; installments?: { dueOn: string; amount: string }[]; plan?: { count: number; firstDue: string } },
  ): Promise<InvoiceView> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'invoice', 'write');
    const student = await this.academic.getStudent(tenantId, input.studentId);
    if (!student || !inScope(p, student.branchId)) throw FinanceService.missing('student');
    const net = toCents(input.amount) - toCents(input.discount);
    if (net <= 0) throw HttpError.unprocessable('DISCOUNT_TOO_LARGE', 'The discount must be less than the amount');
    const plan = input.installments ?? (input.plan ? evenInstallments(net, input.plan.count, input.plan.firstDue).map((x) => ({ dueOn: x.dueOn, amount: fromCents(x.cents) })) : [{ dueOn: input.issuedOn, amount: fromCents(net) }]);
    if (plan.reduce((n, x) => n + toCents(x.amount), 0) !== net) throw HttpError.unprocessable('INSTALLMENTS_MISMATCH', `The instalments must add up to ${fromCents(net)}`);
    const created = FinanceService.written(
      await this.repo.createInvoice(tenantId, this.actor(c), { branchId: student.branchId, studentId: student.id, description: input.description, amount: input.amount, discount: input.discount, issuedOn: input.issuedOn, installments: plan }),
      'invoice',
    );
    return this.view(created, riyadhToday(this.now()));
  }
  async cancelInvoice(tenantId: string, c: Caller, id: string): Promise<InvoiceView> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'ledger_admin', 'write');
    const i = await this.repo.getInvoice(tenantId, id);
    if (!i || !inScope(p, i.branchId)) throw FinanceService.missing('invoice');
    return this.view(FinanceService.written(await this.repo.cancelInvoice(tenantId, this.actor(c), id), 'invoice'), riyadhToday(this.now()));
  }
  async receivePayment(tenantId: string, c: Caller, input: PaymentInput): Promise<PaymentRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'invoice', 'write');
    const i = await this.repo.getInvoice(tenantId, input.invoiceId);
    if (!i || !inScope(p, i.branchId)) throw FinanceService.missing('invoice');
    if (input.paidOn > riyadhToday(this.now())) throw HttpError.unprocessable('PAID_IN_FUTURE', 'A payment cannot be dated in the future');
    return FinanceService.written(await this.repo.recordPayment(tenantId, this.actor(c), input), 'invoice');
  }
  async voidPayment(tenantId: string, c: Caller, paymentId: string, reason: string): Promise<PaymentRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'ledger_admin', 'write');
    const pay = await this.repo.getPayment(tenantId, paymentId);
    if (!pay || !inScope(p, pay.branchId)) throw FinanceService.missing('payment');
    return FinanceService.written(await this.repo.voidPayment(tenantId, this.actor(c), paymentId, reason), 'payment');
  }

  // ---- closing months ----
  async listClosed(tenantId: string, c: Caller, branchId?: string): Promise<ClosedPeriodRow[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'ledger_admin', 'read');
    const scope = this.scope(p, branchId);
    return scope === 'none' ? [] : this.repo.listClosed(tenantId, scope);
  }
  /** Only a month that has ended can be closed. */
  async closeMonth(tenantId: string, c: Caller, branchId: string, month: string): Promise<ClosedPeriodRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'ledger_admin', 'write');
    await this.branchInScope(tenantId, p, branchId);
    const period = monthStart(month);
    if (nextMonthStart(period) > riyadhToday(this.now())) throw HttpError.unprocessable('PERIOD_NOT_ENDED', 'A month can only be closed after it has ended');
    return FinanceService.written(await this.repo.closePeriod(tenantId, this.actor(c), branchId, period), 'period');
  }
  async reopenMonth(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'ledger_admin', 'write');
    const closed = await this.repo.getClosed(tenantId, id);
    if (!closed || !inScope(p, closed.branchId)) throw FinanceService.missing('period');
    FinanceService.written(await this.repo.reopenPeriod(tenantId, this.actor(c), id), 'period');
  }

  // ---- reports ----
  /** What came in, what went out and the net for a month, per branch and in total. */
  async summary(tenantId: string, c: Caller, f: { branchId?: string; month: string }) {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'invoice', 'read');
    const scope = this.scope(p, f.branchId);
    const period = monthStart(f.month);
    if (scope === 'none') return { month: period, branches: [] as { branchId: string; incomeCents: number; spendCents: number; netCents: number; byCategory: Record<string, number>; closed: boolean }[], totals: { incomeCents: 0, spendCents: 0, netCents: 0 } };
    const [income, spend, closed] = await Promise.all([
      this.repo.income(tenantId, scope, period, nextMonthStart(period)),
      this.repo.spend(tenantId, scope, period, nextMonthStart(period)),
      this.repo.listClosed(tenantId, scope),
    ]);
    const ids = new Set([...income.map((i) => i.branchId), ...spend.map((s) => s.branchId)]);
    const branches = [...ids].sort().map((branchId) => {
      const incomeCents = income.filter((i) => i.branchId === branchId).reduce((n, i) => n + toCents(i.amount), 0);
      const byCategory: Record<string, number> = {};
      for (const s of spend.filter((x) => x.branchId === branchId)) byCategory[s.category] = (byCategory[s.category] ?? 0) + toCents(s.amount);
      const spendCents = Object.values(byCategory).reduce((n, v) => n + v, 0);
      return { branchId, incomeCents, spendCents, netCents: incomeCents - spendCents, byCategory, closed: closed.some((x) => x.branchId === branchId && x.period === period) };
    });
    const totals = branches.reduce((t, b) => ({ incomeCents: t.incomeCents + b.incomeCents, spendCents: t.spendCents + b.spendCents, netCents: t.netCents + b.netCents }), { incomeCents: 0, spendCents: 0, netCents: 0 });
    return { month: period, branches, totals };
  }

  /** Pay owed to instructors for sessions that were actually held in the month (cancelled or merely scheduled ones earn nothing). */
  async instructorDues(tenantId: string, c: Caller, f: { branchId?: string; month: string }) {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'dues', 'read');
    const scope = this.scope(p, f.branchId);
    const period = monthStart(f.month);
    if (scope === 'none') return { month: period, rows: [], totalCents: 0 };
    // The month's bounds are Saudi-time midnights, matching how sessions are scheduled.
    const from = new Date(`${period}T00:00:00+03:00`);
    const to = new Date(`${nextMonthStart(period)}T00:00:00+03:00`);
    const [held, instructors] = await Promise.all([this.repo.heldMinutes(tenantId, scope, from, to), this.academic.listInstructors(tenantId, scope)]);
    const byId = new Map(instructors.map((i) => [i.id, i]));
    const rows = held
      .filter((h) => byId.has(h.instructorId))
      .map((h) => {
        const i = byId.get(h.instructorId)!;
        const rateCents = toCents(i.hourlyRate);
        return { instructorId: i.id, branchId: i.branchId, name: i.fullName, minutes: h.minutes, hourlyRate: i.hourlyRate, payCents: instructorPayCents(h.minutes, rateCents) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { month: period, rows, totalCents: rows.reduce((n, r) => n + r.payCents, 0) };
  }
}
