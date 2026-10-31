import { Prisma, type PrismaClient } from '@prisma/client';
import type { Features, OwnerRepository, OwnerTenantRow, PlanRow, TenantPatch } from './owner.service';

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
  return { health: o.health === true, recorded: o.recorded === true };
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
}
