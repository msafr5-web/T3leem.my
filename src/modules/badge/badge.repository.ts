import { prisma, withTenantTransaction } from '../../config/database';
import type { BadgeRepository, BadgeState, PublicBadge } from './badge.service';

const state = (b: { token: string; enabled: boolean }): BadgeState => ({ token: b.token, enabled: b.enabled });

/**
 * trainee_badges is a global lookup (no RLS: the public page has no tenant), so every query here names the tenant AND the user
 * explicitly; the certificates behind a badge are read under that academy's own isolation.
 */
export class PrismaBadgeRepository implements BadgeRepository {
  async find(tenantId: string, userId: string): Promise<BadgeState | null> {
    const b = await prisma.traineeBadge.findFirst({ where: { tenantId, userId }, select: { token: true, enabled: true } });
    return b ? state(b) : null;
  }

  async enable(tenantId: string, userId: string, newToken: string): Promise<BadgeState> {
    const existing = await prisma.traineeBadge.findFirst({ where: { tenantId, userId }, select: { id: true } });
    if (existing) return state(await prisma.traineeBadge.update({ where: { id: existing.id }, data: { enabled: true }, select: { token: true, enabled: true } }));
    return state(await prisma.traineeBadge.create({ data: { tenantId, userId, token: newToken }, select: { token: true, enabled: true } }));
  }

  async disable(tenantId: string, userId: string): Promise<boolean> {
    return (await prisma.traineeBadge.updateMany({ where: { tenantId, userId }, data: { enabled: false } })).count > 0;
  }

  async regenerate(tenantId: string, userId: string, newToken: string): Promise<BadgeState> {
    const existing = await prisma.traineeBadge.findFirst({ where: { tenantId, userId }, select: { id: true } });
    if (existing) return state(await prisma.traineeBadge.update({ where: { id: existing.id }, data: { token: newToken, enabled: true }, select: { token: true, enabled: true } }));
    return state(await prisma.traineeBadge.create({ data: { tenantId, userId, token: newToken }, select: { token: true, enabled: true } }));
  }

  async publicView(token: string): Promise<PublicBadge | null> {
    const badge = await prisma.traineeBadge.findUnique({ where: { token }, select: { tenantId: true, userId: true, enabled: true } });
    if (!badge || !badge.enabled) return null;
    const tenant = await prisma.tenant.findUnique({ where: { id: badge.tenantId }, select: { name: true, slug: true, status: true } });
    if (!tenant || tenant.status !== 'ACTIVE') return null;
    return withTenantTransaction(badge.tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId: badge.tenantId, id: badge.userId }, select: { fullName: true, email: true } });
      if (!user) return null;
      const certs = await tx.certificate.findMany({
        where: { tenantId: badge.tenantId, enrollment: { userId: badge.userId } },
        orderBy: { issuedAt: 'desc' },
        select: { certificateCode: true, issuedAt: true, enrollment: { select: { course: { select: { title: true } } } } },
      });
      return {
        name: user.fullName ?? user.email.split('@')[0] ?? user.email,
        academy: { name: tenant.name, slug: tenant.slug },
        certificates: certs.map((c) => ({ code: c.certificateCode, courseTitle: c.enrollment.course.title, issuedAt: c.issuedAt })),
      };
    });
  }
}
