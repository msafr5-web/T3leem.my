import { randomUUID } from 'node:crypto';
import type { InstituteRole } from '../../../src/modules/institute/institute.access';
import type {
  AssetRow,
  BranchRow,
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
      return true;
    },
  };

  return { service: new InstituteService(repository), repository, members, audit };
}
