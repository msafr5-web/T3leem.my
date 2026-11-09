import type { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../config/database';
import { formatHalalas } from '../../shared/utils/money';
import { toDateOnly, toHalalas } from '../lms/courses/course.repository';
import type {
  Actor,
  AdminCourseRow,
  ClassroomRecord,
  ClassroomRow,
  ClassroomUpdate,
  DeleteOutcome,
  CourseInput,
  OverviewRow,
  PlanInput,
  PlanRow,
  TraineeInput,
  TraineeRow,
  TrainerInput,
  TrainerRow,
  AttendanceRow,
  CourseRosterRow,
  TraineeEnrollmentResult,
} from './provider.types';
import type { TraineeDraft } from './trainee.excel';

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
  createClassroom(tenantId: string, actor: Actor, input: ClassroomRecord): Promise<string>;
  deleteCourse(tenantId: string, actor: Actor, id: string): Promise<DeleteOutcome>;
  updateTrainer(tenantId: string, actor: Actor, id: string, input: Partial<TrainerInput>): Promise<boolean>;
  deleteTrainer(tenantId: string, actor: Actor, id: string): Promise<DeleteOutcome>;
  updateTrainee(tenantId: string, actor: Actor, id: string, input: { fullName: string }): Promise<boolean>;
  deleteTrainee(tenantId: string, actor: Actor, id: string): Promise<DeleteOutcome>;
  updatePlan(tenantId: string, actor: Actor, id: string, input: Partial<PlanInput>): Promise<boolean>;
  deletePlan(tenantId: string, actor: Actor, id: string): Promise<boolean>;
  getClassroom(tenantId: string, id: string): Promise<ClassroomRow | null>;
  updateClassroom(tenantId: string, actor: Actor, id: string, input: ClassroomUpdate & { externalMeetingId?: string | null }): Promise<boolean>;
  deleteClassroom(tenantId: string, actor: Actor, id: string): Promise<boolean>;
  listAttendance(tenantId: string, classroomId: string): Promise<AttendanceRow[]>;
  /**
   * Enrolls employees into a course in ONE transaction: creates learner accounts for new e-mails, enrolls everyone
   * (source ADMIN, no payment), skips people already enrolled. Per-person problems come back as rows, not exceptions.
   */
  enrollTrainees(tenantId: string, actor: Actor, courseId: string, drafts: TraineeDraft[], passwordHash: string): Promise<TraineeEnrollmentResult[]>;
  listCourseRoster(tenantId: string, courseId: string): Promise<CourseRosterRow[]>;
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
  sourceVideoId: true,
  sourceChannelUrl: true,
  sourceChannelName: true,
  scheduleStartsAt: true,
  _count: { select: { enrollments: true, modules: true } },
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
  recorded: c.sourceVideoId
    ? { videoId: c.sourceVideoId, channelUrl: c.sourceChannelUrl, channelName: c.sourceChannelName, startsAt: c.scheduleStartsAt, dayCount: c._count.modules }
    : null,
  hasContent: c._count.modules > 0,
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
  externalMeetingId: true,
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
  async listAttendance(tenantId: string, classroomId: string): Promise<AttendanceRow[]> {
    const rows = await forTenant(tenantId).classroomAttendance.findMany({
      where: { tenantId, classroomId },
      orderBy: { joinedAt: 'asc' },
      select: { participantName: true, participantEmail: true, joinedAt: true, userId: true },
    });
    return rows.map((r) => ({ name: r.participantName, email: r.participantEmail, joinedAt: r.joinedAt, isTrainee: r.userId !== null }));
  }

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

  createClassroom(tenantId: string, actor: Actor, input: ClassroomRecord): Promise<string> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { id } = await tx.virtualClassroom.create({ data: { ...input, tenantId }, select: { id: true } });
      // Zoom webhooks only carry the meeting id: register meeting -> academy/classroom.
      if (input.externalMeetingId) await tx.meetingRegistry.create({ data: { externalMeetingId: input.externalMeetingId, tenantId, classroomId: id } });
      await audit(tx, tenantId, actor, 'classroom.created', 'virtual_classroom', id, { title: input.title, startsAt: input.startsAt.toISOString() });
      return id;
    });
  }

  deleteCourse(tenantId: string, actor: Actor, id: string): Promise<DeleteOutcome> {
    return withTenantTransaction(tenantId, async (tx) => {
      const course = await tx.course.findFirst({ where: { tenantId, id }, select: { title: true, _count: { select: { enrollments: true } } } });
      if (!course) return 'not_found';
      // Enrollments are tied to paid invoices (ZATCA records must be kept): never cascade them away.
      if (course._count.enrollments > 0) return 'in_use';
      await tx.lesson.deleteMany({ where: { tenantId, module: { courseId: id } } });
      await tx.module.deleteMany({ where: { tenantId, courseId: id } });
      await tx.course.delete({ where: { id } });
      await audit(tx, tenantId, actor, 'course.deleted', 'course', id, { title: course.title });
      return 'deleted';
    });
  }

  updateTrainer(tenantId: string, actor: Actor, id: string, input: Partial<TrainerInput>): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.trainer.updateMany({ where: { tenantId, id }, data: input });
      if (count === 0) return false;
      await audit(tx, tenantId, actor, 'trainer.updated', 'trainer', id, { fields: Object.keys(input) });
      return true;
    });
  }

  deleteTrainer(tenantId: string, actor: Actor, id: string): Promise<DeleteOutcome> {
    return withTenantTransaction(tenantId, async (tx) => {
      const trainer = await tx.trainer.findFirst({ where: { tenantId, id }, select: { fullName: true, _count: { select: { courses: true } } } });
      if (!trainer) return 'not_found';
      // Courses require a trainer; reassign them first. Classrooms just lose the trainer (SET NULL).
      if (trainer._count.courses > 0) return 'in_use';
      await tx.trainer.delete({ where: { id } });
      await audit(tx, tenantId, actor, 'trainer.deleted', 'trainer', id, { fullName: trainer.fullName });
      return 'deleted';
    });
  }

  updateTrainee(tenantId: string, actor: Actor, id: string, input: { fullName: string }): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.user.updateMany({ where: { tenantId, id, role: 'LEARNER' }, data: { fullName: input.fullName } });
      if (count === 0) return false;
      await audit(tx, tenantId, actor, 'trainee.updated', 'user', id, { fields: ['fullName'] });
      return true;
    });
  }

  deleteTrainee(tenantId: string, actor: Actor, id: string): Promise<DeleteOutcome> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, id, role: 'LEARNER' }, select: { email: true, _count: { select: { enrollments: true } } } });
      if (!user) return 'not_found';
      if (user._count.enrollments > 0) return 'in_use';
      await tx.user.delete({ where: { id } });
      await audit(tx, tenantId, actor, 'trainee.deleted', 'user', id, { email: user.email });
      return 'deleted';
    });
  }

  updatePlan(tenantId: string, actor: Actor, id: string, input: Partial<PlanInput>): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { courseIds, ...fields } = input;
      const { count } = await tx.trainingPlan.updateMany({ where: { tenantId, id }, data: fields });
      if (count === 0) return false;
      if (courseIds !== undefined) {
        // Replace the ordered course list atomically.
        await tx.trainingPlanCourse.deleteMany({ where: { tenantId, planId: id } });
        if (courseIds.length) {
          await tx.trainingPlanCourse.createMany({ data: courseIds.map((courseId, sortOrder) => ({ tenantId, planId: id, courseId, sortOrder })) });
        }
      }
      await audit(tx, tenantId, actor, 'plan.updated', 'training_plan', id, { fields: Object.keys(input) });
      return true;
    });
  }

  deletePlan(tenantId: string, actor: Actor, id: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const plan = await tx.trainingPlan.findFirst({ where: { tenantId, id }, select: { title: true } });
      if (!plan) return false;
      await tx.trainingPlan.delete({ where: { id } }); // plan courses cascade
      await audit(tx, tenantId, actor, 'plan.deleted', 'training_plan', id, { title: plan.title });
      return true;
    });
  }

  getClassroom(tenantId: string, id: string): Promise<ClassroomRow | null> {
    return forTenant(tenantId).virtualClassroom.findFirst({ where: { tenantId, id }, select: classroomSelect });
  }

  updateClassroom(tenantId: string, actor: Actor, id: string, input: ClassroomUpdate & { externalMeetingId?: string | null }): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.virtualClassroom.updateMany({ where: { tenantId, id }, data: input });
      if (count === 0) return false;
      if (input.externalMeetingId === null) await tx.meetingRegistry.deleteMany({ where: { classroomId: id, tenantId } });
      await audit(tx, tenantId, actor, 'classroom.updated', 'virtual_classroom', id, { fields: Object.keys(input) });
      return true;
    });
  }

  deleteClassroom(tenantId: string, actor: Actor, id: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const room = await tx.virtualClassroom.findFirst({ where: { tenantId, id }, select: { title: true } });
      if (!room) return false;
      await tx.meetingRegistry.deleteMany({ where: { classroomId: id, tenantId } });
      await tx.virtualClassroom.delete({ where: { id } });
      await audit(tx, tenantId, actor, 'classroom.deleted', 'virtual_classroom', id, { title: room.title });
      return true;
    });
  }

  async listCourseRoster(tenantId: string, courseId: string): Promise<CourseRosterRow[]> {
    const rows = await forTenant(tenantId).enrollment.findMany({
      where: { tenantId, courseId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        source: true,
        progressPercentage: true,
        completionStatus: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true, phone: true, employeeNo: true } },
      },
    });
    return rows.map((e) => ({
      enrollmentId: e.id,
      userId: e.user.id,
      fullName: e.user.fullName,
      email: e.user.email,
      phone: e.user.phone,
      employeeNo: e.user.employeeNo,
      progressPercentage: e.progressPercentage.toNumber(),
      completionStatus: e.completionStatus,
      status: e.status,
      source: e.source,
      enrolledAt: e.createdAt,
    }));
  }

  enrollTrainees(tenantId: string, actor: Actor, courseId: string, drafts: TraineeDraft[], passwordHash: string): Promise<TraineeEnrollmentResult[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      // One lookup for everything that could collide: the same e-mail, phone or staff number may already belong to someone.
      const emails = drafts.map((d) => d.email);
      const phones = drafts.flatMap((d) => (d.phone ? [d.phone] : []));
      const staffNos = drafts.flatMap((d) => (d.employeeNo ? [d.employeeNo] : []));
      const known = await tx.user.findMany({
        where: { tenantId, OR: [{ email: { in: emails } }, { phone: { in: phones } }, { employeeNo: { in: staffNos } }] },
        select: { id: true, email: true, phone: true, employeeNo: true, role: true },
      });
      const byEmail = new Map(known.map((u) => [u.email, u]));
      const byPhone = new Map(known.flatMap((u) => (u.phone ? [[u.phone, u] as const] : [])));
      const byStaffNo = new Map(known.flatMap((u) => (u.employeeNo ? [[u.employeeNo, u] as const] : [])));

      const results = new Map<string, TraineeEnrollmentResult>();
      const toCreate: TraineeDraft[] = [];
      const fillMissing: { id: string; phone?: string; employeeNo?: string }[] = [];
      for (const d of drafts) {
        const base = { email: d.email, fullName: d.fullName, accountCreated: false } as const;
        const user = byEmail.get(d.email);
        if (user) {
          if (user.role !== 'LEARNER') {
            results.set(d.email, { ...base, status: 'error', message: 'هذا البريد يخص حساباً إدارياً في الأكاديمية وليس متدرباً.' });
            continue;
          }
          // An existing trainee keeps what they have; only empty phone / staff number are filled, and never taken from someone else.
          const fill: { id: string; phone?: string; employeeNo?: string } = { id: user.id };
          if (!user.phone && d.phone && !byPhone.has(d.phone)) fill.phone = d.phone;
          if (!user.employeeNo && d.employeeNo && !byStaffNo.has(d.employeeNo)) fill.employeeNo = d.employeeNo;
          if (fill.phone || fill.employeeNo) fillMissing.push(fill);
          continue;
        }
        if (d.phone && byPhone.has(d.phone)) {
          results.set(d.email, { ...base, status: 'error', message: 'رقم الجوال مسجّل لمتدرب آخر في الأكاديمية.' });
        } else if (d.employeeNo && byStaffNo.has(d.employeeNo)) {
          results.set(d.email, { ...base, status: 'error', message: 'الرقم الوظيفي مسجّل لمتدرب آخر في الأكاديمية.' });
        } else {
          toCreate.push(d);
        }
      }

      if (toCreate.length > 0) {
        // The account has no usable password: trainees sign in with the code e-mailed to them.
        await tx.user.createMany({
          data: toCreate.map((d) => ({
            tenantId,
            email: d.email,
            fullName: d.fullName,
            phone: d.phone,
            employeeNo: d.employeeNo,
            passwordHash,
            role: 'LEARNER' as const,
          })),
        });
      }
      for (const f of fillMissing) {
        await tx.user.update({ where: { id: f.id }, data: { ...(f.phone ? { phone: f.phone } : {}), ...(f.employeeNo ? { employeeNo: f.employeeNo } : {}) } });
      }

      const created = new Set(toCreate.map((d) => d.email));
      const enrollable = drafts.filter((d) => !results.has(d.email));
      const users = await tx.user.findMany({
        where: { tenantId, role: 'LEARNER', email: { in: enrollable.map((d) => d.email) } },
        select: { id: true, email: true },
      });
      const idOf = new Map(users.map((u) => [u.email, u.id]));
      const already = new Set(
        (await tx.enrollment.findMany({ where: { tenantId, courseId, userId: { in: users.map((u) => u.id) } }, select: { userId: true } })).map((e) => e.userId),
      );
      const fresh = enrollable.filter((d) => idOf.has(d.email) && !already.has(idOf.get(d.email) as string));
      if (fresh.length > 0) {
        await tx.enrollment.createMany({
          data: fresh.map((d) => ({ tenantId, courseId, userId: idOf.get(d.email) as string, source: 'ADMIN' })),
          skipDuplicates: true,
        });
      }
      const freshEmails = new Set(fresh.map((d) => d.email));
      for (const d of enrollable) {
        results.set(d.email, {
          email: d.email,
          fullName: d.fullName,
          accountCreated: created.has(d.email),
          status: freshEmails.has(d.email) ? 'enrolled' : 'already_enrolled',
        });
      }

      await audit(tx, tenantId, actor, 'course.trainees_enrolled', 'course', courseId, {
        requested: drafts.length,
        enrolled: freshEmails.size,
        accountsCreated: toCreate.length,
        errors: [...results.values()].filter((r) => r.status === 'error').length,
      });
      return drafts.map((d) => results.get(d.email) as TraineeEnrollmentResult);
    });
  }
}
