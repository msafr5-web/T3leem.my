import type { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../config/database';
import { formatHalalas } from '../../shared/utils/money';
import { toDateOnly, toHalalas } from '../lms/courses/course.repository';
import type {
  Actor,
  AdminCourseRow,
  ClassroomInput,
  ClassroomRow,
  CourseInput,
  OverviewRow,
  PlanInput,
  PlanRow,
  TraineeInput,
  TraineeRow,
  TrainerInput,
  TrainerRow,
} from './provider.types';

export interface ProviderRepository {
  // public
  listPlans(tenantId: string, opts: { activeOnly: boolean }): Promise<PlanRow[]>;
  listTrainers(tenantId: string): Promise<TrainerRow[]>;
  // admin reads
  overview(tenantId: string, now: Date): Promise<OverviewRow>;
  listCourses(tenantId: string): Promise<AdminCourseRow[]>;
  getCourse(tenantId: string, id: string): Promise<AdminCourseRow | null>;
  listTrainees(tenantId: string): Promise<TraineeRow[]>;
  listClassrooms(tenantId: string): Promise<ClassroomRow[]>;
  listUpcomingClassrooms(tenantId: string, now: Date, take: number): Promise<ClassroomRow[]>;
  /** How many of the given ids exist in THIS tenant (RLS-scoped). */
  countOwned(tenantId: string, ids: { courseIds?: string[]; trainerIds?: string[] }): Promise<{ courses: number; trainers: number }>;
  // admin writes (each also writes an audit_logs row in the same transaction)
  createCourse(tenantId: string, actor: Actor, input: CourseInput): Promise<string>;
  updateCourse(tenantId: string, actor: Actor, id: string, input: Partial<CourseInput>): Promise<boolean>;
  createTrainer(tenantId: string, actor: Actor, input: TrainerInput): Promise<string>;
  createTrainee(tenantId: string, actor: Actor, input: TraineeInput): Promise<string>;
  createPlan(tenantId: string, actor: Actor, input: PlanInput): Promise<string>;
  createClassroom(tenantId: string, actor: Actor, input: ClassroomInput): Promise<string>;
}

const audit = (
  tx: Prisma.TransactionClient,
  tenantId: string,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonValue,
) =>
  tx.auditLog.create({
    data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType, entityId, metadata, ipAddress: actor.ip },
  });

const adminCourseSelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  price: true,
  trainerId: true,
  trainer: { select: { fullName: true } },
  licenseNumber: true,
  licenseAuthority: true,
  licenseExpiresOn: true,
  accreditationNumber: true,
  trainingHours: true,
  durationDays: true,
  isPublished: true,
  _count: { select: { enrollments: true } },
} as const;

type AdminCourseRecord = Prisma.CourseGetPayload<{ select: typeof adminCourseSelect }>;

const toAdminCourse = (c: AdminCourseRecord): AdminCourseRow => ({
  id: c.id,
  title: c.title,
  description: c.description,
  type: c.type,
  priceHalalas: toHalalas(c.price),
  trainerId: c.trainerId,
  trainerName: c.trainer.fullName,
  licenseNumber: c.licenseNumber,
  licenseAuthority: c.licenseAuthority,
  licenseExpiresOn: toDateOnly(c.licenseExpiresOn),
  accreditationNumber: c.accreditationNumber,
  trainingHours: c.trainingHours?.toNumber() ?? null,
  durationDays: c.durationDays,
  isPublished: c.isPublished,
  enrollmentCount: c._count.enrollments,
});

const classroomSelect = {
  id: true,
  title: true,
  startsAt: true,
  durationMinutes: true,
  capacity: true,
  provider: true,
  joinUrl: true,
  status: true,
  course: { select: { id: true, title: true } },
  trainer: { select: { id: true, fullName: true } },
} as const;

