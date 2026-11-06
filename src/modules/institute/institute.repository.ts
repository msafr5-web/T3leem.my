import { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../config/database';
import type { Actor } from '../provider/provider.types';
import type { InstituteRole } from './institute.access';

export interface BranchRow {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  active: boolean;
}
export interface BranchInput {
  name: string;
  city: string | null;
  address: string | null;
  active: boolean;
}

export interface MemberRow {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: InstituteRole;
  branchId: string | null;
}

export type RoomKind = 'CLASSROOM' | 'LAB' | 'HALL';
export interface RoomRow {
  id: string;
  branchId: string;
  name: string;
  kind: RoomKind;
  /** Decimals as strings so money/area never pass through floating point. */
  areaM2: string;
  capacity: number;
  powerKw: string;
  active: boolean;
}
export type RoomInput = Omit<RoomRow, 'id'>;

export type AssetStatus = 'IN_SERVICE' | 'MAINTENANCE' | 'RETIRED';
export interface AssetRow {
  id: string;
  branchId: string;
  roomId: string | null;
  name: string;
  category: string | null;
  serialNo: string | null;
  /** YYYY-MM-DD */
  purchaseDate: string | null;
  purchaseValue: string;
  salvagePercent: string;
  usefulLifeMonths: number | null;
  status: AssetStatus;
  notes: string | null;
}
export type AssetInput = Omit<AssetRow, 'id'>;

export interface DepartmentRow {
  id: string;
  branchId: string | null;
  name: string;
}
export interface StaffRow {
  id: string;
  branchId: string;
  departmentId: string | null;
  fullName: string;
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}
export type StaffInput = Omit<StaffRow, 'id'>;

export type MaintenanceKind = 'INSPECTION' | 'REPAIR' | 'SERVICE';
export interface MaintenanceRow {
  id: string;
  assetId: string;
  branchId: string;
  performedOn: string;
  kind: MaintenanceKind;
  cost: string;
  notes: string | null;
  nextDueOn: string | null;
}
export type MaintenanceInput = Omit<MaintenanceRow, 'id'>;

export type Write<T> = { kind: 'ok'; value: T } | { kind: 'not_found' } | { kind: 'duplicate' } | { kind: 'in_use' };

export interface InstituteRepository {
  memberOf(tenantId: string, userId: string): Promise<{ role: InstituteRole; branchId: string | null } | null>;

  listBranches(tenantId: string, branchId: string | null): Promise<BranchRow[]>;
  getBranch(tenantId: string, id: string): Promise<BranchRow | null>;
  createBranch(tenantId: string, actor: Actor, input: BranchInput): Promise<Write<BranchRow>>;
  updateBranch(tenantId: string, actor: Actor, id: string, input: BranchInput): Promise<Write<BranchRow>>;

  listMembers(tenantId: string): Promise<MemberRow[]>;
  /** The user is found by e-mail inside this academy; 'not_found' when nobody has that address. */
  saveMember(tenantId: string, actor: Actor, input: { email: string; role: InstituteRole; branchId: string | null }): Promise<Write<MemberRow>>;
  removeMember(tenantId: string, actor: Actor, userId: string): Promise<boolean>;

  listRooms(tenantId: string, branchId: string | null): Promise<RoomRow[]>;
  getRoom(tenantId: string, id: string): Promise<RoomRow | null>;
  createRoom(tenantId: string, actor: Actor, input: RoomInput): Promise<Write<RoomRow>>;
  updateRoom(tenantId: string, actor: Actor, id: string, input: RoomInput): Promise<Write<RoomRow>>;
  deleteRoom(tenantId: string, actor: Actor, id: string): Promise<Write<void>>;

  listAssets(tenantId: string, filter: { branchId: string | null; roomId?: string; status?: AssetStatus }): Promise<AssetRow[]>;
  getAsset(tenantId: string, id: string): Promise<AssetRow | null>;
  createAsset(tenantId: string, actor: Actor, input: AssetInput): Promise<Write<AssetRow>>;
  updateAsset(tenantId: string, actor: Actor, id: string, input: AssetInput): Promise<Write<AssetRow>>;
  deleteAsset(tenantId: string, actor: Actor, id: string): Promise<boolean>;
  /** Imports many assets in ONE transaction: all or nothing. */
  createAssets(tenantId: string, actor: Actor, inputs: AssetInput[]): Promise<number>;

  /** For a branch-bound caller: institute-wide departments plus their own branch's. */
  listDepartments(tenantId: string, branchId: string | null): Promise<DepartmentRow[]>;
  getDepartment(tenantId: string, id: string): Promise<DepartmentRow | null>;
  createDepartment(tenantId: string, actor: Actor, input: { branchId: string | null; name: string }): Promise<Write<DepartmentRow>>;
  deleteDepartment(tenantId: string, actor: Actor, id: string): Promise<Write<void>>;

  listStaff(tenantId: string, branchId: string | null): Promise<StaffRow[]>;
  getStaff(tenantId: string, id: string): Promise<StaffRow | null>;
  createStaff(tenantId: string, actor: Actor, input: StaffInput): Promise<Write<StaffRow>>;
  updateStaff(tenantId: string, actor: Actor, id: string, input: StaffInput): Promise<Write<StaffRow>>;
  deleteStaff(tenantId: string, actor: Actor, id: string): Promise<boolean>;

  listMaintenance(tenantId: string, assetId: string): Promise<MaintenanceRow[]>;
  addMaintenance(tenantId: string, actor: Actor, input: MaintenanceInput): Promise<Write<MaintenanceRow>>;
  /** The most recent maintenance entry of each asset (inside the branch scope). */
  latestMaintenance(tenantId: string, branchId: string | null): Promise<{ assetId: string; performedOn: string; nextDueOn: string | null }[]>;
}

const audit = (tx: Prisma.TransactionClient, tenantId: string, actor: Actor, action: string, entityId: string, metadata: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType: 'institute', entityId, metadata, ipAddress: actor.ip } });

