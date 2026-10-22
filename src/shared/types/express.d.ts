import type { Prisma, TenantStatus, UserRole } from '@prisma/client';
import type { TenantPrismaClient } from '../../config/database';

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  legalName: string | null;
  vatNumber: string | null;
  brandSettings: Prisma.JsonValue;
  /** Date from the DB; an ISO string when read back from the Redis cache. */
  logoUpdatedAt: Date | string | null;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantId?: string;
      tenant?: ResolvedTenant;
      /** RLS-scoped Prisma client for this request's tenant. */
      db?: TenantPrismaClient;
      user?: AuthenticatedUser;
    }
  }
}
