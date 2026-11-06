/**
 * Who may do what inside an institute. Pure functions (no I/O) so the whole matrix is unit-tested.
 *
 * Institute roles live in `institute_members`, separate from the platform-wide `UserRole`:
 * the academy admin (TENANT_ADMIN) is implicitly HQ (senior management, every branch); everyone else
 * needs a membership row. Branch scope is applied in the query by the service, never by the browser.
 */
export const INSTITUTE_ROLES = ['HQ', 'BRANCH_MANAGER', 'FINANCE', 'STUDENT_AFFAIRS', 'INSTRUCTOR'] as const;
export type InstituteRole = (typeof INSTITUTE_ROLES)[number];

/** Roles that must be tied to one branch (others see every branch). */
export const BRANCH_BOUND_ROLES: readonly InstituteRole[] = ['BRANCH_MANAGER', 'STUDENT_AFFAIRS'];

export interface Principal {
  userId: string;
  role: InstituteRole;
  /** Null = every branch. */
  branchId: string | null;
}

export type Resource = 'branch' | 'member' | 'room' | 'asset';
export type Action = 'read' | 'write';

const MATRIX: Record<Resource, Record<Action, readonly InstituteRole[]>> = {
  branch: { read: INSTITUTE_ROLES, write: ['HQ'] },
  member: { read: ['HQ'], write: ['HQ'] },
  room: { read: INSTITUTE_ROLES, write: ['HQ', 'BRANCH_MANAGER', 'STUDENT_AFFAIRS'] },
  asset: { read: ['HQ', 'BRANCH_MANAGER', 'FINANCE', 'STUDENT_AFFAIRS'], write: ['HQ', 'BRANCH_MANAGER', 'STUDENT_AFFAIRS'] },
};

export const can = (role: InstituteRole, resource: Resource, action: Action): boolean => MATRIX[resource][action].includes(role);

/** Money fields are hidden from roles that run the floor but not the books. */
export const canSeeValues = (role: InstituteRole): boolean => role === 'HQ' || role === 'BRANCH_MANAGER' || role === 'FINANCE';

/** True when a record of `branchId` is inside the principal's scope. */
export const inScope = (p: Principal, branchId: string): boolean => p.branchId === null || p.branchId === branchId;

export const isInstituteRole = (v: unknown): v is InstituteRole => typeof v === 'string' && (INSTITUTE_ROLES as readonly string[]).includes(v);
