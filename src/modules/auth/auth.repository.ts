import type { UserRole } from '@prisma/client';
import { forTenant } from '../../config/database';

export interface LoginCandidate {
  id: string;
  email: string;
  role: UserRole;
  passwordHash: string;
}

export interface AuthRepository {
  findByEmail(tenantId: string, email: string): Promise<LoginCandidate | null>;
}

/** Tenant-scoped through RLS: the same email in another academy is a different account. */
export class PrismaAuthRepository implements AuthRepository {
  findByEmail(tenantId: string, email: string): Promise<LoginCandidate | null> {
    return forTenant(tenantId).user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true, email: true, role: true, passwordHash: true },
    });
  }
}
