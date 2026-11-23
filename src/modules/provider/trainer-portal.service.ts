import type { CompletionStatus, CourseType, EnrollmentStatus, MeetingProvider } from '@prisma/client';
import { HttpError } from '../../shared/utils/http-error';

/** The trainer's own page: who they are, what they teach, their live sessions, and how their trainees are doing. */
export interface TrainerProfile {
  id: string;
  fullName: string;
  specialization: string | null;
  bio: string | null;
}

export interface TrainerCourseRow {
  id: string;
  title: string;
  type: CourseType;
  isPublished: boolean;
  enrollmentCount: number;
  /** Day 1 of a recorded course (null for other courses or when no date was set). */
  startsAt: Date | null;
  durationDays: number | null;
}

export interface TrainerSessionRow {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  provider: MeetingProvider;
  joinUrl: string | null;
  courseTitle: string | null;
}

/**
 * One trainee of one of the trainer's courses. Deliberately only what following their progress needs: no e-mail, phone,
 * national ID or staff number (data minimisation: the academy's admin holds those).
 */
export interface TrainerTraineeRow {
  name: string;
  progress: number;
  completionStatus: CompletionStatus;
  status: EnrollmentStatus;
  enrolledAt: Date;
}

export interface TrainerPortalRepository {
  /** The trainer record linked to this login (Trainer.userId), or null when the account is not a trainer's. */
  findTrainerByUser(tenantId: string, userId: string): Promise<TrainerProfile | null>;
  listCourses(tenantId: string, trainerId: string): Promise<TrainerCourseRow[]>;
  listUpcomingSessions(tenantId: string, trainerId: string, from: Date, take: number): Promise<TrainerSessionRow[]>;
  /** Null when the course does not exist OR belongs to another trainer: a trainer never sees someone else's trainees. */
  listCourseTrainees(tenantId: string, trainerId: string, courseId: string): Promise<{ title: string; trainees: TrainerTraineeRow[] } | null>;
}

export class TrainerPortalService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: TrainerPortalRepository,
    clock?: () => Date,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  private async trainerOf(tenantId: string, userId: string): Promise<TrainerProfile> {
    const trainer = await this.repository.findTrainerByUser(tenantId, userId);
    if (!trainer) throw HttpError.notFound('TRAINER_PROFILE_NOT_FOUND', 'This account is not linked to a trainer profile');
    return trainer;
  }

  async overview(tenantId: string, userId: string): Promise<{ trainer: TrainerProfile; courses: TrainerCourseRow[]; sessions: TrainerSessionRow[] }> {
    const trainer = await this.trainerOf(tenantId, userId);
    // A session stays joinable for 12 hours after it starts (same window learners get).
    const from = new Date(this.clock().getTime() - 12 * 3_600_000);
    const [courses, sessions] = await Promise.all([this.repository.listCourses(tenantId, trainer.id), this.repository.listUpcomingSessions(tenantId, trainer.id, from, 20)]);
    return { trainer, courses, sessions };
  }

  async courseTrainees(tenantId: string, userId: string, courseId: string): Promise<{ title: string; trainees: TrainerTraineeRow[] }> {
    const trainer = await this.trainerOf(tenantId, userId);
    const result = await this.repository.listCourseTrainees(tenantId, trainer.id, courseId);
    if (!result) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return result;
  }
}