const code = (err: unknown): string | null => (err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null);
/** P2002 unique violation, P2003 foreign-key violation (the composite keys also catch a room in another branch). */
const isUnique = (err: unknown) => code(err) === 'P2002';
/**
 * Foreign-key violation. Prisma reports P2003 for most, but PostgreSQL's RESTRICT on delete (SQLSTATE 23001) surfaces
 * as an unknown request error, so the database code in the message is checked too (otherwise a delete would be a 500).
 */
const isFk = (err: unknown) => {
  if (code(err) === 'P2003') return true;
  if (err instanceof Prisma.PrismaClientUnknownRequestError) return /23001|23503|violates RESTRICT|foreign key constraint/i.test(err.message);
  return false;
};

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

const toBranch = (b: { id: string; name: string; city: string | null; address: string | null; active: boolean }): BranchRow => ({ id: b.id, name: b.name, city: b.city, address: b.address, active: b.active });
const toRoom = (r: { id: string; branchId: string; name: string; kind: string; areaM2: Prisma.Decimal; capacity: number; powerKw: Prisma.Decimal; active: boolean }): RoomRow => ({
  id: r.id,
  branchId: r.branchId,
  name: r.name,
  kind: r.kind as RoomKind,
  areaM2: r.areaM2.toFixed(2),
  capacity: r.capacity,
  powerKw: r.powerKw.toFixed(2),
  active: r.active,
});
const toAsset = (a: {
  id: string;
  branchId: string;
  roomId: string | null;
  name: string;
  category: string | null;
  serialNo: string | null;
  purchaseDate: Date | null;
  purchaseValue: Prisma.Decimal;
  salvagePercent: Prisma.Decimal;
  usefulLifeMonths: number | null;
  status: string;
  notes: string | null;
}): AssetRow => ({
  id: a.id,
  branchId: a.branchId,
  roomId: a.roomId,
  name: a.name,
  category: a.category,
  serialNo: a.serialNo,
  purchaseDate: dateOnly(a.purchaseDate),
  purchaseValue: a.purchaseValue.toFixed(2),
  salvagePercent: a.salvagePercent.toFixed(2),
  usefulLifeMonths: a.usefulLifeMonths,
  status: a.status as AssetStatus,
  notes: a.notes,
});
const toDepartment = (d: { id: string; branchId: string | null; name: string }): DepartmentRow => ({ id: d.id, branchId: d.branchId, name: d.name });
const toStaff = (s: { id: string; branchId: string; departmentId: string | null; fullName: string; jobTitle: string | null; phone: string | null; email: string | null; active: boolean }): StaffRow => ({
  id: s.id,
  branchId: s.branchId,
  departmentId: s.departmentId,
  fullName: s.fullName,
  jobTitle: s.jobTitle,
  phone: s.phone,
  email: s.email,
  active: s.active,
});
const toMaintenance = (m: { id: string; assetId: string; branchId: string; performedOn: Date; kind: string; cost: Prisma.Decimal; notes: string | null; nextDueOn: Date | null }): MaintenanceRow => ({
  id: m.id,
  assetId: m.assetId,
  branchId: m.branchId,
  performedOn: dateOnly(m.performedOn) as string,
  kind: m.kind as MaintenanceKind,
  cost: m.cost.toFixed(2),
  notes: m.notes,
  nextDueOn: dateOnly(m.nextDueOn),
});
const assetData = (i: AssetInput) => ({
  branchId: i.branchId,
  roomId: i.roomId,
  name: i.name,
  category: i.category,
  serialNo: i.serialNo,
  purchaseDate: i.purchaseDate ? new Date(`${i.purchaseDate}T00:00:00Z`) : null,
  purchaseValue: new Prisma.Decimal(i.purchaseValue),
  salvagePercent: new Prisma.Decimal(i.salvagePercent),
  usefulLifeMonths: i.usefulLifeMonths,
  status: i.status,
  notes: i.notes,
});

