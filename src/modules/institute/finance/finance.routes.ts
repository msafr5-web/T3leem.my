import { Router, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireAuthContext, requireFeature, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import { HttpError } from '../../../shared/utils/http-error';
import { fromCents } from './finance.logic';
import type { BillRow, BudgetRow, ClosedPeriodRow, ExpenseRow, PaymentMethod, PaymentRow } from './finance.repository';
import type { BudgetView, FinanceService, InvoiceView } from './finance.service';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const money = (field: string, required = true, positive = false) => {
  const chain = required ? body(field) : body(field).optional({ values: 'null' });
  // `positive` mirrors the database CHECK (amount > 0) so a zero is a clean 422, not a constraint error.
  return chain.custom((v) => MONEY.test(String(v)) && (!positive || Number(v) > 0)).withMessage(`${field} must be ${positive ? 'a positive ' : ''}amount with at most 2 decimals`);
};
const amountOf = (v: unknown, dflt = '0.00'): string => (v === undefined || v === null || v === '' ? dflt : Number(v).toFixed(2));
const dateField = (field: string, required = true) => {
  const chain = required ? body(field) : body(field).optional({ values: 'null' });
  return chain.isISO8601({ strict: true }).isLength({ min: 10, max: 10 }).withMessage(`${field} must be YYYY-MM-DD`);
};
const monthQuery = () => query('month').matches(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/).withMessage('month must be YYYY-MM');
const monthOf = (v: unknown): string => `${String(v).slice(0, 7)}-01`;

const expenseJson = (e: ExpenseRow) => ({ id: e.id, branch_id: e.branchId, room_id: e.roomId, category: e.category, amount: e.amount, incurred_on: e.incurredOn, vendor: e.vendor, description: e.description });
const billJson = (b: BillRow) => ({ id: b.id, branch_id: b.branchId, period_start: b.periodStart, period_end: b.periodEnd, amount: b.amount, kwh: b.kwh });
const budgetJson = (v: BudgetView) => ({
  id: v.budget.id,
  branch_id: v.budget.branchId,
  category: v.budget.category,
  period: v.budget.period,
  amount: v.budget.amount,
  warn_percent: v.budget.warnPercent,
  spent: fromCents(v.status.spentCents),
  remaining: fromCents(v.status.remainingCents),
  percent: v.status.percent,
  level: v.status.level,
});
const paymentJson = (p: PaymentRow) => ({ id: p.id, invoice_id: p.invoiceId, amount: p.amount, paid_on: p.paidOn, method: p.method, reference: p.reference, voided: p.voided, void_reason: p.voidReason });
const invoiceJson = (v: InvoiceView) => ({
  id: v.invoice.id,
  branch_id: v.invoice.branchId,
  student_id: v.invoice.studentId,
  description: v.invoice.description,
  amount: v.invoice.amount,
  discount: v.invoice.discount,
  net: fromCents(v.netCents),
  paid: fromCents(v.paidCents),
  outstanding: fromCents(v.outstandingCents),
  issued_on: v.invoice.issuedOn,
  status: v.invoice.status,
  overdue: v.overdue,
  installments: v.installments.map((i) => ({ due_on: i.dueOn, amount: fromCents(i.amountCents), paid: fromCents(i.paidCents), remaining: fromCents(i.remainingCents), state: i.state })),
  payments: v.payments.map(paymentJson),
});
const closedJson = (c: ClosedPeriodRow) => ({ id: c.id, branch_id: c.branchId, period: c.period, closed_by: c.closedBy, closed_at: c.closedAt.toISOString() });
const budgetFromRow = (r: BudgetRow) => r;

/** Institute finance: expenses, electricity bills, budgets, student invoices and payments, closing months, reports. */
export function buildFinanceRouter(service: FinanceService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use('/institute/finance', requireFeature('institute'));
  const auth = authenticate(jwt);
  const ctx = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, caller: { userId: user.id, userRole: user.role, ip: req.ip ?? null } };
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');
  const F = '/institute/finance';

  // ---- expenses ----
  router.get(`${F}/expenses`, auth, query('branch_id').optional().isUUID(), query('from').optional().isISO8601(), query('to').optional().isISO8601(), query('category').optional().isString().isLength({ max: 80 }), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const list = await service.listExpenses(tenantId, caller, { branchId: str(req.query.branch_id) ?? undefined, from: str(req.query.from)?.slice(0, 10), to: str(req.query.to)?.slice(0, 10), category: str(req.query.category) ?? undefined });
    noStore(res);
    res.json(ok({ expenses: list.map(expenseJson) }));
  });
  router.post(
    `${F}/expenses`,
    auth,
    body('branch_id').isUUID(),
    body('room_id').optional({ values: 'null' }).isUUID(),
    body('category').isString().trim().isLength({ min: 1, max: 80 }),
    money('amount', true, true),
    dateField('incurred_on'),
    body('vendor').optional({ values: 'null' }).isString().isLength({ max: 120 }),
    body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const e = await service.recordExpense(tenantId, caller, { branchId: String(b.branch_id), roomId: str(b.room_id), category: String(b.category).trim(), amount: amountOf(b.amount), incurredOn: String(b.incurred_on), vendor: str(b.vendor), description: str(b.description) });
      res.status(201).json(ok(expenseJson(e)));
    },
  );
  router.delete(`${F}/expenses/:id`, auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteExpense(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- electricity bills ----
  router.get(`${F}/bills`, auth, query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ bills: (await service.listBills(tenantId, caller, str(req.query.branch_id) ?? undefined)).map(billJson) }));
  });
  router.post(`${F}/bills`, auth, body('branch_id').isUUID(), dateField('period_start'), dateField('period_end'), money('amount', true, true), money('kwh', false), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    if (String(b.period_end) < String(b.period_start)) throw HttpError.unprocessable('INVALID_PERIOD', 'period_end must not be before period_start');
    const created = await service.recordBill(tenantId, caller, { branchId: String(b.branch_id), periodStart: String(b.period_start), periodEnd: String(b.period_end), amount: amountOf(b.amount), kwh: b.kwh === undefined || b.kwh === null || b.kwh === '' ? null : amountOf(b.kwh) });
    res.status(201).json(ok(billJson(created)));
  });
  router.delete(`${F}/bills/:id`, auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteBill(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- budgets ----
  router.get(`${F}/budgets`, auth, monthQuery(), query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const views = await service.budgets(tenantId, caller, { branchId: str(req.query.branch_id) ?? undefined, period: monthOf(req.query.month) });
    noStore(res);
    res.json(ok({ month: monthOf(req.query.month), budgets: views.map(budgetJson) }));
  });
  router.put(
    `${F}/budgets`,
    auth,
    body('branch_id').isUUID(),
    body('month').matches(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/).withMessage('month must be YYYY-MM'),
    body('category').optional({ values: 'null' }).isString().trim().isLength({ min: 1, max: 80 }),
    money('amount'),
    body('warn_percent').optional().isInt({ min: 1, max: 100 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const saved = await service.saveBudget(tenantId, caller, budgetFromRow({ id: '', branchId: String(b.branch_id), category: str(b.category), period: monthOf(b.month), amount: amountOf(b.amount), warnPercent: b.warn_percent === undefined ? 80 : Number(b.warn_percent) }));
      res.json(ok({ id: saved.id, branch_id: saved.branchId, category: saved.category, period: saved.period, amount: saved.amount, warn_percent: saved.warnPercent }));
    },
  );
  router.delete(`${F}/budgets/:id`, auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteBudget(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- student invoices and payments ----
  router.get(`${F}/invoices`, auth, query('branch_id').optional().isUUID(), query('student_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const list = await service.listInvoices(tenantId, caller, { branchId: str(req.query.branch_id) ?? undefined, studentId: str(req.query.student_id) ?? undefined });
    noStore(res);
    res.json(ok({ invoices: list.map(invoiceJson) }));
  });
  router.get(`${F}/invoices/:id`, auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok(invoiceJson(await service.getInvoice(tenantId, caller, req.params.id as string))));
  });
  router.post(
    `${F}/invoices`,
    auth,
    body('student_id').isUUID(),
    body('description').isString().trim().isLength({ min: 1, max: 200 }),
    money('amount', true, true),
    money('discount', false),
    dateField('issued_on'),
    body('installments').optional().isArray({ min: 1, max: 60 }),
    body('installments.*.due_on').isISO8601({ strict: true }).isLength({ min: 10, max: 10 }),
    body('installments.*.amount').custom((v) => MONEY.test(String(v)) && Number(v) > 0),
    body('plan').optional().isObject(),
    body('plan.count').optional().isInt({ min: 1, max: 60 }),
    dateField('plan.first_due', false),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const plan = b.plan as { count?: unknown; first_due?: unknown } | undefined;
      const v = await service.issueInvoice(tenantId, caller, {
        studentId: String(b.student_id),
        description: String(b.description).trim(),
        amount: amountOf(b.amount),
        discount: amountOf(b.discount),
        issuedOn: String(b.issued_on),
        installments: Array.isArray(b.installments) ? (b.installments as { due_on: string; amount: unknown }[]).map((x) => ({ dueOn: x.due_on, amount: amountOf(x.amount) })) : undefined,
        plan: plan && plan.count ? { count: Number(plan.count), firstDue: String(plan.first_due ?? b.issued_on) } : undefined,
      });
      res.status(201).json(ok(invoiceJson(v)));
    },
  );
  router.post(`${F}/invoices/:id/cancel`, auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(invoiceJson(await service.cancelInvoice(tenantId, caller, req.params.id as string))));
  });
  router.post(
    `${F}/invoices/:id/payments`,
    auth,
    uuid('id'),
    money('amount', true, true),
    dateField('paid_on'),
    body('method').optional().isIn(['CASH', 'TRANSFER', 'CARD', 'OTHER']),
    body('reference').optional({ values: 'null' }).isString().isLength({ max: 120 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const p = await service.receivePayment(tenantId, caller, { invoiceId: req.params.id as string, amount: amountOf(b.amount), paidOn: String(b.paid_on), method: (typeof b.method === 'string' ? b.method : 'CASH') as PaymentMethod, reference: str(b.reference) });
      res.status(201).json(ok(paymentJson(p)));
    },
  );
  router.post(`${F}/payments/:id/void`, auth, uuid('id'), body('reason').isString().trim().isLength({ min: 3, max: 300 }).withMessage('A reason is required'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(paymentJson(await service.voidPayment(tenantId, caller, req.params.id as string, String(req.body.reason).trim()))));
  });

  // ---- closing months ----
  router.get(`${F}/closed-periods`, auth, query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ closed: (await service.listClosed(tenantId, caller, str(req.query.branch_id) ?? undefined)).map(closedJson) }));
  });
  router.post(`${F}/closed-periods`, auth, body('branch_id').isUUID(), body('month').matches(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/).withMessage('month must be YYYY-MM'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.status(201).json(ok(closedJson(await service.closeMonth(tenantId, caller, String(req.body.branch_id), monthOf(req.body.month)))));
  });
  router.delete(`${F}/closed-periods/:id`, auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.reopenMonth(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- reports ----
  router.get(`${F}/summary`, auth, monthQuery(), query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const s = await service.summary(tenantId, caller, { branchId: str(req.query.branch_id) ?? undefined, month: monthOf(req.query.month) });
    noStore(res);
    res.json(
      ok({
        month: s.month,
        branches: s.branches.map((b) => ({
          branch_id: b.branchId,
          income: fromCents(b.incomeCents),
          spend: fromCents(b.spendCents),
          net: fromCents(b.netCents),
          by_category: Object.fromEntries(Object.entries(b.byCategory).map(([k, v]) => [k, fromCents(v)])),
          closed: b.closed,
        })),
        totals: { income: fromCents(s.totals.incomeCents), spend: fromCents(s.totals.spendCents), net: fromCents(s.totals.netCents) },
      }),
    );
  });
  router.get(`${F}/instructor-dues`, auth, monthQuery(), query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const d = await service.instructorDues(tenantId, caller, { branchId: str(req.query.branch_id) ?? undefined, month: monthOf(req.query.month) });
    noStore(res);
    res.json(ok({ month: d.month, total: fromCents(d.totalCents), instructors: d.rows.map((r) => ({ instructor_id: r.instructorId, branch_id: r.branchId, name: r.name, minutes: r.minutes, hourly_rate: r.hourlyRate, pay: fromCents(r.payCents) })) }));
  });

  return router;
}
