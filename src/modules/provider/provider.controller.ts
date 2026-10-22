import type { Request, Response } from 'express';
import type { ClassroomStatus, CourseType, MeetingProvider, PlanStatus, PlanType } from '@prisma/client';
import { requireAuthContext } from '../../shared/middlewares/auth.middleware';
import { ok } from '../../shared/utils/api-response';
import { halalasToNumber } from '../../shared/utils/money';
import type { CourseCatalogService } from '../lms/courses/course.service';
import { priceJson } from '../lms/courses/course.controller';
import type { ProviderService } from './provider.service';
import type { Actor, AdminCourseRow, ClassroomRow, ClassroomUpdate, CourseInput, PlanRow, TrainerRow } from './provider.types';

// ----- request parsing (bodies are already validated by express-validator) -----

type Body = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const dateOnly = (v: unknown): Date | null => (typeof v === 'string' && v !== '' ? new Date(`${v}T00:00:00Z`) : null);
const numberOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
/** SAR with up to 2 decimals -> integer halalas, without float drift (e.g. 19.99 -> 1999). */
const sarToHalalas = (v: unknown): number => Math.round(Number(v) * 100);

function courseInput(b: Body, partial: boolean): Partial<CourseInput> {
  const map: Partial<CourseInput> = {};
  const has = (k: string) => !partial || k in b;
  if (has('title')) map.title = String(b.title).trim();
  if (has('description')) map.description = text(b.description);
  if (has('type')) map.type = b.type as CourseType;
  if (has('price')) map.priceHalalas = sarToHalalas(b.price);
  if (has('trainer_id')) map.trainerId = String(b.trainer_id);
  if (has('license_number')) map.licenseNumber = text(b.license_number);
  if (has('license_authority')) map.licenseAuthority = text(b.license_authority);
  if (has('license_expires_on')) map.licenseExpiresOn = dateOnly(b.license_expires_on);
  if (has('accreditation_number')) map.accreditationNumber = text(b.accreditation_number);
  if (has('training_hours')) map.trainingHours = numberOrNull(b.training_hours);
  if (has('duration_days')) map.durationDays = numberOrNull(b.duration_days);
  if (has('is_published')) map.isPublished = b.is_published === true || b.is_published === 'true';
  return map;
}

const actorOf = (req: Request): Actor => {
  const { user } = requireAuthContext(req);
  return { userId: user.id, role: user.role, ip: req.ip ?? null };
};

// ----- response shapes -----

const trainerPublicJson = (t: TrainerRow) => ({
  id: t.id,
  full_name: t.fullName,
  specialization: t.specialization,
  bio: t.bio,
  course_count: t.courseCount,
});

const trainerAdminJson = (t: TrainerRow) => ({ ...trainerPublicJson(t), email: t.email, has_account: t.hasAccount });

const planJson = (p: PlanRow) => ({
  id: p.id,
  title: p.title,
  description: p.description,
  type: p.type as PlanType,
  status: p.status as PlanStatus,
  starts_on: p.startsOn,
  ends_on: p.endsOn,
  total_hours: p.courses.reduce((sum, c) => sum + (c.trainingHours ?? 0), 0),
  courses: p.courses.map((c) => ({ id: c.id, title: c.title, training_hours: c.trainingHours, is_published: c.isPublished })),
});

const classroomJson = (c: ClassroomRow, opts: { includeLink: boolean }) => ({
  id: c.id,
  title: c.title,
  starts_at: c.startsAt.toISOString(),
  duration_minutes: c.durationMinutes,
  capacity: c.capacity,
  provider: c.provider as MeetingProvider,
  status: c.status as ClassroomStatus,
  // Join links are for the academy's admins (and, later, enrolled trainees) — never public.
  ...(opts.includeLink ? { join_url: c.joinUrl } : {}),
  course: c.course,
  trainer: c.trainer ? { id: c.trainer.id, full_name: c.trainer.fullName } : null,
});

export class ProviderController {
  constructor(
    private readonly provider: ProviderService,
    private readonly catalog: CourseCatalogService,
  ) {}