export class PrismaInstituteRepository implements InstituteRepository {
  async memberOf(tenantId: string, userId: string) {
    const m = await forTenant(tenantId).instituteMember.findFirst({ where: { tenantId, userId }, select: { role: true, branchId: true } });
    return m ? { role: m.role as InstituteRole, branchId: m.branchId } : null;
  }

  async listBranches(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).branch.findMany({ where: { tenantId, ...(branchId ? { id: branchId } : {}) }, orderBy: { name: 'asc' } });
    return rows.map(toBranch);
  }
  async getBranch(tenantId: string, id: string) {
    const b = await forTenant(tenantId).branch.findFirst({ where: { tenantId, id } });
    return b ? toBranch(b) : null;
  }
  createBranch(tenantId: string, actor: Actor, input: BranchInput): Promise<Write<BranchRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const b = await tx.branch.create({ data: { tenantId, ...input } });
        await audit(tx, tenantId, actor, 'institute.branch_created', b.id, { name: b.name });
        return { kind: 'ok' as const, value: toBranch(b) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        throw e;
      }
    });
  }
  updateBranch(tenantId: string, actor: Actor, id: string, input: BranchInput): Promise<Write<BranchRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.branch.updateMany({ where: { tenantId, id }, data: input });
        if (count === 0) return { kind: 'not_found' as const };
        const b = await tx.branch.findFirstOrThrow({ where: { tenantId, id } });
        await audit(tx, tenantId, actor, 'institute.branch_updated', id, { ...input });
        return { kind: 'ok' as const, value: toBranch(b) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        throw e;
      }
    });
  }

  async listMembers(tenantId: string) {
    const rows = await forTenant(tenantId).instituteMember.findMany({ where: { tenantId }, include: { user: { select: { email: true, fullName: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ id: m.id, userId: m.userId, email: m.user.email, fullName: m.user.fullName, role: m.role as InstituteRole, branchId: m.branchId }));
  }
  saveMember(tenantId: string, actor: Actor, input: { email: string; role: InstituteRole; branchId: string | null }): Promise<Write<MemberRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, email: input.email.toLowerCase() }, select: { id: true, email: true, fullName: true } });
      if (!user) return { kind: 'not_found' as const };
      try {
        const m = await tx.instituteMember.upsert({
          where: { userId: user.id },
          create: { tenantId, userId: user.id, role: input.role, branchId: input.branchId },
          update: { role: input.role, branchId: input.branchId },
        });
        await audit(tx, tenantId, actor, 'institute.member_saved', user.id, { role: input.role, branchId: input.branchId });
        return { kind: 'ok' as const, value: { id: m.id, userId: user.id, email: user.email, fullName: user.fullName, role: input.role, branchId: m.branchId } };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  removeMember(tenantId: string, actor: Actor, userId: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.instituteMember.deleteMany({ where: { tenantId, userId } });
      if (count > 0) await audit(tx, tenantId, actor, 'institute.member_removed', userId, {});
      return count > 0;
    });
  }

  async listRooms(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).room.findMany({ where: { tenantId, ...(branchId ? { branchId } : {}) }, orderBy: [{ branchId: 'asc' }, { name: 'asc' }] });
    return rows.map(toRoom);
  }
  async getRoom(tenantId: string, id: string) {
    const r = await forTenant(tenantId).room.findFirst({ where: { tenantId, id } });
    return r ? toRoom(r) : null;
  }
  createRoom(tenantId: string, actor: Actor, input: RoomInput): Promise<Write<RoomRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const r = await tx.room.create({ data: { tenantId, ...input, areaM2: new Prisma.Decimal(input.areaM2), powerKw: new Prisma.Decimal(input.powerKw) } });
        await audit(tx, tenantId, actor, 'institute.room_created', r.id, { name: r.name, branchId: r.branchId });
        return { kind: 'ok' as const, value: toRoom(r) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  updateRoom(tenantId: string, actor: Actor, id: string, input: RoomInput): Promise<Write<RoomRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { branchId: _branch, ...rest } = input; // a room never changes branch
        const { count } = await tx.room.updateMany({ where: { tenantId, id }, data: { ...rest, areaM2: new Prisma.Decimal(input.areaM2), powerKw: new Prisma.Decimal(input.powerKw) } });
        if (count === 0) return { kind: 'not_found' as const };
        const r = await tx.room.findFirstOrThrow({ where: { tenantId, id } });
        await audit(tx, tenantId, actor, 'institute.room_updated', id, { name: r.name });
        return { kind: 'ok' as const, value: toRoom(r) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        throw e;
      }
    });
  }
  deleteRoom(tenantId: string, actor: Actor, id: string): Promise<Write<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.room.deleteMany({ where: { tenantId, id } });
        if (count === 0) return { kind: 'not_found' as const };
        await audit(tx, tenantId, actor, 'institute.room_deleted', id, {});
        return { kind: 'ok' as const, value: undefined };
      } catch (e) {
        if (isFk(e)) return { kind: 'in_use' as const };
        throw e;
      }
    });
  }

  async listAssets(tenantId: string, f: { branchId: string | null; roomId?: string; status?: AssetStatus }) {
    const rows = await forTenant(tenantId).asset.findMany({
      where: { tenantId, ...(f.branchId ? { branchId: f.branchId } : {}), ...(f.roomId ? { roomId: f.roomId } : {}), ...(f.status ? { status: f.status } : {}) },
      orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toAsset);
  }
  async getAsset(tenantId: string, id: string) {
    const a = await forTenant(tenantId).asset.findFirst({ where: { tenantId, id } });
    return a ? toAsset(a) : null;
  }
  createAsset(tenantId: string, actor: Actor, input: AssetInput): Promise<Write<AssetRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const a = await tx.asset.create({ data: { tenantId, ...assetData(input) } });
        await audit(tx, tenantId, actor, 'institute.asset_created', a.id, { name: a.name, branchId: a.branchId });
        return { kind: 'ok' as const, value: toAsset(a) };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  updateAsset(tenantId: string, actor: Actor, id: string, input: AssetInput): Promise<Write<AssetRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.asset.updateMany({ where: { tenantId, id }, data: assetData(input) });
        if (count === 0) return { kind: 'not_found' as const };
        const a = await tx.asset.findFirstOrThrow({ where: { tenantId, id } });
        await audit(tx, tenantId, actor, 'institute.asset_updated', id, { name: a.name, status: a.status });
        return { kind: 'ok' as const, value: toAsset(a) };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteAsset(tenantId: string, actor: Actor, id: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.asset.deleteMany({ where: { tenantId, id } });
      if (count > 0) await audit(tx, tenantId, actor, 'institute.asset_deleted', id, {});
      return count > 0;
    });
  }

  createAssets(tenantId: string, actor: Actor, inputs: AssetInput[]): Promise<number> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.asset.createMany({ data: inputs.map((i) => ({ tenantId, ...assetData(i) })) });
      await audit(tx, tenantId, actor, 'institute.assets_imported', tenantId, { count });
      return count;
    });
  }

  async listDepartments(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).department.findMany({
      where: { tenantId, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
      orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDepartment);
  }
  async getDepartment(tenantId: string, id: string) {
    const d = await forTenant(tenantId).department.findFirst({ where: { tenantId, id } });
    return d ? toDepartment(d) : null;
  }
  createDepartment(tenantId: string, actor: Actor, input: { branchId: string | null; name: string }): Promise<Write<DepartmentRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const d = await tx.department.create({ data: { tenantId, ...input } });
        await audit(tx, tenantId, actor, 'institute.department_created', d.id, { name: d.name, branchId: d.branchId });
        return { kind: 'ok' as const, value: toDepartment(d) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteDepartment(tenantId: string, actor: Actor, id: string): Promise<Write<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.department.deleteMany({ where: { tenantId, id } });
        if (count === 0) return { kind: 'not_found' as const };
        await audit(tx, tenantId, actor, 'institute.department_deleted', id, {});
        return { kind: 'ok' as const, value: undefined };
      } catch (e) {
        if (isFk(e)) return { kind: 'in_use' as const };
        throw e;
      }
    });
  }

  async listStaff(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).staff.findMany({ where: { tenantId, ...(branchId ? { branchId } : {}) }, orderBy: [{ branchId: 'asc' }, { fullName: 'asc' }] });
    return rows.map(toStaff);
  }
  async getStaff(tenantId: string, id: string) {
    const s = await forTenant(tenantId).staff.findFirst({ where: { tenantId, id } });
    return s ? toStaff(s) : null;
  }
  createStaff(tenantId: string, actor: Actor, input: StaffInput): Promise<Write<StaffRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const s = await tx.staff.create({ data: { tenantId, ...input } });
        await audit(tx, tenantId, actor, 'institute.staff_created', s.id, { branchId: s.branchId });
        return { kind: 'ok' as const, value: toStaff(s) };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  updateStaff(tenantId: string, actor: Actor, id: string, input: StaffInput): Promise<Write<StaffRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { branchId: _b, ...rest } = input; // staff never change branch through an edit
        const { count } = await tx.staff.updateMany({ where: { tenantId, id }, data: rest });
        if (count === 0) return { kind: 'not_found' as const };
        const s = await tx.staff.findFirstOrThrow({ where: { tenantId, id } });
        await audit(tx, tenantId, actor, 'institute.staff_updated', id, { active: s.active });
        return { kind: 'ok' as const, value: toStaff(s) };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteStaff(tenantId: string, actor: Actor, id: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.staff.deleteMany({ where: { tenantId, id } });
      if (count > 0) await audit(tx, tenantId, actor, 'institute.staff_deleted', id, {});
      return count > 0;
    });
  }

  async listMaintenance(tenantId: string, assetId: string) {
    const rows = await forTenant(tenantId).assetMaintenance.findMany({ where: { tenantId, assetId }, orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }] });
    return rows.map(toMaintenance);
  }
  addMaintenance(tenantId: string, actor: Actor, input: MaintenanceInput): Promise<Write<MaintenanceRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const m = await tx.assetMaintenance.create({
          data: {
            tenantId,
            branchId: input.branchId,
            assetId: input.assetId,
            performedOn: new Date(`${input.performedOn}T00:00:00Z`),
            kind: input.kind,
            cost: new Prisma.Decimal(input.cost),
            notes: input.notes,
            nextDueOn: input.nextDueOn ? new Date(`${input.nextDueOn}T00:00:00Z`) : null,
          },
        });
        await audit(tx, tenantId, actor, 'institute.maintenance_logged', m.id, { assetId: m.assetId, kind: m.kind });
        return { kind: 'ok' as const, value: toMaintenance(m) };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  async latestMaintenance(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).assetMaintenance.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
      select: { assetId: true, performedOn: true, nextDueOn: true },
    });
    const seen = new Set<string>();
    const out: { assetId: string; performedOn: string; nextDueOn: string | null }[] = [];
    for (const m of rows) {
      if (seen.has(m.assetId)) continue;
      seen.add(m.assetId);
      out.push({ assetId: m.assetId, performedOn: dateOnly(m.performedOn) as string, nextDueOn: dateOnly(m.nextDueOn) });
    }
    return out;
  }
}
