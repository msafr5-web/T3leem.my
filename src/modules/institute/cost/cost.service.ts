import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import type { AcademicRepository } from '../academic/academic.repository';
import { can, inScope, type Action, type Principal, type Resource } from '../institute.access';
import type { InstituteRepository } from '../institute.repository';
import type { Caller, InstituteService } from '../institute.service';
import type { FinanceRepository } from '../finance/finance.repository';
import { monthStart, nextMonthStart, toCents } from '../finance/finance.logic';
import {
  computeProgramCosts,
  computeRoomCosts,
  type CostPolicyParams,
  type CostRoom,
  type DepAsset,
  type ProgramInput,
  type ProgramReport,
  type RoomCostResult,
  type Warning,
} from './cost.engine';
import type { CostRepository, CWrite, PolicyRow, ReadingRow } from './cost.repository';
import { TARIFF_CATEGORIES, estimateBill, type BillEstimate, type EstimateFailure } from './tariff';

export interface PolicyProblem {
  field: string;
  message: string;
}

/** Strictly validates a policy submitted by a person: unknown shapes are rejected, nothing is silently defaulted. */
export function parsePolicy(raw: unknown): { ok: true; policy: CostPolicyParams } | { ok: false; problems: PolicyProblem[] } {
  const problems: PolicyProblem[] = [];
  const bad = (field: string, message: string) => problems.push({ field, message });
  const obj = (v: unknown, field: string): Record<string, unknown> => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
    bad(field, 'must be an object');
    return {};
  };
  const oneOf = <T extends string>(v: unknown, field: string, allowed: readonly T[]): T => {
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    bad(field, `must be one of ${allowed.join(', ')}`);
    return allowed[0] as T;
  };
  const int = (v: unknown, field: string, min: number, max: number): number => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
    bad(field, `must be a whole number from ${min} to ${max}`);
    return min;
  };
  const bool = (v: unknown, field: string): boolean => {
    if (typeof v === 'boolean') return v;
    bad(field, 'must be true or false');
    return false;
  };

  const root = obj(raw, 'policy');
  const e = obj(root.electricity, 'electricity');
  const d = obj(root.depreciation, 'depreciation');
  const o = obj(root.overhead, 'overhead');
  const oc = obj(root.occupancy, 'occupancy');
  const r = obj(root.revenue, 'revenue');

  const vat = e.vatRatePercent;
  if (!(typeof vat === 'number' && vat >= 0 && vat <= 100 && Math.round(vat * 100) === vat * 100)) bad('electricity.vatRatePercent', 'must be a percentage from 0 to 100 with at most 2 decimals');
  const rec = e.vatRecoveryPercent;
  const recoveryValid = typeof rec === 'number' && rec >= 0 && rec <= 100 && Math.round(rec * 100) === rec * 100;
  if (!recoveryValid) bad('electricity.vatRecoveryPercent', 'must be a percentage from 0 to 100 with at most 2 decimals');
  const recovery = typeof rec === 'number' ? rec : 0;
  // Only a VAT-registered person can deduct input VAT: an unregistered institute with a recovery above 0 is a contradiction, not a default.
  if (recoveryValid && e.vatRegistered === false && recovery > 0) bad('electricity.vatRecoveryPercent', 'must be 0 when the institute is not registered for VAT');
  const breakerAmps: Record<string, number> = {};
  const rawBreakers = e.breakerAmps === undefined ? {} : obj(e.breakerAmps, 'electricity.breakerAmps');
  for (const [branchId, amps] of Object.entries(rawBreakers)) {
    if (!/^[0-9a-f-]{36}$/i.test(branchId)) bad('electricity.breakerAmps', `"${branchId}" is not a branch id`);
    else breakerAmps[branchId] = int(amps, `electricity.breakerAmps.${branchId}`, 1, 10_000);
  }

  const policy: CostPolicyParams = {
    electricity: {
      tariffCategory: oneOf(e.tariffCategory, 'electricity.tariffCategory', TARIFF_CATEGORIES),
      allocation: oneOf(e.allocation, 'electricity.allocation', ['AREA', 'POWER_HOURS', 'METER'] as const),
      vatRatePercent: typeof vat === 'number' ? vat : 15,
      vatRegistered: bool(e.vatRegistered, 'electricity.vatRegistered'),
      vatRecoveryPercent: recovery,
      breakerAmps,
    },
    depreciation: { start: oneOf(d.start, 'depreciation.start', ['PURCHASE_MONTH', 'NEXT_MONTH'] as const), defaultLifeMonths: int(d.defaultLifeMonths, 'depreciation.defaultLifeMonths', 1, 600) },
    overhead: { basis: oneOf(o.basis, 'overhead.basis', ['AREA', 'HOURS'] as const) },
    occupancy: { availableHoursPerMonth: int(oc.availableHoursPerMonth, 'occupancy.availableHoursPerMonth', 1, 744) },
    revenue: { basis: oneOf(r.basis, 'revenue.basis', ['CASH', 'OVER_TIME'] as const) },
  };
  return problems.length > 0 ? { ok: false, problems } : { ok: true, policy };
}

