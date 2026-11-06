import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * One PrismaClient (one connection pool) per process. Tenant-scoped clients below are
 * lightweight `$extends` views over this pool — never `new PrismaClient()` per request,
 * which would open a fresh pool each time and exhaust PostgreSQL connections.
 */
export const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * Sets the RLS tenant for the current transaction only.
 *
 * `set_config(name, value, is_local => true)` is the function form of `SET LOCAL`, but unlike
 * `SET LOCAL ... = '${tenantId}'` it accepts a bound parameter, so a hostile x-tenant-id header
 * can never be spliced into SQL.
 */
/**
 * Branch scope (second RLS layer, institute module). A request that resolves a branch-bound role records the branches it may touch in
 * this per-request store (a mutable object shared by everything the request awaits); every database operation then carries it as
 * `app.branch_scope`, and RESTRICTIVE policies on the branch-owned tables enforce it. No store, or `null`, means every branch (head
 * office, finance, background jobs, the other modules).
 */
interface BranchScope {
  branchIds: string[] | null;
}
const branchScopeStorage = new AsyncLocalStorage<BranchScope>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs `fn` (and everything it awaits) with a fresh, unrestricted branch scope that `setBranchScope` can narrow. */
export const runWithBranchScope = <T>(fn: () => T): T => branchScopeStorage.run({ branchIds: null }, fn);

/** Narrows the current request to these branches (null = all). A no-op outside `runWithBranchScope`. */
export function setBranchScope(branchIds: string[] | null): void {
  if (branchIds !== null && !branchIds.every((id) => UUID.test(id))) throw new Error('Branch scope must be a list of branch ids');
  const store = branchScopeStorage.getStore();
  if (store) store.branchIds = branchIds;
}
const currentBranchScope = (): string => branchScopeStorage.getStore()?.branchIds?.join(',') ?? '';

const setTenantContext = (client: Pick<PrismaClient, '$executeRaw'>, tenantId: string) =>
  client.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE), set_config('app.branch_scope', ${currentBranchScope()}, TRUE)`;

/**
 * Prisma Client Extension for dynamic RLS context injection (SWET §3).
 *
 * Each model operation is wrapped in a batch transaction: [set tenant, run query]. Because the
 * setting is transaction-local, it is discarded when the connection returns to the pool, so a
 * pooled connection can never carry tenant A's context into tenant B's request.
 *
 * Use for single reads/writes. For multi-statement units of work use `withTenantTransaction`.
 */
export function forTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([setTenantContext(prisma, tenantId), query(args)]);
          return result;
        },
      },
    },
  });
}

export type TenantPrismaClient = ReturnType<typeof forTenant>;

/**
 * Interactive transaction bound to a tenant — the Unit of Work for operations that must commit
 * or roll back together (e.g. enrollment + invoice). Every statement issued through `tx`
 * runs under the same RLS context.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setTenantContext(tx, tenantId);
    return work(tx);
  });
}
