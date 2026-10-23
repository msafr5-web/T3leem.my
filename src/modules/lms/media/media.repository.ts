import type { ContentType, HlsStatus } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';

export interface MediaLesson {
  id: string;
  courseId: string;
  contentType: ContentType;
  hlsStatus: HlsStatus;
  hlsKeyEncrypted: string | null;
}

export interface MediaRepository {
  getLesson(tenantId: string, lessonId: string): Promise<MediaLesson | null>;
  setHls(
    tenantId: string,
    lessonId: string,
    data: { hlsStatus: HlsStatus; hlsKeyEncrypted?: string | null; hlsError?: string | null; durationSeconds?: number | null },
  ): Promise<void>;
  hasActiveEnrollment(tenantId: string, userId: string, courseId: string): Promise<boolean>;
  /** Puts a session recording into the course (module "تسجيلات الجلسات", created on demand). */
  createRecordingLesson(tenantId: string, courseId: string, title: string): Promise<string>;
  getClassroomCourse(tenantId: string, classroomId: string): Promise<{ courseId: string | null; title: string } | null>;
}

const RECORDINGS_MODULE = 'تسجيلات الجلسات';

export class PrismaMediaRepository implements MediaRepository {
  async getLesson(tenantId: string, lessonId: string): Promise<MediaLesson | null> {
    const l = await forTenant(tenantId).lesson.findFirst({
      where: { tenantId, id: lessonId },
      select: { id: true, contentType: true, hlsStatus: true, hlsKeyEncrypted: true, module: { select: { courseId: true } } },
    });
    return l ? { id: l.id, courseId: l.module.courseId, contentType: l.contentType, hlsStatus: l.hlsStatus, hlsKeyEncrypted: l.hlsKeyEncrypted } : null;
  }

  async setHls(tenantId: string, lessonId: string, data: Parameters<MediaRepository['setHls']>[2]): Promise<void> {
    await forTenant(tenantId).lesson.updateMany({ where: { tenantId, id: lessonId }, data });
  }

  async hasActiveEnrollment(tenantId: string, userId: string, courseId: string): Promise<boolean> {
    const e = await forTenant(tenantId).enrollment.findUnique({
      where: { tenantId_userId_courseId: { tenantId, userId, courseId } },
      select: { status: true },
    });
    return e?.status === 'ACTIVE';
  }

  createRecordingLesson(tenantId: string, courseId: string, title: string): Promise<string> {
    return withTenantTransaction(tenantId, async (tx) => {
      let mod = await tx.module.findFirst({ where: { tenantId, courseId, title: RECORDINGS_MODULE }, select: { id: true } });
      if (!mod) {
        const last = await tx.module.aggregate({ where: { tenantId, courseId }, _max: { sortOrder: true } });
        mod = await tx.module.create({
          data: { tenantId, courseId, title: RECORDINGS_MODULE, sortOrder: (last._max.sortOrder ?? -1) + 1 },
          select: { id: true },
        });
      }
      const lastLesson = await tx.lesson.aggregate({ where: { tenantId, moduleId: mod.id }, _max: { sortOrder: true } });
      const lesson = await tx.lesson.create({
        data: { tenantId, moduleId: mod.id, title, contentType: 'VIDEO', sortOrder: (lastLesson._max.sortOrder ?? -1) + 1, hlsStatus: 'PROCESSING' },
        select: { id: true },
      });
      return lesson.id;
    });
  }

  async getClassroomCourse(tenantId: string, classroomId: string): Promise<{ courseId: string | null; title: string } | null> {
    return forTenant(tenantId).virtualClassroom.findFirst({ where: { tenantId, id: classroomId }, select: { courseId: true, title: true } });
  }
}
