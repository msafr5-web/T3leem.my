import type { ContentType, CourseType, Prisma } from '@prisma/client';
import { forTenant } from '../../../config/database';

export interface CourseSummaryRow {
  id: string;
  title: string;
  type: CourseType;
  priceHalalas: number;
  moduleCount: number;
  lessonCount: number;
}

export interface CourseDetailRow extends CourseSummaryRow {
  modules: { id: string; title: string; lessons: { id: string; title: string; contentType: ContentType }[] }[];
}

export interface CourseCatalogRepository {
  listPublished(tenantId: string): Promise<CourseSummaryRow[]>;
  findPublished(tenantId: string, courseId: string): Promise<CourseDetailRow | null>;
}

const toHalalas = (price: Prisma.Decimal): number => price.mul(100).toDecimalPlaces(0).toNumber();

/**
 * Public catalog reads. Only published courses are ever returned, and media URLs are never
 * selected here — protected content goes through the signed HLS endpoints, not the catalog.
 */
export class PrismaCourseCatalogRepository implements CourseCatalogRepository {
  async listPublished(tenantId: string): Promise<CourseSummaryRow[]> {
    const courses = await forTenant(tenantId).course.findMany({
      where: { tenantId, isPublished: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        type: true,
        price: true,
        modules: { select: { _count: { select: { lessons: true } } } },
      },
    });
    return courses.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      priceHalalas: toHalalas(c.price),
      moduleCount: c.modules.length,
      lessonCount: c.modules.reduce((sum, m) => sum + m._count.lessons, 0),
    }));
  }

  async findPublished(tenantId: string, courseId: string): Promise<CourseDetailRow | null> {
    const c = await forTenant(tenantId).course.findFirst({
      where: { id: courseId, tenantId, isPublished: true },
      select: {
        id: true,
        title: true,
        type: true,
        price: true,
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
      moduleCount: c.modules.length,
      lessonCount: c.modules.reduce((sum, m) => sum + m.lessons.length, 0),
      modules: c.modules,
    };
  }
}
