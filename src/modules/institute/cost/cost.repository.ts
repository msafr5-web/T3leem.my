import { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import type { Actor } from '../../provider/provider.types';
import type { CostPolicyParams } from './cost.engine';

export type PolicyStatus = 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
export interface PolicyRow {
  id: string;
  version: number;
  status: PolicyStatus;
  params: CostPolicyParams;
  note: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface ReadingRow {
  id: string;
  branchId: string;
  roomId: string;
  /** First day of the month, YYYY-MM-01. */
  period: string;
  /** "123.45" */
  kwh: string;
}

/** A session that was actually held, with where it sat in the programme tree. */
export interface HeldSessionRow {
  sessionId: string;
  roomId: string;
  instructorId: string;
  programId: string;
  minutes: number;
}

export type CWrite<T> = { kind: 'ok'; value: T } | { kind: 'not_found' } | { kind: 'no_draft' } | { kind: 'frozen' };

export interface CostRepository {
  listPolicies(tenantId: string): Promise<PolicyRow[]>;
  approvedPolicy(tenantId: string): Promise<PolicyRow | null>;
  /** Creates the working draft (next version) or replaces the parameters of the existing one. */
  saveDraft(tenantId: string, actor: Actor, params: CostPolicyParams, note: string | null): Promise<PolicyRow>;
  discardDraft(tenantId: string, actor: Actor): Promise<CWrite<void>>;
  /** Freezes the draft as the approved policy and supersedes the previous one, in one transaction. */
  approveDraft(tenantId: string, actor: Actor): Promise<CWrite<PolicyRow>>;

  listReadings(tenantId: string, branchId: string | null, period: string): Promise<ReadingRow[]>;
  getReading(tenantId: string, id: string): Promise<ReadingRow | null>;
  saveReading(tenantId: string, actor: Actor, input: { branchId: string; roomId: string; period: string; kwh: string }): Promise<CWrite<ReadingRow>>;
  deleteReading(tenantId: string, actor: Actor, id: string): Promise<CWrite<void>>;

  /** Sessions held (status HELD) that started in [from, toExclusive), one row each. */
  heldSessions(tenantId: string, branchId: string, from: Date, toExclusive: Date): Promise<HeldSessionRow[]>;
  /** Minutes of held sessions per programme that started before `before`. */
  heldMinutesBefore(tenantId: string, branchId: string, before: Date): Promise<Record<string, number>>;
}

const audit = (tx: Prisma.TransactionClient, tenantId: string, actor: Actor, action: string, entityId: string, metadata: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType: 'institute', entityId, metadata, ipAddress: actor.ip } });

const code = (e: unknown): string | null => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null);
const isFk = (e: unknown) => {
  if (code(e) === 'P2003') return true;
  if (e instanceof Prisma.PrismaClientUnknownRequestError) return /23001|23503|violates RESTRICT|foreign key constraint/i.test(e.message);
  return false;
};
const isFrozen = (e: unknown): boolean => e instanceof Error && e.message.includes('institute_policy_frozen');
const day = (d: Date): string => d.toISOString().slice(0, 10);

const toPolicy = (p: { id: string; version: number; status: string; params: Prisma.JsonValue; note: string | null; createdBy: string; approvedBy: string | null; approvedAt: Date | null; createdAt: Date }): PolicyRow => ({
  id: p.id,
  version: p.version,
  status: p.status as PolicyStatus,
  params: p.params as unknown as CostPolicyParams,
  note: p.note,
  createdBy: p.createdBy,
  approvedBy: p.approvedBy,
  approvedAt: p.approvedAt,
  createdAt: p.createdAt,
});
const toReading = (r: { id: string; branchId: string; roomId: string; period: Date; kwh: Prisma.Decimal }): ReadingRow => ({ id: r.id, branchId: r.branchId, roomId: r.roomId, period: day(r.period), kwh: r.kwh.toFixed(2) });

