import { HttpError } from '../../shared/utils/http-error';
import type { ProviderRepository } from './provider.repository';
import type {
  Actor,
  AdminCourseRow,
  ClassroomInput,
  ClassroomRow,
  CourseInput,
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
  clock?: () => Date;
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

  constructor(private readonly deps: ProviderServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
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
    return this.deps.repository.createClassroom(tenantId, actor, input);
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
