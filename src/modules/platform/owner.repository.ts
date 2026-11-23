import { Prisma, type PrismaClient } from '@prisma/client';
import { withTenantTransaction } from '../../config/database';
import { PLATFORM_OWNER_ID } from '../auth/otp.service';
import type { EraseOutcome, Features, OwnerRepository, OwnerTenantRow, OwnerTraineeRow, PlanRow, TenantPatch } from './owner.service';

const select = {
  id: true,
  slug: true,
  name: true,
  status: true,
  planId: true,
  approvedAt: true,
  subscriptionEndsAt: true,
  features: true,
  ownerName: true,
  ownerEmail: true,
  ownerPhone: true,
  createdAt: true,
  plan: { select: { name: true } },
} as const;

const toFeatures = (v: Prisma.JsonValue): Features => {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { health: o.health === true, recorded: o.recorded === true, institute: o.institute === true };
};

const toRow = (t: Prisma.TenantGetPayload<{ select: typeof select }>): OwnerTenantRow => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  status: t.status,
  planId: t.planId,
  planName: t.plan?.name ?? null,
  approvedAt: t.approvedAt,
  subscriptionEndsAt: t.subscriptionEndsAt,
  features: toFeatures(t.features),
  ownerName: t.ownerName,
  ownerEmail: t.ownerEmail,
  ownerPhone: t.ownerPhone,
  createdAt: t.createdAt,
});

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Platform-level access to tenants and plans: neither table is tenant-scoped, so no RLS context is involved. */
export class PrismaOwnerRepository implements OwnerRepository {
  constructor(private readonly db: PrismaClient) {}

  async listTenants(): Promise<OwnerTenantRow[]> {
    return (await this.db.tenant.findMany({ select, orderBy: { createdAt: 'desc' } })).map(toRow);
  }

  async getTenant(id: string): Promise<OwnerTenantRow | null> {
    const t = await this.db.tenant.findUnique({ where: { id }, select });
    return t ? toRow(t) : null;
  }

  async updateTenant(id: string, patch: TenantPatch): Promise<boolean> {
    const { features, ...rest } = patch;
    const { count } = await this.db.tenant.updateMany({ where: { id }, data: { ...rest, ...(features ? { features: features as unknown as Prisma.InputJsonValue } : {}) } });
    return count === 1;
  }

  async planExists(id: string): Promise<boolean> {
    return (await this.db.saasPlan.count({ where: { id } })) > 0;
  }

  async listPlans(): Promise<PlanRow[]> {
    const plans = await this.db.saasPlan.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { tenants: true } } } });
    return plans.map((p) => ({ id: p.id, name: p.name, maxStudents: p.maxStudents, maxStorageGb: p.maxStorageGb, monthlyPrice: Number(p.monthlyPrice), tenantCount: p._count.tenants }));
  }

  async createPlan(input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }) {
    try {
      const p = await this.db.saasPlan.create({ data: input, select: { id: true } });
      return { kind: 'ok', id: p.id } as const;
    } catch (err) {
      if (isUnique(err)) return { kind: 'duplicate' } as const;
      throw err;
    }
  }

  async updatePlan(id: string, input: { name: string; maxStudents: number; maxStorageGb: number; monthlyPrice: number }) {
    try {
      const { count } = await this.db.saasPlan.updateMany({ where: { id }, data: input });
      return count === 0 ? ('not_found' as const) : ('ok' as const);
    } catch (err) {
      if (isUnique(err)) return 'duplicate' as const;
      throw err;
    }
  }

  async deletePlan(id: string) {
    if ((await this.db.saasPlan.count({ where: { id } })) === 0) return 'not_found' as const;
    if ((await this.db.tenant.count({ where: { planId: id } })) > 0) return 'in_use' as const;
    await this.db.saasPlan.deleteMany({ where: { id } });
    return 'ok' as const;
  }

  listTrainees(tenantId: string): Promise<OwnerTraineeRow[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId, role: 'LEARNER' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, fullName: true, email: true, phone: true, employeeNo: true, createdAt: true, enrollments: { select: { _count: { select: { certificates: true } } } } },
      });
      return users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        employeeNo: u.employeeNo,
        enrollmentCount: u.enrollments.length,
        certificateCount: u.enrollments.reduce((n, e) => n + e._count.certificates, 0),
        createdAt: u.createdAt,
      }));
    });
  }

  /**
   * Full erasure of one trainee, in one transaction under the academy's RLS context (so it can only ever touch that academy).
   * What cascades in the database: lesson progress, quiz attempts, discussion posts, health practice and exam data.
   * What this removes by hand because the database would refuse or has no link: certificates and their public lookup
   * entries, enrollments, attendance rows, sign-in codes. Invoices stay (tax law): their link to the enrollment is cleared by
   * the database and they carry no personal details. Audit rows about this person are kept but their details are blanked.
   */
  eraseTrainee(tenantId: string, userId: string, confirmEmail: string): Promise<EraseOutcome> {
    return withTenantTransaction(tenantId, async (tx): Promise<EraseOutcome> => {
      const user = await tx.user.findFirst({ where: { tenantId, id: userId }, select: { id: true, email: true, role: true } });
      // Only learner accounts: this tool must never remove an academy's admin or trainer by mistake.
      if (!user || user.role !== 'LEARNER') return { kind: 'not_found' };
      if (user.email.toLowerCase() !== confirmEmail) return { kind: 'email_mismatch' };

      const enrollmentIds = (await tx.enrollment.findMany({ where: { tenantId, userId }, select: { id: true } })).map((e) => e.id);
      const certificateIds = (await tx.certificate.findMany({ where: { tenantId, enrollmentId: { in: enrollmentIds } }, select: { id: true } })).map((c) => c.id);

      const [quizAttempts, discussionPosts, invoicesKept] = await Promise.all([
        tx.quizAttempt.count({ where: { tenantId, userId } }),
        tx.discussionPost.count({ where: { tenantId, userId } }),
        tx.invoice.count({ where: { tenantId, userId } }),
      ]);

      await tx.certificateRegistry.deleteMany({ where: { tenantId, certificateId: { in: certificateIds } } });
      await tx.certificate.deleteMany({ where: { tenantId, id: { in: certificateIds } } });
      await tx.enrollment.deleteMany({ where: { tenantId, id: { in: enrollmentIds } } });
      const attendance = await tx.classroomAttendance.deleteMany({ where: { tenantId, OR: [{ userId }, { participantEmail: user.email }] } });
      await tx.loginOtp.deleteMany({ where: { tenantId, OR: [{ userId }, { email: user.email }] } });
      // Earlier audit entries about this person (e.g. "trainee created" with the e-mail) keep their place but lose their details.
      await tx.auditLog.updateMany({ where: { tenantId, entityType: 'user', entityId: userId }, data: { metadata: { redacted: true } } });
      await tx.user.delete({ where: { id: userId } });

      const summary = { enrollments: enrollmentIds.length, certificates: certificateIds.length, quizAttempts, discussionPosts, attendanceRecords: attendance.count, invoicesKept };
      await tx.auditLog.create({
        data: { tenantId, actorId: PLATFORM_OWNER_ID, actorRole: 'SUPER_ADMIN', action: 'trainee.erased', entityType: 'user', entityId: userId, metadata: summary },
      });
      return { kind: 'erased', summary };
    });
  }
}