export class PrismaCostRepository implements CostRepository {
  async listPolicies(tenantId: string) {
    const rows = await forTenant(tenantId).costPolicy.findMany({ where: { tenantId }, orderBy: { version: 'desc' }, take: 50 });
    return rows.map(toPolicy);
  }
  async approvedPolicy(tenantId: string) {
    const p = await forTenant(tenantId).costPolicy.findFirst({ where: { tenantId, status: 'APPROVED' } });
    return p ? toPolicy(p) : null;
  }
  saveDraft(tenantId: string, actor: Actor, params: CostPolicyParams, note: string | null): Promise<PolicyRow> {
    return withTenantTransaction(tenantId, async (tx) => {
      const draft = await tx.costPolicy.findFirst({ where: { tenantId, status: 'DRAFT' } });
      const json = params as unknown as Prisma.InputJsonValue;
      let row;
      if (draft) row = await tx.costPolicy.update({ where: { id: draft.id }, data: { params: json, note } });
      else {
        const last = await tx.costPolicy.aggregate({ where: { tenantId }, _max: { version: true } });
        row = await tx.costPolicy.create({ data: { tenantId, version: (last._max.version ?? 0) + 1, status: 'DRAFT', params: json, note, createdBy: actor.userId } });
      }
      await audit(tx, tenantId, actor, 'institute.cost_policy_drafted', row.id, { version: row.version });
      return toPolicy(row);
    });
  }
  discardDraft(tenantId: string, actor: Actor): Promise<CWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const draft = await tx.costPolicy.findFirst({ where: { tenantId, status: 'DRAFT' } });
      if (!draft) return { kind: 'no_draft' as const };
      await tx.costPolicy.delete({ where: { id: draft.id } });
      await audit(tx, tenantId, actor, 'institute.cost_policy_discarded', draft.id, { version: draft.version });
      return { kind: 'ok' as const, value: undefined };
    });
  }
  approveDraft(tenantId: string, actor: Actor): Promise<CWrite<PolicyRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const draft = await tx.costPolicy.findFirst({ where: { tenantId, status: 'DRAFT' } });
        if (!draft) return { kind: 'no_draft' as const };
        // Supersede first: only one APPROVED row may exist at a time (partial unique index).
        await tx.costPolicy.updateMany({ where: { tenantId, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
        const row = await tx.costPolicy.update({ where: { id: draft.id }, data: { status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date() } });
        await audit(tx, tenantId, actor, 'institute.cost_policy_approved', row.id, { version: row.version });
        return { kind: 'ok' as const, value: toPolicy(row) };
      } catch (e) {
        if (isFrozen(e)) return { kind: 'frozen' as const };
        throw e;
      }
    });
  }

  async listReadings(tenantId: string, branchId: string | null, period: string) {
    const rows = await forTenant(tenantId).roomMeterReading.findMany({ where: { tenantId, period: new Date(`${period}T00:00:00Z`), ...(branchId ? { branchId } : {}) }, orderBy: { createdAt: 'asc' } });
    return rows.map(toReading);
  }
  async getReading(tenantId: string, id: string) {
    const r = await forTenant(tenantId).roomMeterReading.findFirst({ where: { tenantId, id } });
    return r ? toReading(r) : null;
  }
  saveReading(tenantId: string, actor: Actor, input: { branchId: string; roomId: string; period: string; kwh: string }): Promise<CWrite<ReadingRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const period = new Date(`${input.period}T00:00:00Z`);
        const r = await tx.roomMeterReading.upsert({
          where: { roomId_period: { roomId: input.roomId, period } },
          create: { tenantId, branchId: input.branchId, roomId: input.roomId, period, kwh: new Prisma.Decimal(input.kwh) },
          update: { kwh: new Prisma.Decimal(input.kwh) },
        });
        await audit(tx, tenantId, actor, 'institute.meter_reading_saved', r.id, { roomId: input.roomId, period: input.period, kwh: input.kwh });
        return { kind: 'ok' as const, value: toReading(r) };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteReading(tenantId: string, actor: Actor, id: string): Promise<CWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.roomMeterReading.deleteMany({ where: { tenantId, id } });
      if (count === 0) return { kind: 'not_found' as const };
      await audit(tx, tenantId, actor, 'institute.meter_reading_deleted', id, {});
      return { kind: 'ok' as const, value: undefined };
    });
  }

  async heldSessions(tenantId: string, branchId: string, from: Date, toExclusive: Date) {
    const rows = await forTenant(tenantId).classSession.findMany({
      where: { tenantId, branchId, status: 'HELD', startsAt: { gte: from, lt: toExclusive } },
      select: { id: true, roomId: true, instructorId: true, startsAt: true, endsAt: true, subject: { select: { level: { select: { programId: true } } } } },
    });
    return rows.map((s) => ({ sessionId: s.id, roomId: s.roomId, instructorId: s.instructorId, programId: s.subject.level.programId, minutes: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000) }));
  }
  heldMinutesBefore(tenantId: string, branchId: string, before: Date): Promise<Record<string, number>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ program_id: string; minutes: number }[]>`
        SELECT l.program_id AS program_id, (SUM(EXTRACT(EPOCH FROM (s.ends_at - s.starts_at))) / 60)::int AS minutes
        FROM class_sessions s
        JOIN subjects sub ON sub.id = s.subject_id
        JOIN levels l ON l.id = sub.level_id
        WHERE s.tenant_id = ${tenantId}::uuid AND s.branch_id = ${branchId}::uuid AND s.status = 'HELD' AND s.starts_at < ${before}
        GROUP BY l.program_id`;
      return Object.fromEntries(rows.map((r) => [r.program_id, Number(r.minutes)]));
    });
  }
}
