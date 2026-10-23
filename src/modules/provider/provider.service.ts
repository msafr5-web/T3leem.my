import { logger } from '../../shared/services/logger';
import { HttpError } from '../../shared/utils/http-error';
import { ManualMeetingScheduler, type MeetingScheduler } from '../live/meeting-scheduler';
import type { ProviderRepository } from './provider.repository';
import type {
  Actor,
  AdminCourseRow,
  ClassroomInput,
  ClassroomRow,
  ClassroomUpdate,
  CourseInput,
  DeleteOutcome,
  OverviewRow,
  PlanInput,
  PlanRow,
  TraineeRow,
  TrainerInput,
  TrainerRow,
} from './provider.types';

export interface ProviderServiceDeps {
  repository: ProviderRepository;
  hashPassword: (password: string) => Promise<string>;
  /** Live-meeting provider (Zoom). Defaults to manual links. */
  meetings?: MeetingScheduler;
  clock?: () => Date;
}

const meetingFailed = () =>
  new HttpError(502, 'MEETING_PROVIDER_ERROR', 'Could not create the meeting with the provider. Try again or paste a link manually.');

function assertDeleted(outcome: DeleteOutcome, notFound: HttpError, inUse: HttpError): void {
  if (outcome === 'not_found') throw notFound;
  if (outcome === 'in_use') throw inUse;
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

/**
 * Service-provider management (the academy's dashboard).
 *
 * Why the ownership checks: PostgreSQL validates foreign keys with internal privileges that
 * are NOT subject to row level security. Without checking, a provider who learned another
 * academy's course id could link it into their own plan or classroom. Every referenced id is
 * therefore re-checked through an RLS-scoped query before writing.
 */
export class ProviderService {
  private readonly clock: () => Date;
  private readonly meetings: MeetingScheduler;

  constructor(private readonly deps: ProviderServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.meetings = deps.meetings ?? new ManualMeetingScheduler();
  }

  /** Whether classrooms get a Zoom meeting automatically (shown in the dashboard). */
  get meetingsAutomated(): boolean {
    return this.meetings.available;
  }

  // ----- public -----

  listPublicPlans(tenantId: string): Promise<PlanRow[]> {
    return this.deps.repository.listPlans(tenantId, { activeOnly: true });
  }

  listTrainers(tenantId: string): Promise<TrainerRow[]> {
    return this.deps.repository.listTrainers(tenantId);
  }

  upcomingClassrooms(tenantId: string, take = 6): Promise<ClassroomRow[]> {
    return this.deps.repository.listUpcomingClassrooms(tenantId, this.clock(), take);
  }

  // ----- admin reads -----

  overview(tenantId: string): Promise<OverviewRow> {
    return this.deps.repository.overview(tenantId, this.clock());
  }

  listCourses(tenantId: string): Promise<AdminCourseRow[]> {
    return this.deps.repository.listCourses(tenantId);
  }

  async getCourse(tenantId: string, id: string): Promise<AdminCourseRow> {
    const course = await this.deps.repository.getCourse(tenantId, id);
    if (!course) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return course;
  }

  listAllPlans(tenantId: string): Promise<PlanRow[]> {
    return this.deps.repository.listPlans(tenantId, { activeOnly: false });
  }

  listTrainees(tenantId: string): Promise<TraineeRow[]> {
    return this.deps.repository.listTrainees(tenantId);
  }

  listClassrooms(tenantId: string): Promise<ClassroomRow[]> {
    return this.deps.repository.listClassrooms(tenantId);
  }

  // ----- admin writes -----

  async createCourse(tenantId: string, actor: Actor, input: CourseInput): Promise<string> {
    await this.assertTrainersOwned(tenantId, [input.trainerId]);
    return this.deps.repository.createCourse(tenantId, actor, input);
  }

  async updateCourse(tenantId: string, actor: Actor, id: string, input: Partial<CourseInput>): Promise<void> {
    if (Object.keys(input).length === 0) throw HttpError.unprocessable('NOTHING_TO_UPDATE', 'No fields to update');
    if (input.trainerId !== undefined) await this.assertTrainersOwned(tenantId, [input.trainerId]);
    const updated = await this.deps.repository.updateCourse(tenantId, actor, id, input);
    if (!updated) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
  }

  createTrainer(tenantId: string, actor: Actor, input: TrainerInput): Promise<string> {
    return this.deps.repository.createTrainer(tenantId, actor, input);
  }

  async createTrainee(tenantId: string, actor: Actor, input: { email: string; fullName: string; password: string }): Promise<string> {
    const passwordHash = await this.deps.hashPassword(input.password);
    try {
      return await this.deps.repository.createTrainee(tenantId, actor, {
        email: input.email.trim().toLowerCase(),
        fullName: input.fullName,
        passwordHash,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw HttpError.conflict('EMAIL_TAKEN', 'A user with this email already exists in this academy');
      throw err;
    }
  }

  async createPlan(tenantId: string, actor: Actor, input: PlanInput): Promise<string> {
    if (new Set(input.courseIds).size !== input.courseIds.length) {
      throw HttpError.unprocessable('DUPLICATE_COURSES', 'A course appears more than once in the plan');
    }
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
      throw HttpError.unprocessable('INVALID_PERIOD', 'The plan must end on or after its start date');
    }
    await this.assertCoursesOwned(tenantId, input.courseIds);
    return this.deps.repository.createPlan(tenantId, actor, input);
  }

  async createClassroom(tenantId: string, actor: Actor, input: ClassroomInput): Promise<string> {
    if (input.startsAt <= this.clock()) {
      throw HttpError.unprocessable('START_IN_PAST', 'A virtual classroom must be scheduled in the future');
    }
    if (input.courseId) await this.assertCoursesOwned(tenantId, [input.courseId]);
    if (input.trainerId) await this.assertTrainersOwned(tenantId, [input.trainerId]);

    // Zoom classroom without a pasted link: create the meeting at Zoom first.
    let externalMeetingId: string | null = null;
    let joinUrl = input.joinUrl;
    if (input.provider === 'ZOOM' && !joinUrl && this.meetings.available) {
      try {
        const meeting = await this.meetings.create({ topic: input.title, startsAt: input.startsAt, durationMinutes: input.durationMinutes });
        externalMeetingId = meeting.externalId;
        joinUrl = meeting.joinUrl;
      } catch (err) {
        logger.warn('Meeting creation failed', { err: err instanceof Error ? err.message : err });
        throw meetingFailed();
      }
    }

    try {
      return await this.deps.repository.createClassroom(tenantId, actor, { ...input, joinUrl, externalMeetingId });
    } catch (err) {
      // Don't leave an orphan meeting in the provider's Zoom account.
      if (externalMeetingId) await this.meetings.remove(externalMeetingId).catch(() => undefined);
      throw err;
    }
  }

  // ----- edit / delete -----

  async deleteCourse(tenantId: string, actor: Actor, id: string): Promise<void> {
    assertDeleted(
      await this.deps.repository.deleteCourse(tenantId, actor, id),
      HttpError.notFound('COURSE_NOT_FOUND', 'Course not found'),
      HttpError.conflict('COURSE_HAS_ENROLLMENTS', 'This course has enrolled trainees; unpublish it instead of deleting'),
    );
  }

  async updateTrainer(tenantId: string, actor: Actor, id: string, input: Partial<TrainerInput>): Promise<void> {
    if (Object.keys(input).length === 0) throw HttpError.unprocessable('NOTHING_TO_UPDATE', 'No fields to update');
    if (!(await this.deps.repository.updateTrainer(tenantId, actor, id, input))) {
      throw HttpError.notFound('TRAINER_NOT_FOUND', 'Trainer not found');
    }
  }

  async deleteTrainer(tenantId: string, actor: Actor, id: string): Promise<void> {
    assertDeleted(
      await this.deps.repository.deleteTrainer(tenantId, actor, id),
      HttpError.notFound('TRAINER_NOT_FOUND', 'Trainer not found'),
      HttpError.conflict('TRAINER_IN_USE', 'Reassign this trainer’s courses before deleting'),
    );
  }

  async updateTrainee(tenantId: string, actor: Actor, id: string, input: { fullName: string }): Promise<void> {
    if (!(await this.deps.repository.updateTrainee(tenantId, actor, id, input))) {
      throw HttpError.notFound('TRAINEE_NOT_FOUND', 'Trainee not found');
    }
  }

  async deleteTrainee(tenantId: string, actor: Actor, id: string): Promise<void> {
    assertDeleted(
      await this.deps.repository.deleteTrainee(tenantId, actor, id),
      HttpError.notFound('TRAINEE_NOT_FOUND', 'Trainee not found'),
      HttpError.conflict('TRAINEE_HAS_ENROLLMENTS', 'Trainees with enrollments and invoices cannot be deleted'),
    );
  }

  async updatePlan(tenantId: string, actor: Actor, id: string, input: Partial<PlanInput>): Promise<void> {
    if (Object.keys(input).length === 0) throw HttpError.unprocessable('NOTHING_TO_UPDATE', 'No fields to update');
    if (input.courseIds) {
      if (new Set(input.courseIds).size !== input.courseIds.length) {
        throw HttpError.unprocessable('DUPLICATE_COURSES', 'A course appears more than once in the plan');
      }
      await this.assertCoursesOwned(tenantId, input.courseIds);
    }
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
      throw HttpError.unprocessable('INVALID_PERIOD', 'The plan must end on or after its start date');
    }
    if (!(await this.deps.repository.updatePlan(tenantId, actor, id, input))) {
      throw HttpError.notFound('PLAN_NOT_FOUND', 'Plan not found');
    }
  }

  async deletePlan(tenantId: string, actor: Actor, id: string): Promise<void> {
    if (!(await this.deps.repository.deletePlan(tenantId, actor, id))) throw HttpError.notFound('PLAN_NOT_FOUND', 'Plan not found');
  }

  async getClassroom(tenantId: string, id: string): Promise<ClassroomRow> {
    const room = await this.deps.repository.getClassroom(tenantId, id);
    if (!room) throw HttpError.notFound('CLASSROOM_NOT_FOUND', 'Virtual classroom not found');
    return room;
  }

  async updateClassroom(tenantId: string, actor: Actor, id: string, input: ClassroomUpdate): Promise<void> {
    if (Object.keys(input).length === 0) throw HttpError.unprocessable('NOTHING_TO_UPDATE', 'No fields to update');
    const current = await this.getClassroom(tenantId, id);
    if (input.startsAt && input.startsAt <= this.clock() && input.startsAt.getTime() !== current.startsAt.getTime()) {
      throw HttpError.unprocessable('START_IN_PAST', 'A virtual classroom must be scheduled in the future');
    }
    if (input.courseId) await this.assertCoursesOwned(tenantId, [input.courseId]);
    if (input.trainerId) await this.assertTrainersOwned(tenantId, [input.trainerId]);

    const changes: ClassroomUpdate & { externalMeetingId?: string | null } = { ...input };
    if (current.externalMeetingId) {
      if (input.status === 'CANCELLED' || (input.provider && input.provider !== 'ZOOM')) {
        // Cancelled or moved off Zoom: remove the Zoom meeting.
        await this.meetings.remove(current.externalMeetingId).catch((err: unknown) => {
          logger.warn('Meeting removal failed', { err: err instanceof Error ? err.message : err });
        });
        changes.externalMeetingId = null;
        if (input.provider && input.provider !== 'ZOOM' && input.joinUrl === undefined) changes.joinUrl = null;
      } else if (input.title || input.startsAt || input.durationMinutes) {
        // Keep the Zoom meeting in sync with the new time/title.
        try {
          await this.meetings.update(current.externalMeetingId, {
            topic: input.title ?? current.title,
            startsAt: input.startsAt ?? current.startsAt,
            durationMinutes: input.durationMinutes ?? current.durationMinutes,
          });
        } catch {
          throw meetingFailed();
        }
      }
    }

    if (!(await this.deps.repository.updateClassroom(tenantId, actor, id, changes))) {
      throw HttpError.notFound('CLASSROOM_NOT_FOUND', 'Virtual classroom not found');
    }
  }

  async listAttendance(tenantId: string, classroomId: string) {
    await this.getClassroom(tenantId, classroomId);
    return this.deps.repository.listAttendance(tenantId, classroomId);
  }

  async deleteClassroom(tenantId: string, actor: Actor, id: string): Promise<void> {
    const current = await this.getClassroom(tenantId, id);
    await this.deps.repository.deleteClassroom(tenantId, actor, id);
    if (current.externalMeetingId) {
      // Best effort: the classroom is already gone for trainees either way.
      await this.meetings.remove(current.externalMeetingId).catch((err: unknown) => {
        logger.warn('Meeting removal failed', { err: err instanceof Error ? err.message : err });
      });
    }
  }

  // ----- ownership guards -----

  private async assertCoursesOwned(tenantId: string, courseIds: string[]): Promise<void> {
    if (courseIds.length === 0) return;
    const { courses } = await this.deps.repository.countOwned(tenantId, { courseIds });
    if (courses !== courseIds.length) throw HttpError.unprocessable('UNKNOWN_COURSE', 'One or more courses do not exist in this academy');
  }

  private async assertTrainersOwned(tenantId: string, trainerIds: string[]): Promise<void> {
    const { trainers } = await this.deps.repository.countOwned(tenantId, { trainerIds });
    if (trainers !== trainerIds.length) throw HttpError.unprocessable('UNKNOWN_TRAINER', 'The trainer does not exist in this academy');
  }
}
