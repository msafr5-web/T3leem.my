import { UserRole } from '@prisma/client';
import { HttpError } from '../../shared/utils/http-error';
import type { Actor } from '../provider/provider.types';
import {
  BRANCH_BOUND_ROLES,
  can,
  canSeeValues,
  inScope,
  type Action,
  type InstituteRole,
  type Principal,
  type Resource,
} from './institute.access';
import type {
  AssetInput,
  AssetRow,
  AssetStatus,
  BranchInput,
  BranchRow,
  InstituteRepository,
  MemberRow,
  RoomInput,
  RoomRow,
  Write,
} from './institute.repository';

export interface Caller {
  userId: string;
  userRole: UserRole;
  ip: string | null;
}

/** Fields a role without financial access never receives. */
export type PublicAsset = Omit<AssetRow, 'purchaseValue' | 'salvagePercent' | 'usefulLifeMonths'> & Partial<Pick<AssetRow, 'purchaseValue' | 'salvagePercent' | 'usefulLifeMonths'>>;

export class InstituteService {
  constructor(private readonly repo: InstituteRepository) {}

  /**
   * The academy admin is HQ. Everyone else needs a membership row, otherwise the module is closed to them.
   * Done once per request on the server; the browser never states its own role or branch.
   */
  async principal(tenantId: string, caller: Caller): Promise<Principal> {
    if (caller.userRole === UserRole.TENANT_ADMIN) return { userId: caller.userId, role: 'HQ', branchId: null };
    const m = await this.repo.memberOf(tenantId, caller.userId);
    if (!m) throw HttpError.forbidden('You have no role in this institute');
    return { userId: caller.userId, role: m.role, branchId: m.branchId };
  }

  private allow(p: Principal, resource: Resource, action: Action): void {
    if (!can(p.role, resource, action)) throw HttpError.forbidden('Your institute role does not allow this');
  }
  private actor(c: Caller): Actor {
    return { userId: c.userId, role: c.userRole, ip: c.ip };
  }
  /** Out-of-scope records look exactly like missing ones, so ids cannot be probed across branches. */
  private static missing(what: string): HttpError {
    return HttpError.notFound(`${what.toUpperCase()}_NOT_FOUND`, `${what} not found`);
  }
  private static written<T>(r: Write<T>, what: string): T {
    switch (r.kind) {
      case 'ok':
        return r.value;
      case 'duplicate':
        throw HttpError.conflict(`${what.toUpperCase()}_EXISTS`, `A ${what} with this name already exists here`);
      case 'in_use':
        throw HttpError.conflict(`${what.toUpperCase()}_IN_USE`, `This ${what} is still referenced and cannot be deleted`);
      default:
        throw InstituteService.missing(what);
    }
  }

  async me(tenantId: string, c: Caller) {
    const p = await this.principal(tenantId, c);
    return { role: p.role, branchId: p.branchId, canWrite: { branch: can(p.role, 'branch', 'write'), member: can(p.role, 'member', 'write'), room: can(p.role, 'room', 'write'), asset: can(p.role, 'asset', 'write') } };
  }

