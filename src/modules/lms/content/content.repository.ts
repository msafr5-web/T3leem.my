import type { ContentType, HlsStatus, Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import type { Actor } from '../../provider/provider.types';

export interface ContentLesson {
  id: string;
  title: string;
  contentType: ContentType;
  sortOrder: number;
  mediaUrl: string | null;
  hlsStatus: HlsStatus;
  hlsError: string | null;
  durationSeconds: number | null;
  startSecond: number | null;
  endSecond: number | null;
}

export interface ContentModule {
  id: string;
  title: string;
  sortOrder: number;
  lessons: ContentLesson[];
}

export interface ContentRepository {
  getCourseContent(tenantId: string, courseId: string): Promise<ContentModule[] | null>;
  createModule(tenantId: string, actor: Actor, courseId: string, title: string): Promise<string | null>;
  updateModule(tenantId: string, actor: Actor, id: string, data: { title?: string; sortOrder?: number }): Promise<boolean>;
  /** Returns the ids of the lessons that were deleted with it (their media must be removed). */
  deleteModule(tenantId: string, actor: Actor, id: string): Promise<string[] | null>;
  createLesson(tenantId: string, actor: Actor, moduleId: string, data: { title: string; contentType: ContentType; mediaUrl: string | null }): Promise<string | null>;
  updateLesson(tenantId: string, actor: Actor, id: string, data: { title?: string; mediaUrl?: string | null; sortOrder?: number }): Promise<boolean>;
  deleteLesson(tenantId: string, actor: Actor, id: string): Promise<boolean>;
}

const audit = (tx: Prisma.TransactionClient, tenantId: string, actor: Actor, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType, entityId, metadata, ipAddress: actor.ip } });

export class PrismaContentRepository implements ContentRepository {
  async getCourseContent(tenantId: string, courseId: string): Promise<ContentModule[] | null> {
    const course = await forTenant(tenantId).course.findFirst({
      where: { tenantId, id: courseId },
      select: {
        modules: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            sortOrder: true,
            lessons: {
              orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
              select: { id: true, title: true, contentType: true, sortOrder: true, mediaUrl: true, hlsStatus: true, hlsError: true, durationSeconds: true, startSecond: true, endSecond: true },
            },
          },
        },
      },
    });
    return course ? course.modules : null;
  }

  createModule(tenantId: string, actor: Actor, courseId: string, title: string): Promise<string | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const course = await tx.course.findFirst({ where: { tenantId, id: courseId }, select: { id: true } });
      if (!course) return null;
      const last = await tx.module.aggregate({ where: { tenantId, courseId }, _max: { sortOrder: true } });
      const { id } = await tx.module.create({ data: { tenantId, courseId, title, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: { id: true } });
      await audit(tx, tenantId, actor, 'module.created', 'module', id, { courseId, title });
      return id;
    });
  }

  updateModule(tenantId: string, actor: Actor, id: string, data: { title?: string; sortOrder?: number }): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.module.updateMany({ where: { tenantId, id }, data });
      if (count) await audit(tx, tenantId, actor, 'module.updated', 'module', id, { fields: Object.keys(data) });
      return count > 0;
    });
  }

  deleteModule(tenantId: string, actor: Actor, id: string): Promise<string[] | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const mod = await tx.module.findFirst({ where: { tenantId, id }, select: { title: true, lessons: { select: { id: true } } } });
      if (!mod) return null;
      await tx.module.delete({ where: { id } }); // lessons + their progress cascade
      await audit(tx, tenantId, actor, 'module.deleted', 'module', id, { title: mod.title, lessons: mod.lessons.length });
      return mod.lessons.map((l) => l.id);
    });
  }

  createLesson(tenantId: string, actor: Actor, moduleId: string, data: { title: string; contentType: ContentType; mediaUrl: string | null }): Promise<string | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const mod = await tx.module.findFirst({ where: { tenantId, id: moduleId }, select: { id: true } });
      if (!mod) return null;
      const last = await tx.lesson.aggregate({ where: { tenantId, moduleId }, _max: { sortOrder: true } });
      const { id } = await tx.lesson.create({
        data: { tenantId, moduleId, ...data, sortOrder: (last._max.sortOrder ?? -1) + 1 },
        select: { id: true },
      });
      await audit(tx, tenantId, actor, 'lesson.created', 'lesson', id, { moduleId, title: data.title, contentType: data.contentType });
      return id;
    });
  }

  updateLesson(tenantId: string, actor: Actor, id: string, data: { title?: string; mediaUrl?: string | null; sortOrder?: number }): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.lesson.updateMany({ where: { tenantId, id }, data });
      if (count) await audit(tx, tenantId, actor, 'lesson.updated', 'lesson', id, { fields: Object.keys(data) });
      return count > 0;
    });
  }

  deleteLesson(tenantId: string, actor: Actor, id: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const lesson = await tx.lesson.findFirst({ where: { tenantId, id }, select: { title: true } });
      if (!lesson) return false;
      await tx.lesson.delete({ where: { id } });
      await audit(tx, tenantId, actor, 'lesson.deleted', 'lesson', id, { title: lesson.title });
      return true;
    });
  }
}
