import { randomUUID } from 'node:crypto';
import type { InstituteRole } from '../../../src/modules/institute/institute.access';
import type {
  AssetRow,
  BranchRow,
  DepartmentRow,
  MaintenanceRow,
  StaffRow,
  InstituteRepository,
  MemberRow,
  RoomRow,
  Write,
} from '../../../src/modules/institute/institute.repository';
import { InstituteService } from '../../../src/modules/institute/institute.service';

/** In-memory repository that mirrors the database rules (unique names, same-tenant links, delete restrictions). */
export function buildInstituteFakes(users: Record<string, { tenantId: string; email: string; fullName: string }>) {
  const branches = new Map<string, BranchRow & { tenantId: string }>();
  const members = new Map<string, MemberRow & { tenantId: string }>();
  const rooms = new Map<string, RoomRow & { tenantId: string }>();
  const assets = new Map<string, AssetRow & { tenantId: string }>();
  const departments = new Map<string, DepartmentRow & { tenantId: string }>();
  const staff = new Map<string, StaffRow & { tenantId: string }>();
  const maintenance = new Map<string, MaintenanceRow & { tenantId: string; createdAt: number }>();
  let seq = 0;
  const audit: { tenantId: string; action: string; entityId: string }[] = [];

  const of = <T extends { tenantId: string }>(m: Map<string, T>, tenantId: string) => [...m.values()].filter((r) => r.tenantId === tenantId);
  const strip = <T extends { tenantId: string }>({ tenantId: _t, ...rest }: T): Omit<T, 'tenantId'> => rest;

  const repository: InstituteRepository = {
    memberOf: async (t, userId) => {
      const m = of(members, t).find((x) => x.userId === userId);
      return m ? { role: m.role, branchId: m.branchId } : null;
    },

    listBranches: async (t, branchId) => of(branches, t).filter((b) => !branchId || b.id === branchId).map((b) => strip(b) as BranchRow),
    getBranch: async (t, id) => {
      const b = branches.get(id);
      return b && b.tenantId === t ? (strip(b) as BranchRow) : null;
    },
    createBranch: async (t, a, input) => {
      if (of(branches, t).some((b) => b.name === input.name)) return { kind: 'duplicate' };
      const row = { id: randomUUID(), tenantId: t, ...input };
      branches.set(row.id, row);
      audit.push({ tenantId: t, action: 'institute.branch_created', entityId: row.id });
      return { kind: 'ok', value: strip(row) as BranchRow };
    },
    updateBranch: async (t, _a, id, input) => {
      const b = branches.get(id);
      if (!b || b.tenantId !== t) return { kind: 'not_found' };
      if (of(branches, t).some((x) => x.id !== id && x.name === input.name)) return { kind: 'duplicate' };
      Object.assign(b, input);
      return { kind: 'ok', value: strip(b) as BranchRow };
    },

    listMembers: async (t) => of(members, t).map((m) => strip(m) as MemberRow),
    saveMember: async (t, _a, input) => {
      const u = Object.entries(users).find(([, v]) => v.tenantId === t && v.email === input.email.toLowerCase());
      if (!u) return { kind: 'not_found' };
      const [userId, info] = u;
      const existing = of(members, t).find((m) => m.userId === userId);
      const row = { id: existing?.id ?? randomUUID(), tenantId: t, userId, email: info.email, fullName: info.fullName, role: input.role as InstituteRole, branchId: input.branchId };
      members.set(row.id, row);
      return { kind: 'ok', value: strip(row) as MemberRow };
    },
    removeMember: async (t, _a, userId) => {
      const m = of(members, t).find((x) => x.userId === userId);
      if (!m) return false;
      members.delete(m.id);
      return true;
    },

    listRooms: async (t, branchId) => of(rooms, t).filter((r) => !branchId || r.branchId === branchId).map((r) => strip(r) as RoomRow),
    getRoom: async (t, id) => {
      const r = rooms.get(id);
      return r && r.tenantId === t ? (strip(r) as RoomRow) : null;
    },
    createRoom: async (t, _a, input) => {
      const br = branches.get(input.branchId);
      if (!br || br.tenantId !== t) return { kind: 'not_found' };
      if (of(rooms, t).some((r) => r.branchId === input.branchId && r.name === input.name)) return { kind: 'duplicate' };
      const row = { id: randomUUID(), tenantId: t, ...input };
      rooms.set(row.id, row);
      return { kind: 'ok', value: strip(row) as RoomRow };
    },
    updateRoom: async (t, _a, id, input) => {
      const r = rooms.get(id);
      if (!r || r.tenantId !== t) return { kind: 'not_found' };
      if (of(rooms, t).some((x) => x.id !== id && x.branchId === r.branchId && x.name === input.name)) return { kind: 'duplicate' };
      Object.assign(r, { ...input, branchId: r.branchId });
      return { kind: 'ok', value: strip(r) as RoomRow };
    },
    deleteRoom: async (t, _a, id): Promise<Write<void>> => {
      const r = rooms.get(id);
      if (!r || r.tenantId !== t) return { kind: 'not_found' };
      if (of(assets, t).some((a) => a.roomId === id)) return { kind: 'in_use' };
      rooms.delete(id);
      return { kind: 'ok', value: undefined };
    },

    listAssets: async (t, f) =>
      of(assets, t)
        .filter((a) => (!f.branchId || a.branchId === f.branchId) && (!f.roomId || a.roomId === f.roomId) && (!f.status || a.status === f.status))
        .map((a) => strip(a) as AssetRow),
    getAsset: async (t, id) => {
      const a = assets.get(id);
      return a && a.tenantId === t ? (strip(a) as AssetRow) : null;
    },
    createAsset: async (t, _a, input) => {
      const br = branches.get(input.branchId);
      if (!br || br.tenantId !== t) return { kind: 'not_found' };
      const row = { id: randomUUID(), tenantId: t, ...input };
      assets.set(row.id, row);
      return { kind: 'ok', value: strip(row) as AssetRow };
    },
    updateAsset: async (t, _a, id, input) => {
      const a = assets.get(id);
      if (!a || a.tenantId !== t) return { kind: 'not_found' };
      Object.assign(a, input);
      return { kind: 'ok', value: strip(a) as AssetRow };
    },
    deleteAsset: async (t, _a, id) => {
      const a = assets.get(id);
      if (!a || a.tenantId !== t) return false;
      assets.delete(id);
      for (const [k, m] of maintenance) if (m.assetId === id) maintenance.delete(k); // ON DELETE CASCADE
      return true;
    },
    createAssets: async (t, _a, inputs) => {
      for (const i of inputs) {
        const row = { id: randomUUID(), tenantId: t, ...i };
        assets.set(row.id, row);
      }
      return inputs.length;
    },

    listDepartments: async (t, branchId) => of(departments, t).filter((d) => !branchId || d.branchId === null || d.branchId === branchId).map((d) => strip(d) as DepartmentRow),
    getDepartment: async (t, id) => {
      const d = departments.get(id);
      return d && d.tenantId === t ? (strip(d) as DepartmentRow) : null;
    },
    createDepartment: async (t, _a, input) => {
      if (input.branchId && branches.get(input.branchId)?.tenantId !== t) return { kind: 'not_found' };
      if (of(departments, t).some((d) => d.branchId === input.branchId && d.name === input.name)) return { kind: 'duplicate' };
      const row = { id: randomUUID(), tenantId: t, ...input };
      departments.set(row.id, row);
      return { kind: 'ok', value: strip(row) as DepartmentRow };
    },
    deleteDepartment: async (t, _a, id): Promise<Write<void>> => {
      const d = departments.get(id);
      if (!d || d.tenantId !== t) return { kind: 'not_found' };
      if (of(staff, t).some((s) => s.departmentId === id)) return { kind: 'in_use' };
      departments.delete(id);
      return { kind: 'ok', value: undefined };
    },

    listStaff: async (t, branchId) => of(staff, t).filter((s) => !branchId || s.branchId === branchId).map((s) => strip(s) as StaffRow),
    getStaff: async (t, id) => {
      const s = staff.get(id);
      return s && s.tenantId === t ? (strip(s) as StaffRow) : null;
    },
    createStaff: async (t, _a, input) => {
      if (branches.get(input.branchId)?.tenantId !== t) return { kind: 'not_found' };
      const row = { id: randomUUID(), tenantId: t, ...input };
      staff.set(row.id, row);
      return { kind: 'ok', value: strip(row) as StaffRow };
    },
    updateStaff: async (t, _a, id, input) => {
      const s = staff.get(id);
      if (!s || s.tenantId !== t) return { kind: 'not_found' };
      Object.assign(s, { ...input, branchId: s.branchId });
      return { kind: 'ok', value: strip(s) as StaffRow };
    },
    deleteStaff: async (t, _a, id) => {
      const s = staff.get(id);
      if (!s || s.tenantId !== t) return false;
      staff.delete(id);
      return true;
    },

    listMaintenance: async (t, assetId) =>
      of(maintenance, t)
        .filter((m) => m.assetId === assetId)
        .sort((a, b) => (a.performedOn === b.performedOn ? b.createdAt - a.createdAt : a.performedOn < b.performedOn ? 1 : -1))
        .map(({ tenantId: _t, createdAt: _c, ...m }) => m as MaintenanceRow),
    addMaintenance: async (t, _a, input) => {
      const asset = assets.get(input.assetId);
      if (!asset || asset.tenantId !== t || asset.branchId !== input.branchId) return { kind: 'not_found' };
      const row = { id: randomUUID(), tenantId: t, createdAt: ++seq, ...input };
      maintenance.set(row.id, row);
      const { tenantId: _t, createdAt: _c, ...out } = row;
      return { kind: 'ok', value: out as MaintenanceRow };
    },
    latestMaintenance: async (t, branchId) => {
      const latest = new Map<string, MaintenanceRow & { createdAt: number }>();
      for (const m of of(maintenance, t).filter((x) => !branchId || x.branchId === branchId)) {
        const cur = latest.get(m.assetId);
        if (!cur || m.performedOn > cur.performedOn || (m.performedOn === cur.performedOn && m.createdAt > cur.createdAt)) latest.set(m.assetId, m);
      }
      return [...latest.values()].map((m) => ({ assetId: m.assetId, performedOn: m.performedOn, nextDueOn: m.nextDueOn }));
    },
  };

  return { service: new InstituteService(repository), repository, members, audit };
}