  // ---- branches ----
  async listBranches(tenantId: string, c: Caller): Promise<BranchRow[]> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'branch', 'read');
    return this.repo.listBranches(tenantId, p.branchId);
  }
  async createBranch(tenantId: string, c: Caller, input: BranchInput): Promise<BranchRow> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'branch', 'write');
    return InstituteService.written(await this.repo.createBranch(tenantId, this.actor(c), input), 'branch');
  }
  async updateBranch(tenantId: string, c: Caller, id: string, input: BranchInput): Promise<BranchRow> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'branch', 'write');
    return InstituteService.written(await this.repo.updateBranch(tenantId, this.actor(c), id, input), 'branch');
  }

  // ---- members (HQ only) ----
  async listMembers(tenantId: string, c: Caller): Promise<MemberRow[]> {
    this.allow(await this.principal(tenantId, c), 'member', 'read');
    return this.repo.listMembers(tenantId);
  }
  async saveMember(tenantId: string, c: Caller, input: { email: string; role: InstituteRole; branchId: string | null }): Promise<MemberRow> {
    this.allow(await this.principal(tenantId, c), 'member', 'write');
    const bound = BRANCH_BOUND_ROLES.includes(input.role);
    if (bound && !input.branchId) throw HttpError.unprocessable('BRANCH_REQUIRED', 'This role must be tied to one branch');
    if (input.branchId && !(await this.repo.getBranch(tenantId, input.branchId))) throw InstituteService.missing('branch');
    // HQ and FINANCE span every branch, so any branch sent with them is ignored rather than silently narrowing them.
    const branchId = bound || input.role === 'INSTRUCTOR' ? input.branchId : null;
    return InstituteService.written(await this.repo.saveMember(tenantId, this.actor(c), { ...input, branchId }), 'user');
  }
  async removeMember(tenantId: string, c: Caller, userId: string): Promise<void> {
    this.allow(await this.principal(tenantId, c), 'member', 'write');
    if (!(await this.repo.removeMember(tenantId, this.actor(c), userId))) throw InstituteService.missing('member');
  }

  // ---- rooms ----
  async listRooms(tenantId: string, c: Caller, branchId?: string): Promise<RoomRow[]> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'room', 'read');
    const scope = this.scopeFilter(p, branchId);
    return scope === 'none' ? [] : this.repo.listRooms(tenantId, scope);
  }
  async createRoom(tenantId: string, c: Caller, input: RoomInput): Promise<RoomRow> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'room', 'write');
    await this.requireBranchInScope(tenantId, p, input.branchId);
    return InstituteService.written(await this.repo.createRoom(tenantId, this.actor(c), input), 'room');
  }
  async updateRoom(tenantId: string, c: Caller, id: string, input: RoomInput): Promise<RoomRow> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'room', 'write');
    const room = await this.repo.getRoom(tenantId, id);
    if (!room || !inScope(p, room.branchId)) throw InstituteService.missing('room');
    return InstituteService.written(await this.repo.updateRoom(tenantId, this.actor(c), id, input), 'room');
  }
  async deleteRoom(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'room', 'write');
    const room = await this.repo.getRoom(tenantId, id);
    if (!room || !inScope(p, room.branchId)) throw InstituteService.missing('room');
    InstituteService.written(await this.repo.deleteRoom(tenantId, this.actor(c), id), 'room');
  }

  // ---- assets ----
  async listAssets(tenantId: string, c: Caller, f: { branchId?: string; roomId?: string; status?: AssetStatus }): Promise<PublicAsset[]> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'asset', 'read');
    const scope = this.scopeFilter(p, f.branchId);
    if (scope === 'none') return [];
    return (await this.repo.listAssets(tenantId, { branchId: scope, roomId: f.roomId, status: f.status })).map((a) => this.redact(p, a));
  }
  async createAsset(tenantId: string, c: Caller, input: AssetInput): Promise<PublicAsset> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'asset', 'write');
    await this.requireBranchInScope(tenantId, p, input.branchId);
    await this.requireRoomInBranch(tenantId, input);
    return this.redact(p, InstituteService.written(await this.repo.createAsset(tenantId, this.actor(c), input), 'asset'));
  }
  async updateAsset(tenantId: string, c: Caller, id: string, input: AssetInput): Promise<PublicAsset> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'asset', 'write');
    const asset = await this.repo.getAsset(tenantId, id);
    if (!asset || !inScope(p, asset.branchId)) throw InstituteService.missing('asset');
    // An asset never moves between branches through an edit; only its room (inside the branch) and details change.
    const next = { ...input, branchId: asset.branchId };
    await this.requireRoomInBranch(tenantId, next);
    // A role that cannot see values must not be able to overwrite them with blanks either.
    const safe = canSeeValues(p.role) ? next : { ...next, purchaseValue: asset.purchaseValue, salvagePercent: asset.salvagePercent, usefulLifeMonths: asset.usefulLifeMonths };
    return this.redact(p, InstituteService.written(await this.repo.updateAsset(tenantId, this.actor(c), id, safe), 'asset'));
  }
  async deleteAsset(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.principal(tenantId, c);
    this.allow(p, 'asset', 'write');
    const asset = await this.repo.getAsset(tenantId, id);
    if (!asset || !inScope(p, asset.branchId)) throw InstituteService.missing('asset');
    await this.repo.deleteAsset(tenantId, this.actor(c), id);
  }

  // ---- helpers ----
  /** Branch filter for a list: the caller's own branch, or the requested one when it is inside the scope. */
  private scopeFilter(p: Principal, requested?: string): string | null | 'none' {
    if (p.branchId === null) return requested ?? null;
    return requested && requested !== p.branchId ? 'none' : p.branchId;
  }
  private async requireBranchInScope(tenantId: string, p: Principal, branchId: string): Promise<void> {
    if (!inScope(p, branchId) || !(await this.repo.getBranch(tenantId, branchId))) throw InstituteService.missing('branch');
  }
  private async requireRoomInBranch(tenantId: string, input: { roomId: string | null; branchId: string }): Promise<void> {
    if (!input.roomId) return;
    const room = await this.repo.getRoom(tenantId, input.roomId);
    if (!room || room.branchId !== input.branchId) throw HttpError.unprocessable('ROOM_BRANCH_MISMATCH', 'The room does not belong to the asset branch');
  }
  private redact(p: Principal, a: AssetRow): PublicAsset {
    if (canSeeValues(p.role)) return a;
    const { purchaseValue: _v, salvagePercent: _s, usefulLifeMonths: _l, ...rest } = a;
    return rest;
  }
}
