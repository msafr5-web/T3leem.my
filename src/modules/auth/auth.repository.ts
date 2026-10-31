import type { UserRole } from '@prisma/client';
import { forTenant, prisma } from '../../config/database';
import type { LoginUser, OtpChallenge, OtpRepository, UserLookup } from './otp.service';

export interface AuthRepository extends UserLookup {
  /** Creates a LEARNER account. Throws a P2002 unique violation if the email exists in this academy. */
  createLearner(tenantId: string, data: { email: string; fullName: string; passwordHash: string }): Promise<{ id: string; email: string; role: UserRole }>;
}

/** Tenant-scoped through RLS: the same email in another academy is a different account. */
export class PrismaAuthRepository implements AuthRepository {
  findUser(tenantId: string, email: string): Promise<LoginUser | null> {
    return forTenant(tenantId).user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true, email: true, role: true, fullName: true },
    });
  }

  createLearner(tenantId: string, data: { email: string; fullName: string; passwordHash: string }): Promise<{ id: string; email: string; role: UserRole }> {
    return forTenant(tenantId).user.create({
      data: { tenantId, ...data, role: 'LEARNER' },
      select: { id: true, email: true, role: true },
    });
  }
}

/** One-time sign-in codes (platform-level table; every query names the tenant explicitly). */
export class PrismaOtpRepository implements OtpRepository {
  async create(row: { tenantId: string | null; email: string; userId: string | null; expiresAt: Date }): Promise<string> {
    const created = await prisma.loginOtp.create({ data: { ...row, codeHash: '' }, select: { id: true } });
    return created.id;
  }

  find(id: string): Promise<OtpChallenge | null> {
    return prisma.loginOtp.findUnique({ where: { id } });
  }

  async bumpAttempts(id: string): Promise<void> {
    await prisma.loginOtp.updateMany({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  async setCode(id: string, codeHash: string, expiresAt: Date, isResend: boolean): Promise<void> {
    await prisma.loginOtp.updateMany({
      where: { id },
      data: { codeHash, expiresAt, attempts: 0, lastSentAt: new Date(), ...(isResend ? { sends: { increment: 1 } } : {}) },
    });
  }

  async delete(id: string): Promise<boolean> {
    return (await prisma.loginOtp.deleteMany({ where: { id } })).count === 1;
  }

  countRecent(tenantId: string | null, email: string, since: Date): Promise<number> {
    return prisma.loginOtp.count({ where: { tenantId, email, createdAt: { gte: since } } });
  }

  async purgeExpired(before: Date): Promise<void> {
    await prisma.loginOtp.deleteMany({ where: { expiresAt: { lt: before } } });
  }
}
