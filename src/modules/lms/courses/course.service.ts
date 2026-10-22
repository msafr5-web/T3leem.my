import type { ContentType, CourseType } from '@prisma/client';
import { HttpError } from '../../../shared/utils/http-error';
import { calculateVatHalalas } from '../../../shared/utils/money';
import type { CourseCatalogRepository, CourseSummaryRow } from './course.repository';

export interface PriceBreakdown {
  netHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
}

export interface CourseSummary {
  id: string;
  title: string;
  type: CourseType;
  price: PriceBreakdown;
  moduleCount: number;
  lessonCount: number;
}

export interface CourseDetail extends CourseSummary {
  modules: { id: string; title: string; lessons: { id: string; title: string; contentType: ContentType }[] }[];
}

/**
 * Catalog reads. Prices are stored VAT-exclusive; Saudi consumer-pricing rules require
 * showing the VAT-inclusive amount, so every price leaves here as a full breakdown computed
 * with the same function checkout uses — the price shown is the price charged.
 */
export class CourseCatalogService {
  constructor(
    private readonly repository: CourseCatalogRepository,
    private readonly vatRatePercent: number,
  ) {}

  async list(tenantId: string): Promise<CourseSummary[]> {
    const rows = await this.repository.listPublished(tenantId);
    return rows.map((row) => this.toSummary(row));
  }

  async get(tenantId: string, courseId: string): Promise<CourseDetail> {
    const row = await this.repository.findPublished(tenantId, courseId);
    if (!row) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return { ...this.toSummary(row), modules: row.modules };
  }

  private toSummary(row: CourseSummaryRow): CourseSummary {
    const vatHalalas = calculateVatHalalas(row.priceHalalas, this.vatRatePercent);
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      price: { netHalalas: row.priceHalalas, vatHalalas, totalHalalas: row.priceHalalas + vatHalalas },
      moduleCount: row.moduleCount,
      lessonCount: row.lessonCount,
    };
  }
}
