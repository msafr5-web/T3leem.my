import { HttpError } from '../../../shared/utils/http-error';
import { calculateVatHalalas } from '../../../shared/utils/money';
import type { CourseCatalogRepository, CourseDetailRow, CourseSummaryRow } from './course.repository';

export interface PriceBreakdown {
  netHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
}

export type CourseSummary = Omit<CourseSummaryRow, 'priceHalalas'> & { price: PriceBreakdown };
export type CourseDetail = Omit<CourseDetailRow, 'priceHalalas'> & { price: PriceBreakdown };

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
    return rows.map((row) => this.withPrice(row));
  }

  async get(tenantId: string, courseId: string): Promise<CourseDetail> {
    const row = await this.repository.findPublished(tenantId, courseId);
    if (!row) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return this.withPrice(row);
  }

  priceOf(netHalalas: number): PriceBreakdown {
    const vatHalalas = calculateVatHalalas(netHalalas, this.vatRatePercent);
    return { netHalalas, vatHalalas, totalHalalas: netHalalas + vatHalalas };
  }

  private withPrice<T extends CourseSummaryRow>(row: T): Omit<T, 'priceHalalas'> & { price: PriceBreakdown } {
    const { priceHalalas, ...rest } = row;
    return { ...rest, price: this.priceOf(priceHalalas) };
  }
}