/** Policies approved before VAT recovery became a percentage carry a boolean: read them as 100% (recoverable) or 0%. */
export function normalizePolicy(p: CostPolicyParams): CostPolicyParams {
  const e = p.electricity as CostPolicyParams['electricity'] & { vatRecoverable?: boolean };
  if (e.vatRegistered !== undefined && e.vatRecoveryPercent !== undefined) return p;
  const recoverable = e.vatRecoverable === true;
  return { ...p, electricity: { ...e, vatRegistered: recoverable, vatRecoveryPercent: recoverable ? 100 : 0 } };
}

export interface BillCheck {
  billId: string;
  tariffId: string | null;
  failure: EstimateFailure | null;
  actualCents: number;
  /** What the bill should have been under the policy's tariff category, or null when it cannot be estimated. */
  estimate: BillEstimate | null;
  /** actual - expected total, in halalas; null when there is no estimate. */
  differenceCents: number | null;
  /** OK within 2%; REVIEW above that. Null without an estimate. */
  level: 'OK' | 'REVIEW' | null;
  note: string;
}

export interface CostReport {
  month: string;
  branchId: string;
  policy: { id: string; version: number; approvedAt: Date | null };
  rooms: RoomCostResult;
  programs: ProgramReport;
  billCheck: BillCheck | null;
  warnings: Warning[];
}

const lastDayOf = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const x100 = (decimal: string): number => Math.round(Number(decimal) * 100);

export class CostService {
  constructor(
    private readonly repo: CostRepository,
    private readonly inst: InstituteService,
    private readonly base: Pick<InstituteRepository, 'getBranch' | 'getRoom' | 'listRooms' | 'listAssets'>,
    private readonly academic: Pick<AcademicRepository, 'listPrograms' | 'listStudents' | 'listInstructors'>,
    private readonly finance: Pick<FinanceRepository, 'listExpenses' | 'listBills' | 'listInvoices'>,
  ) {}

  private allow(p: Principal, resource: Resource, action: Action): void {
    if (!can(p.role, resource, action)) throw HttpError.forbidden('Your institute role does not allow this');
  }
  private actor(c: Caller): Actor {
    return { userId: c.userId, role: c.userRole, ip: c.ip };
  }
  private static written<T>(r: CWrite<T>, what: string): T {
    switch (r.kind) {
      case 'ok':
        return r.value;
      case 'no_draft':
        throw HttpError.conflict('NO_DRAFT_POLICY', 'There is no draft policy to approve or discard');
      case 'frozen':
        throw HttpError.conflict('POLICY_FROZEN', 'An approved policy cannot be changed: edit a new draft instead');
      default:
        throw HttpError.notFound(`${what.toUpperCase()}_NOT_FOUND`, `${what} not found`);
    }
  }
  private async branchInScope(tenantId: string, p: Principal, branchId: string): Promise<void> {
    if (!inScope(p, branchId) || !(await this.base.getBranch(tenantId, branchId))) throw HttpError.notFound('BRANCH_NOT_FOUND', 'branch not found');
  }

