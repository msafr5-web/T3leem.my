import { Router, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireAuthContext, requireFeature, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import { fromCents } from '../finance/finance.logic';
import { DEFAULT_POLICY } from './cost.engine';
import type { PolicyRow, ReadingRow } from './cost.repository';
import type { BillCheck, CostReport, CostService } from './cost.service';
import { TARIFFS } from './tariff';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const monthRe = /^\d{4}-(0[1-9]|1[0-2])(-01)?$/;
const monthOf = (v: unknown): string => `${String(v).slice(0, 7)}-01`;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

const policyJson = (p: PolicyRow) => ({
  id: p.id,
  version: p.version,
  status: p.status,
  params: p.params,
  note: p.note,
  created_by: p.createdBy,
  approved_by: p.approvedBy,
  approved_at: p.approvedAt?.toISOString() ?? null,
  created_at: p.createdAt.toISOString(),
});
const readingJson = (r: ReadingRow) => ({ id: r.id, branch_id: r.branchId, room_id: r.roomId, month: r.period, kwh: r.kwh });
const billCheckJson = (b: BillCheck | null) =>
  b === null
    ? null
    : {
        bill_id: b.billId,
        tariff_id: b.tariffId,
        failure: b.failure,
        actual: fromCents(b.actualCents),
        difference: b.differenceCents === null ? null : fromCents(b.differenceCents),
        level: b.level,
        note: b.note,
        estimate: b.estimate && {
          energy: fromCents(b.estimate.energyCents),
          fixed: b.estimate.fixedCents === null ? null : fromCents(b.estimate.fixedCents),
          vat: fromCents(b.estimate.vatCents),
          total: fromCents(b.estimate.totalCents),
          tiers: b.estimate.tiers.map((t) => ({ kwh: t.kwh, halalas_per_kwh: t.halalasPerKwh, amount: fromCents(t.cents) })),
          warnings: b.estimate.warnings,
        },
      };
const reportJson = (r: CostReport) => ({
  month: r.month,
  branch_id: r.branchId,
  policy: { id: r.policy.id, version: r.policy.version, approved_at: r.policy.approvedAt?.toISOString() ?? null },
  electricity: { method_used: r.rooms.electricity.methodUsed, cost: fromCents(r.rooms.electricity.costCents) },
  overhead: fromCents(r.rooms.overheadCents),
  total_room_cost: fromCents(r.rooms.totalCents),
  idle_cost: fromCents(r.programs.idleCostCents),
  rooms: r.rooms.rooms.map((c) => ({
    room_id: c.roomId,
    name: c.name,
    electricity: fromCents(c.electricityCents),
    depreciation: fromCents(c.depreciationCents),
    direct_expenses: fromCents(c.directExpenseCents),
    overhead: fromCents(c.overheadCents),
    total: fromCents(c.totalCents),
    held_minutes: c.heldMinutes,
    cost_per_hour: c.costPerHourCents === null ? null : fromCents(c.costPerHourCents),
    occupancy_percent: c.occupancyPercent,
  })),
  programs: r.programs.programs.map((p) => ({
    program_id: p.programId,
    name: p.name,
    held_minutes: p.heldMinutes,
    facility_cost: fromCents(p.facilityCents),
    instructor_cost: fromCents(p.instructorCents),
    total_cost: fromCents(p.totalCostCents),
    revenue: fromCents(p.revenueCents),
    profit: fromCents(p.profitCents),
    active_students: p.activeStudents,
    cost_per_student: p.costPerStudentCents === null ? null : fromCents(p.costPerStudentCents),
  })),
  bill_check: billCheckJson(r.billCheck),
  warnings: r.warnings.map((w) => ({ code: w.code, ...(w.detail ? { detail: w.detail } : {}) })),
});

/** Institute cost engine: policy (draft -> approved), sub-meter readings, tariff register, monthly cost report. */
export function buildCostRouter(service: CostService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use('/institute/cost', requireFeature('institute'));
  const auth = authenticate(jwt);
  const ctx = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, caller: { userId: user.id, userRole: user.role, ip: req.ip ?? null } };
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');
  const C = '/institute/cost';

  router.get(`${C}/policy`, auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const s = await service.policies(tenantId, caller);
    noStore(res);
    res.json(ok({ approved: s.approved && policyJson(s.approved), draft: s.draft && policyJson(s.draft), history: s.history.map(policyJson), defaults: DEFAULT_POLICY }));
  });
  router.put(`${C}/policy/draft`, auth, body('policy').isObject(), body('note').optional({ values: 'null' }).isString().isLength({ max: 500 }), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(policyJson(await service.saveDraft(tenantId, caller, req.body.policy, str(req.body.note)))));
  });
  router.delete(`${C}/policy/draft`, auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.discardDraft(tenantId, caller);
    res.status(204).end();
  });
  router.post(`${C}/policy/approve`, auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(policyJson(await service.approveDraft(tenantId, caller))));
  });

  // The tariff register the engine uses: what is on record, from which date, and the source.
  router.get(`${C}/tariffs`, auth, (_req: Request, res: Response) => {
    res.json(
      ok({
        tariffs: TARIFFS.map((t) => ({
          id: t.id,
          category: t.category,
          effective_from: t.effectiveFrom,
          effective_to: t.effectiveTo,
          tiers: t.tiers.map((x) => ({ up_to_kwh: x.upToKwh, halalas_per_kwh: x.halalasPerKwh })),
          fixed_charges: t.fixedCharges && t.fixedCharges.map((f) => ({ from_amp: f.fromAmp, to_amp_exclusive: f.toAmpExclusive, sar_per_month: f.sar })),
          source: t.source,
        })),
      }),
    );
  });

  router.get(`${C}/meter-readings`, auth, query('month').matches(monthRe), query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ readings: (await service.readings(tenantId, caller, monthOf(req.query.month), str(req.query.branch_id) ?? undefined)).map(readingJson) }));
  });
  router.put(`${C}/meter-readings`, auth, body('room_id').isUUID(), body('month').matches(monthRe).withMessage('month must be YYYY-MM'), body('kwh').custom((v) => MONEY.test(String(v))).withMessage('kwh must be a number with at most 2 decimals'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    res.json(ok(readingJson(await service.saveReading(tenantId, caller, { roomId: String(b.room_id), month: monthOf(b.month), kwh: Number(b.kwh).toFixed(2) }))));
  });
  router.delete(`${C}/meter-readings/:id`, auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteReading(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  router.get(`${C}/report`, auth, query('branch_id').isUUID(), query('month').matches(monthRe).withMessage('month must be YYYY-MM'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const r = await service.report(tenantId, caller, { branchId: String(req.query.branch_id), month: monthOf(req.query.month) });
    noStore(res);
    res.json(ok(reportJson(r)));
  });

  return router;
}