  private adminCourseJson = (c: AdminCourseRow) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    type: c.type,
    price: priceJson(this.catalog.priceOf(c.priceHalalas)),
    trainer: { id: c.trainerId, full_name: c.trainerName },
    license: { number: c.licenseNumber, authority: c.licenseAuthority, expires_on: c.licenseExpiresOn },
    accreditation_number: c.accreditationNumber,
    training_hours: c.trainingHours,
    duration_days: c.durationDays,
    is_published: c.isPublished,
    enrollment_count: c.enrollmentCount,
  });

  // ----- public -----

  publicPlans = async (req: Request, res: Response): Promise<void> => {
    const plans = await this.provider.listPublicPlans(tenantOf(req));
    res.json(ok(plans.map(planJson)));
  };

  publicTrainers = async (req: Request, res: Response): Promise<void> => {
    const trainers = await this.provider.listTrainers(tenantOf(req));
    res.json(ok(trainers.map(trainerPublicJson)));
  };

  upcomingClassrooms = async (req: Request, res: Response): Promise<void> => {
    const upcoming = await this.provider.upcomingClassrooms(tenantOf(req));
    res.json(ok(upcoming.map((c) => classroomJson(c, { includeLink: false }))));
  };

  // ----- admin -----

  overview = async (req: Request, res: Response): Promise<void> => {
    const o = await this.provider.overview(tenantOf(req));
    res.json(
      ok({
        counts: {
          courses: o.courses,
          published_courses: o.publishedCourses,
          trainers: o.trainers,
          trainees: o.trainees,
          active_plans: o.activePlans,
          enrollments: o.enrollments,
        },
        revenue_total: halalasToNumber(o.revenueHalalas),
        upcoming_classrooms: o.upcomingClassrooms.map((c) => classroomJson(c, { includeLink: true })),
        recent_enrollments: o.recentEnrollments.map((e) => ({
          id: e.id,
          created_at: e.createdAt.toISOString(),
          trainee_name: e.traineeName,
          course_title: e.courseTitle,
        })),
      }),
    );
  };

  listCourses = async (req: Request, res: Response): Promise<void> => {
    res.json(ok((await this.provider.listCourses(tenantOf(req))).map(this.adminCourseJson)));
  };

  getCourse = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    res.json(ok(this.adminCourseJson(await this.provider.getCourse(tenantOf(req), req.params.id))));
  };

  createCourse = async (req: Request, res: Response): Promise<void> => {
    const id = await this.provider.createCourse(tenantOf(req), actorOf(req), courseInput(req.body as Body, false) as CourseInput);
    res.status(201).json(ok({ id }));
  };

  updateCourse = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.provider.updateCourse(tenantOf(req), actorOf(req), req.params.id, courseInput(req.body as Body, true));
    res.json(ok({ id: req.params.id }));
  };

  listTrainers = async (req: Request, res: Response): Promise<void> => {
    res.json(ok((await this.provider.listTrainers(tenantOf(req))).map(trainerAdminJson)));
  };

  createTrainer = async (req: Request, res: Response): Promise<void> => {
    const b = req.body as Body;
    const id = await this.provider.createTrainer(tenantOf(req), actorOf(req), {
      fullName: String(b.full_name).trim(),
      specialization: text(b.specialization),
      bio: text(b.bio),
      email: text(b.email)?.toLowerCase() ?? null,
    });
    res.status(201).json(ok({ id }));
  };

  listTrainees = async (req: Request, res: Response): Promise<void> => {
    const trainees = await this.provider.listTrainees(tenantOf(req));
    res.json(
      ok(
        trainees.map((t) => ({
          id: t.id,
          email: t.email,
          full_name: t.fullName,
          enrollment_count: t.enrollmentCount,
          created_at: t.createdAt.toISOString(),
        })),
      ),
    );
  };

  createTrainee = async (req: Request, res: Response): Promise<void> => {
    const b = req.body as Body;
    const id = await this.provider.createTrainee(tenantOf(req), actorOf(req), {
      email: String(b.email),
      fullName: String(b.full_name).trim(),
      password: String(b.password),
    });
    res.status(201).json(ok({ id }));
  };

  listPlans = async (req: Request, res: Response): Promise<void> => {
    res.json(ok((await this.provider.listAllPlans(tenantOf(req))).map(planJson)));
  };

  createPlan = async (req: Request, res: Response): Promise<void> => {
    const b = req.body as Body;
    const id = await this.provider.createPlan(tenantOf(req), actorOf(req), {
      title: String(b.title).trim(),
      description: text(b.description),
      type: b.type as PlanType,
      status: (b.status as PlanStatus | undefined) ?? 'DRAFT',
      startsOn: dateOnly(b.starts_on),
      endsOn: dateOnly(b.ends_on),
      courseIds: Array.isArray(b.course_ids) ? b.course_ids.map(String) : [],
    });
    res.status(201).json(ok({ id }));
  };

  listClassrooms = async (req: Request, res: Response): Promise<void> => {
    res.json(ok((await this.provider.listClassrooms(tenantOf(req))).map((c) => classroomJson(c, { includeLink: true }))));
  };

  createClassroom = async (req: Request, res: Response): Promise<void> => {
    const b = req.body as Body;
    const id = await this.provider.createClassroom(tenantOf(req), actorOf(req), {
      title: String(b.title).trim(),
      courseId: text(b.course_id),
      trainerId: text(b.trainer_id),
      startsAt: new Date(String(b.starts_at)),
      durationMinutes: Number(b.duration_minutes),
      capacity: numberOrNull(b.capacity),
      provider: ((b.provider as MeetingProvider | undefined) ?? 'ZOOM'),
      joinUrl: text(b.join_url),
    });
    res.status(201).json(ok({ id }));
  };

  // ----- edit / delete -----

  integrations = (_req: Request, res: Response): void => {
    res.json(ok({ zoom: this.provider.meetingsAutomated }));
  };

  deleteCourse = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.provider.deleteCourse(tenantOf(req), actorOf(req), req.params.id);
    res.status(204).end();
  };

  updateTrainer = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const b = req.body as Body;
    const input: Partial<{ fullName: string; specialization: string | null; bio: string | null; email: string | null }> = {};
    if ('full_name' in b) input.fullName = String(b.full_name).trim();
    if ('specialization' in b) input.specialization = text(b.specialization);
    if ('bio' in b) input.bio = text(b.bio);
    if ('email' in b) input.email = text(b.email)?.toLowerCase() ?? null;
    await this.provider.updateTrainer(tenantOf(req), actorOf(req), req.params.id, input);
    res.json(ok({ id: req.params.id }));
  };

  deleteTrainer = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.provider.deleteTrainer(tenantOf(req), actorOf(req), req.params.id);
    res.status(204).end();
  };

  updateTrainee = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.provider.updateTrainee(tenantOf(req), actorOf(req), req.params.id, { fullName: String((req.body as Body).full_name).trim() });
    res.json(ok({ id: req.params.id }));
  };

  deleteTrainee = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.provider.deleteTrainee(tenantOf(req), actorOf(req), req.params.id);
    res.status(204).end();
  };

  updatePlan = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const b = req.body as Body;
    const input: Partial<{ title: string; description: string | null; type: PlanType; status: PlanStatus; startsOn: Date | null; endsOn: Date | null; courseIds: string[] }> = {};
    if ('title' in b) input.title = String(b.title).trim();
    if ('description' in b) input.description = text(b.description);
    if ('type' in b) input.type = b.type as PlanType;
    if ('status' in b) input.status = b.status as PlanStatus;
    if ('starts_on' in b) input.startsOn = dateOnly(b.starts_on);
    if ('ends_on' in b) input.endsOn = dateOnly(b.ends_on);
    if ('course_ids' in b && Array.isArray(b.course_ids)) input.courseIds = b.course_ids.map(String);
    await this.provider.updatePlan(tenantOf(req), actorOf(req), req.params.id, input);
    res.json(ok({ id: req.params.id }));
  };

  deletePlan = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.provider.deletePlan(tenantOf(req), actorOf(req), req.params.id);
    res.status(204).end();
  };

  getClassroom = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    res.json(ok(classroomJson(await this.provider.getClassroom(tenantOf(req), req.params.id), { includeLink: true })));
  };

  updateClassroom = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const b = req.body as Body;
    const input: ClassroomUpdate = {};
    if ('title' in b) input.title = String(b.title).trim();
    if ('course_id' in b) input.courseId = text(b.course_id);
    if ('trainer_id' in b) input.trainerId = text(b.trainer_id);
    if ('starts_at' in b) input.startsAt = new Date(String(b.starts_at));
    if ('duration_minutes' in b) input.durationMinutes = Number(b.duration_minutes);
    if ('capacity' in b) input.capacity = numberOrNull(b.capacity);
    if ('provider' in b) input.provider = b.provider as MeetingProvider;
    if ('join_url' in b) input.joinUrl = text(b.join_url);
    if ('status' in b) input.status = b.status as ClassroomStatus;
    await this.provider.updateClassroom(tenantOf(req), actorOf(req), req.params.id, input);
    res.json(ok({ id: req.params.id }));
  };

  deleteClassroom = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.provider.deleteClassroom(tenantOf(req), actorOf(req), req.params.id);
    res.status(204).end();
  };
}

function tenantOf(req: Request): string {
  if (!req.tenantId) throw new Error('provider routes mounted without tenant middleware');
  return req.tenantId;
}