/** Maps validated input to Prisma's column types (money as exact decimal strings). */
function courseData(input: Partial<CourseInput>): Prisma.CourseUncheckedUpdateInput {
  const data: Prisma.CourseUncheckedUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.type !== undefined) data.type = input.type;
  if (input.priceHalalas !== undefined) data.price = formatHalalas(input.priceHalalas);
  if (input.trainerId !== undefined) data.trainerId = input.trainerId;
  if (input.licenseNumber !== undefined) data.licenseNumber = input.licenseNumber;
  if (input.licenseAuthority !== undefined) data.licenseAuthority = input.licenseAuthority;
  if (input.licenseExpiresOn !== undefined) data.licenseExpiresOn = input.licenseExpiresOn;
  if (input.accreditationNumber !== undefined) data.accreditationNumber = input.accreditationNumber;
  if (input.trainingHours !== undefined) data.trainingHours = input.trainingHours;
  if (input.durationDays !== undefined) data.durationDays = input.durationDays;
  if (input.isPublished !== undefined) data.isPublished = input.isPublished;
  return data;
}

export class PrismaProviderRepository implements ProviderRepository {
  async listPlans(tenantId: string, { activeOnly }: { activeOnly: boolean }): Promise<PlanRow[]> {
    const plans = await forTenant(tenantId).trainingPlan.findMany({
      where: { tenantId, ...(activeOnly ? { status: 'ACTIVE' } : {}) },
      orderBy: [{ status: 'asc' }, { startsOn: 'asc' }],
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        status: true,
        startsOn: true,
        endsOn: true,
        courses: {
          orderBy: { sortOrder: 'asc' },
          // Public plans only reveal published courses; the dashboard sees everything.
          where: activeOnly ? { course: { isPublished: true } } : {},
          select: { course: { select: { id: true, title: true, trainingHours: true, isPublished: true } } },
        },
      },
    });
    return plans.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      type: p.type,
      status: p.status,
      startsOn: toDateOnly(p.startsOn),
      endsOn: toDateOnly(p.endsOn),
      courses: p.courses.map(({ course }) => ({
        id: course.id,
        title: course.title,
        trainingHours: course.trainingHours?.toNumber() ?? null,
        isPublished: course.isPublished,
      })),
    }));
  }

  async listTrainers(tenantId: string): Promise<TrainerRow[]> {
    const trainers = await forTenant(tenantId).trainer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fullName: true,
        specialization: true,
        bio: true,
        email: true,
        userId: true,
        _count: { select: { courses: true } },
      },
    });
    return trainers.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      specialization: t.specialization,
      bio: t.bio,
      email: t.email,
      hasAccount: t.userId !== null,
      courseCount: t._count.courses,
    }));
  }

  overview(tenantId: string, now: Date): Promise<OverviewRow> {
    // One transaction = one RLS context for all the dashboard counters.
    return withTenantTransaction(tenantId, async (tx) => {
      const [courses, publishedCourses, trainers, trainees, activePlans, enrollments, revenue, upcoming, recent] = await Promise.all([
        tx.course.count({ where: { tenantId } }),
        tx.course.count({ where: { tenantId, isPublished: true } }),
        tx.trainer.count({ where: { tenantId } }),
        tx.user.count({ where: { tenantId, role: 'LEARNER' } }),
        tx.trainingPlan.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.enrollment.count({ where: { tenantId } }),
        tx.invoice.aggregate({ where: { tenantId }, _sum: { totalAmount: true } }),
        tx.virtualClassroom.findMany({
          where: { tenantId, startsAt: { gte: now }, status: 'SCHEDULED' },
          orderBy: { startsAt: 'asc' },
          take: 5,
          select: classroomSelect,
        }),
        tx.enrollment.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, createdAt: true, user: { select: { fullName: true, email: true } }, course: { select: { title: true } } },
        }),
      ]);
      return {
        courses,
        publishedCourses,
        trainers,
        trainees,
        activePlans,
        enrollments,
        revenueHalalas: revenue._sum.totalAmount ? toHalalas(revenue._sum.totalAmount) : 0,
        upcomingClassrooms: upcoming,
        recentEnrollments: recent.map((e) => ({
          id: e.id,
          createdAt: e.createdAt,
          traineeName: e.user.fullName ?? e.user.email,
          courseTitle: e.course.title,
        })),
      };
    });
  }

  async listCourses(tenantId: string): Promise<AdminCourseRow[]> {
    const rows = await forTenant(tenantId).course.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: adminCourseSelect });
    return rows.map(toAdminCourse);
  }

  async getCourse(tenantId: string, id: string): Promise<AdminCourseRow | null> {
    const row = await forTenant(tenantId).course.findFirst({ where: { tenantId, id }, select: adminCourseSelect });
    return row ? toAdminCourse(row) : null;
  }

  async listTrainees(tenantId: string): Promise<TraineeRow[]> {
    const users = await forTenant(tenantId).user.findMany({
      where: { tenantId, role: 'LEARNER' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, createdAt: true, _count: { select: { enrollments: true } } },
    });
    return users.map((u) => ({ id: u.id, email: u.email, fullName: u.fullName, createdAt: u.createdAt, enrollmentCount: u._count.enrollments }));
  }

  listClassrooms(tenantId: string): Promise<ClassroomRow[]> {
    return forTenant(tenantId).virtualClassroom.findMany({ where: { tenantId }, orderBy: { startsAt: 'desc' }, select: classroomSelect });
  }

  listUpcomingClassrooms(tenantId: string, now: Date, take: number): Promise<ClassroomRow[]> {
    return forTenant(tenantId).virtualClassroom.findMany({
      where: { tenantId, startsAt: { gte: now }, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
      take,
      select: classroomSelect,
    });
  }

  async countOwned(tenantId: string, ids: { courseIds?: string[]; trainerIds?: string[] }): Promise<{ courses: number; trainers: number }> {
    const db = forTenant(tenantId);
    const [courses, trainers] = await Promise.all([
      ids.courseIds?.length ? db.course.count({ where: { tenantId, id: { in: ids.courseIds } } }) : Promise.resolve(0),
      ids.trainerIds?.length ? db.trainer.count({ where: { tenantId, id: { in: ids.trainerIds } } }) : Promise.resolve(0),
    ]);
    return { courses, trainers };
  }

  createCourse(tenantId: string, actor: Actor, input: CourseInput): Promise<string> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { id } = await tx.course.create({
        data: { ...(courseData(input) as Prisma.CourseUncheckedCreateInput), tenantId },
        select: { id: true },
      });
      await audit(tx, tenantId, actor, 'course.created', 'course', id, { title: input.title, isPublished: input.isPublished });
      return id;
    });
  }

  updateCourse(tenantId: string, actor: Actor, id: string, input: Partial<CourseInput>): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.course.updateMany({ where: { tenantId, id }, data: courseData(input) });
      if (count === 0) return false;
      await audit(tx, tenantId, actor, 'course.updated', 'course', id, { fields: Object.keys(input) });
      return true;
    });
  }

  createTrainer(tenantId: string, actor: Actor, input: TrainerInput): Promise<string> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { id } = await tx.trainer.create({ data: { ...input, tenantId }, select: { id: true } });
      await audit(tx, tenantId, actor, 'trainer.created', 'trainer', id, { fullName: input.fullName });
      return id;
    });
  }

  createTrainee(tenantId: string, actor: Actor, input: TraineeInput): Promise<string> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { id } = await tx.user.create({
        data: { tenantId, email: input.email, fullName: input.fullName, passwordHash: input.passwordHash, role: 'LEARNER' },
        select: { id: true },
      });
      // Never log the password or its hash.
      await audit(tx, tenantId, actor, 'trainee.created', 'user', id, { email: input.email });
      return id;
    });
  }

  createPlan(tenantId: string, actor: Actor, input: PlanInput): Promise<string> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { courseIds, ...plan } = input;
      const { id } = await tx.trainingPlan.create({ data: { ...plan, tenantId }, select: { id: true } });
      if (courseIds.length) {
        await tx.trainingPlanCourse.createMany({
          data: courseIds.map((courseId, sortOrder) => ({ tenantId, planId: id, courseId, sortOrder })),
        });
      }
      await audit(tx, tenantId, actor, 'plan.created', 'training_plan', id, { title: input.title, courses: courseIds.length });
      return id;
    });
  }

  createClassroom(tenantId: string, actor: Actor, input: ClassroomInput): Promise<string> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { id } = await tx.virtualClassroom.create({ data: { ...input, tenantId }, select: { id: true } });
      await audit(tx, tenantId, actor, 'classroom.created', 'virtual_classroom', id, { title: input.title, startsAt: input.startsAt.toISOString() });
      return id;
    });
  }
}
