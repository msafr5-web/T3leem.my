import type { Request, Response } from 'express';
import { ok } from '../../../shared/utils/api-response';
import { halalasToNumber } from '../../../shared/utils/money';
import type { CourseCatalogService, CourseSummary, PriceBreakdown } from './course.service';

export const priceJson = (p: PriceBreakdown) => ({
  net: halalasToNumber(p.netHalalas),
  vat: halalasToNumber(p.vatHalalas),
  total: halalasToNumber(p.totalHalalas),
  currency: 'SAR',
});

const summaryJson = (c: CourseSummary) => ({
  id: c.id,
  title: c.title,
  type: c.type,
  price: priceJson(c.price),
  training_hours: c.trainingHours,
  duration_days: c.durationDays,
  accreditation_number: c.accreditationNumber,
  trainer_name: c.trainerName,
  module_count: c.moduleCount,
  lesson_count: c.lessonCount,
});

export class CourseController {
  constructor(private readonly catalog: CourseCatalogService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    if (!req.tenantId) throw new Error('course routes mounted without tenant middleware');
    const courses = await this.catalog.list(req.tenantId);
    res.json(ok(courses.map(summaryJson)));
  };

  get = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    if (!req.tenantId) throw new Error('course routes mounted without tenant middleware');
    const course = await this.catalog.get(req.tenantId, req.params.id);
    res.json(
      ok({
        ...summaryJson(course),
        description: course.description,
        license: {
          number: course.licenseNumber,
          authority: course.licenseAuthority,
          expires_on: course.licenseExpiresOn,
        },
        trainer: {
          id: course.trainer.id,
          full_name: course.trainer.fullName,
          specialization: course.trainer.specialization,
          bio: course.trainer.bio,
        },
        modules: course.modules.map((m) => ({
          id: m.id,
          title: m.title,
          lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, content_type: l.contentType })),
        })),
      }),
    );
  };
}
