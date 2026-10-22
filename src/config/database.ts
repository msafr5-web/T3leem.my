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
const setTenantContext = (client: Pick<PrismaClient, '$executeRaw'>, tenantId: string) =>
  client.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`;

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