  // ---- policy: draft -> approved, frozen ----
  async policies(tenantId: string, c: Caller): Promise<{ approved: PolicyRow | null; draft: PolicyRow | null; history: PolicyRow[] }> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'cost_policy', 'read');
    const all = await this.repo.listPolicies(tenantId);
    return { approved: all.find((x) => x.status === 'APPROVED') ?? null, draft: all.find((x) => x.status === 'DRAFT') ?? null, history: all.filter((x) => x.status === 'SUPERSEDED') };
  }
  async saveDraft(tenantId: string, c: Caller, raw: unknown, note: string | null): Promise<PolicyRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'cost_policy', 'write');
    const parsed = parsePolicy(raw);
    if (!parsed.ok) throw HttpError.unprocessable('INVALID_POLICY', 'The policy has invalid values', parsed.problems);
    // Breaker sizes must name real branches of this institute.
    for (const branchId of Object.keys(parsed.policy.electricity.breakerAmps)) {
      if (!(await this.base.getBranch(tenantId, branchId))) throw HttpError.unprocessable('INVALID_POLICY', 'A breaker size names an unknown branch', [{ field: 'electricity.breakerAmps', message: branchId }]);
    }
    return this.repo.saveDraft(tenantId, this.actor(c), parsed.policy, note);
  }
  async discardDraft(tenantId: string, c: Caller): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'cost_policy', 'write');
    CostService.written(await this.repo.discardDraft(tenantId, this.actor(c)), 'policy');
  }
  /** Head office only: approving is the accounting decision that the reports will be built on. */
  async approveDraft(tenantId: string, c: Caller): Promise<PolicyRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'cost_policy_approve', 'write');
    return CostService.written(await this.repo.approveDraft(tenantId, this.actor(c)), 'policy');
  }

  // ---- sub-meter readings ----
  async readings(tenantId: string, c: Caller, month: string, branchId?: string): Promise<ReadingRow[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'meter', 'read');
    const scope = p.branchId === null ? (branchId ?? null) : p.branchId;
    if (p.branchId !== null && branchId && branchId !== p.branchId) return [];
    return this.repo.listReadings(tenantId, scope, monthStart(month));
  }
  async saveReading(tenantId: string, c: Caller, input: { roomId: string; month: string; kwh: string }): Promise<ReadingRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'meter', 'write');
    const room = await this.base.getRoom(tenantId, input.roomId);
    if (!room || !inScope(p, room.branchId)) throw HttpError.notFound('ROOM_NOT_FOUND', 'room not found');
    return CostService.written(await this.repo.saveReading(tenantId, this.actor(c), { branchId: room.branchId, roomId: room.id, period: monthStart(input.month), kwh: input.kwh }), 'room');
  }
  async deleteReading(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'meter', 'write');
    const r = await this.repo.getReading(tenantId, id);
    if (!r || !inScope(p, r.branchId)) throw HttpError.notFound('READING_NOT_FOUND', 'reading not found');
    CostService.written(await this.repo.deleteReading(tenantId, this.actor(c), id), 'reading');
  }

  // ---- the monthly cost report ----
  /**
   * Costs a branch's month under the APPROVED policy (no approved policy, no numbers: a figure nobody has approved the
   * method of is not reported). Reports are deterministic: the same data and policy version give the same halalas.
   */
  async report(tenantId: string, c: Caller, input: { branchId: string; month: string }): Promise<CostReport> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'cost_report', 'read');
    await this.branchInScope(tenantId, p, input.branchId);
    const approved = await this.repo.approvedPolicy(tenantId);
    if (!approved) throw HttpError.conflict('NO_APPROVED_POLICY', 'Approve a cost policy first: reports are only produced under an approved policy');
    const policy = normalizePolicy(approved.params);
    const month = monthStart(input.month);
    const next = nextMonthStart(month);
    // Month bounds are Saudi-time midnights, like every other date in the institute.
    const from = new Date(`${month}T00:00:00+03:00`);
    const to = new Date(`${next}T00:00:00+03:00`);

    const [rooms, assets, held, readings, expenses, bills, programs, students, instructors, invoices, before, until] = await Promise.all([
      this.base.listRooms(tenantId, input.branchId),
      this.base.listAssets(tenantId, { branchId: input.branchId }),
      this.repo.heldSessions(tenantId, input.branchId, from, to),
      this.repo.listReadings(tenantId, input.branchId, month),
      this.finance.listExpenses(tenantId, { branchId: input.branchId, from: month, to: lastDayOf(month) }),
      this.finance.listBills(tenantId, input.branchId),
      this.academic.listPrograms(tenantId, input.branchId),
      this.academic.listStudents(tenantId, { branchId: input.branchId }),
      this.academic.listInstructors(tenantId, input.branchId),
      this.finance.listInvoices(tenantId, { branchId: input.branchId }),
      this.repo.heldMinutesBefore(tenantId, input.branchId, from),
      this.repo.heldMinutesBefore(tenantId, input.branchId, to),
    ]);

    const heldMinutes: Record<string, number> = {};
    for (const s of held) heldMinutes[s.roomId] = (heldMinutes[s.roomId] ?? 0) + s.minutes;
    const costRooms: CostRoom[] = rooms.filter((r) => r.active || (heldMinutes[r.id] ?? 0) > 0).map((r) => ({ id: r.id, name: r.name, areaX100: x100(r.areaM2), kwX100: x100(r.powerKw) }));
    const depAssets: DepAsset[] = assets.map((a) => ({
      id: a.id,
      roomId: a.roomId,
      status: a.status,
      purchaseDate: a.purchaseDate,
      retiredOn: a.retiredOn,
      costCents: toCents(a.purchaseValue),
      residualBp: x100(a.salvagePercent),
      usefulLifeMonths: a.usefulLifeMonths,
    }));
    const bill = bills.find((b) => b.periodStart >= month && b.periodStart < next) ?? null;
    const readingsKwhX100 = Object.fromEntries(readings.map((r) => [r.roomId, x100(r.kwh)]));

    const roomCosts = computeRoomCosts({
      month,
      policy,
      rooms: costRooms,
      heldMinutes,
      readingsKwhX100,
      bill: bill ? { amountCents: toCents(bill.amount), vatCents: bill.vatAmount === null ? null : toCents(bill.vatAmount), kwhX100: bill.kwh === null ? null : x100(bill.kwh) } : null,
      assets: depAssets,
      expenses: expenses.map((e) => ({ roomId: e.roomId, amountCents: toCents(e.amount) })),
    });

    // Programme side: hours, enrolled students, what was invoiced and collected.
    const programOf = new Map(students.map((s) => [s.id, s.programId]));
    const programInputs: ProgramInput[] = programs.map((pr) => {
      const mine = invoices.filter((i) => programOf.get(i.studentId) === pr.id);
      const open = mine.filter((i) => i.status === 'OPEN');
      const collected = mine.flatMap((i) => i.payments).filter((x) => !x.voided && x.paidOn >= month && x.paidOn < next).reduce((n, x) => n + toCents(x.amount), 0);
      return {
        id: pr.id,
        name: pr.name,
        activeStudents: students.filter((s) => s.programId === pr.id && s.status === 'ACTIVE').length,
        totalMinutes: pr.levels.flatMap((l) => l.subjects).reduce((n, s) => n + s.hours * 60, 0),
        invoicedCents: open.reduce((n, i) => n + toCents(i.amount) - toCents(i.discount), 0),
        collectedCents: collected,
        deliveredBeforeMinutes: before[pr.id] ?? 0,
        deliveredUntilMinutes: until[pr.id] ?? 0,
      };
    });
    const programReport = computeProgramCosts({
      policy,
      rooms: roomCosts.rooms,
      sessions: held,
      hourlyRateCents: Object.fromEntries(instructors.map((i) => [i.id, i.hourlyRate === undefined ? 0 : toCents(i.hourlyRate)])),
      programs: programInputs,
    });

    return {
      month,
      branchId: input.branchId,
      policy: { id: approved.id, version: approved.version, approvedAt: approved.approvedAt },
      rooms: roomCosts,
      programs: programReport,
      billCheck: bill ? this.checkBill(bill, policy, input.branchId) : null,
      warnings: [...roomCosts.warnings, ...programReport.warnings],
    };
  }

  /** Compares the bill that was paid with what the tariff says it should have been. A difference is a prompt to look, not an error. */
  private checkBill(bill: { id: string; periodStart: string; periodEnd: string; amount: string; kwh: string | null }, policy: CostPolicyParams, branchId: string): BillCheck {
    const actualCents = toCents(bill.amount);
    const none = (failure: EstimateFailure | null, note: string): BillCheck => ({ billId: bill.id, tariffId: null, failure, actualCents, estimate: null, differenceCents: null, level: null, note });
    if (bill.kwh === null) return none(null, 'The bill has no kWh recorded, so it cannot be checked against the tariff');
    const est = estimateBill({ category: policy.electricity.tariffCategory, periodStart: bill.periodStart, periodEnd: bill.periodEnd, kwh: Number(bill.kwh), breakerAmps: policy.electricity.breakerAmps[branchId] ?? null, vatRatePercent: policy.electricity.vatRatePercent });
    if ('failure' in est) return none(est.failure, est.failure === 'PERIOD_STRADDLES_TARIFF_CHANGE' ? 'The billing period spans the tariff change date, so no estimate is made' : 'No tariff is on record for this category and period');
    const diff = actualCents - est.totalCents;
    const incomplete = est.fixedCents === null;
    return {
      billId: bill.id,
      tariffId: est.tariffId,
      failure: null,
      actualCents,
      estimate: est,
      differenceCents: diff,
      level: Math.abs(diff) * 100 <= est.totalCents * 2 ? 'OK' : 'REVIEW',
      note: incomplete ? 'The estimate has no fixed charge (not on record for this period or breaker size unknown): expect the bill to be higher' : 'Estimate under the tariff in force; within 2% is normal',
    };
  }
}

