import type { ContentType, CourseType, Prisma } from '@prisma/client';
import { forTenant } from '../../../config/database';

export interface CourseTrainerRow {
  id: string;
  fullName: string;
  specialization: string | null;
  bio: string | null;
}

export interface CourseSummaryRow {
  id: string;
  title: string;
  type: CourseType;
  priceHalalas: number;
  trainingHours: number | null;
  durationDays: number | null;
  accreditationNumber: string | null;
  trainerName: string;
  moduleCount: number;
  lessonCount: number;
}

export interface CourseDetailRow extends CourseSummaryRow {
  description: string | null;
  licenseNumber: string | null;
  licenseAuthority: string | null;
  /** YYYY-MM-DD */
  licenseExpiresOn: string | null;
  trainer: CourseTrainerRow;
  modules: { id: string; title: string; lessons: { id: string; title: string; contentType: ContentType }[] }[];
  /** Recorded (YouTube) courses: the source channel and when day 1 opens. */
  recorded?: { channelUrl: string | null; channelName: string | null; startsAt: Date | null } | null;
}

export interface CourseCatalogRepository {
  listPublished(tenantId: string): Promise<CourseSummaryRow[]>;
  findPublished(tenantId: string, courseId: string): Promise<CourseDetailRow | null>;
}

export const toHalalas = (price: Prisma.Decimal): number => price.mul(100).toDecimalPlaces(0).toNumber();
export const toDateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

const summarySelect = {
  id: true,
  title: true,
  type: true,
  price: true,
  trainingHours: true,
  durationDays: true,
  accreditationNumber: true,
  trainer: { select: { fullName: true } },
} as const;

/**
 * Public catalog reads. Only published courses are ever returned, and media URLs are never
 * selected here — protected content goes through the signed HLS endpoints, not the catalog.
 */
export class PrismaCourseCatalogRepository implements CourseCatalogRepository {
  async listPublished(tenantId: string): Promise<CourseSummaryRow[]> {
    const courses = await forTenant(tenantId).course.findMany({
      where: { tenantId, isPublished: true },
      orderBy: { createdAt: 'asc' },
      select: { ...summarySelect, modules: { select: { _count: { select: { lessons: true } } } } },
    });
    return courses.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      priceHalalas: toHalalas(c.price),
      trainingHours: c.trainingHours?.toNumber() ?? null,
      durationDays: c.durationDays,
      accreditationNumber: c.accreditationNumber,
      trainerName: c.trainer.fullName,
      moduleCount: c.modules.length,
      lessonCount: c.modules.reduce((sum, m) => sum + m._count.lessons, 0),
    }));
  }

  async findPublished(tenantId: string, courseId: string): Promise<CourseDetailRow | null> {
    const c = await forTenant(tenantId).course.findFirst({
      where: { id: courseId, tenantId, isPublished: true },
      select: {
        ...summarySelect,
        description: true,
        licenseNumber: true,
        licenseAuthority: true,
        licenseExpiresOn: true,
        sourceVideoId: true,
        sourceChannelUrl: true,
        sourceChannelName: true,
        scheduleStartsAt: true,
        trainer: { select: { id: true, fullName: true, specialization: true, bio: true } },
        modules: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, title: true, lessons: { select: { id: true, title: true, contentType: true } } },
        },
      },
    });
    if (!c) return null;
    return {
      id: c.id,
      title: c.title,
      type: c.type,
      priceHalalas: toHalalas(c.price),
      trainingHours: c.trainingHours?.toNumber() ?? null,
      durationDays: c.durationDays,
      accreditationNumber: c.accreditationNumber,
      trainerName: c.trainer.fullName,
      moduleCount: c.modules.length,
      lessonCount: c.modules.reduce((sum, m) => sum + m.lessons.length, 0),
      description: c.description,
      licenseNumber: c.licenseNumber,
      licenseAuthority: c.licenseAuthority,
      licenseExpiresOn: toDateOnly(c.licenseExpiresOn),
      trainer: c.trainer,
      modules: c.modules,
      recorded: c.sourceVideoId ? { channelUrl: c.sourceChannelUrl, channelName: c.sourceChannelName, startsAt: c.scheduleStartsAt } : null,
    };
  }
}
