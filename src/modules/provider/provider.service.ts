import { randomBytes } from 'node:crypto';
import { logger } from '../../shared/services/logger';
import type { Mailer } from '../../shared/services/mailer';
import { HttpError } from '../../shared/utils/http-error';
import { ManualMeetingScheduler, type MeetingScheduler } from '../live/meeting-scheduler';
import { invitationMessage } from './enrollment-invite';
import { firstPairConflict, scheduleConflictError } from './plan-schedule';
import type { ProviderRepository } from './provider.repository';
import { buildTraineeTemplate, cleanTrainee, dedupeBatch, parseTraineeSheet, TRAINEE_LIMITS, type TraineeDraft } from './trainee.excel';
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
  CourseDeletionSummary,
  CourseRosterRow,
  TraineeEnrollmentResult,
  TraineeRow,
  TrainerInput,
  TrainerRow,
} from './provider.types';

/** The platform owner's approval for deleting a course that has trainees: a code is e-mailed to the owner, not to the admin. */
export interface CourseDeleteApprovals {
  request(input: { tenantId: string; tenantName: string; requesterId: string; courseId: string; details: string[] }): Promise<{ challengeId: string; expiresInSec: number }>;
  confirm(input: { tenantId: string; requesterId: string; courseId: string; challengeId: string; code: string }): Promise<void>;
}

export interface ProviderServiceDeps {
  repository: ProviderRepository;
  hashPassword: (password: string) => Promise<string>;
  /** Live-meeting provider (Zoom). Defaults to manual links. */
  meetings?: MeetingScheduler;
  /** Owner approval for deleting courses with trainees. Without it such deletions are unavailable. */
  approvals?: CourseDeleteApprovals;
  /** Sends the invitation when a trainer is given a login. Without it the account is still created, just not announced. */
  mailer?: Mailer;
  /** Public site address for the link in that invitation. */
  webUrl?: string;
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
  /** Invitation e-mails still being sent in the background (so they can be awaited in tests and on shutdown). */
  private readonly inflight = new Set<Promise<void>>();
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

  // ----- corporate trainees: enroll employees into a course -----

  async courseRoster(tenantId: string, courseId: string): Promise<CourseRosterRow[]> {
    await this.assertCoursesOwned(tenantId, [courseId]);
    return this.deps.repository.listCourseRoster(tenantId, courseId);
  }

  traineeTemplate(): Promise<Buffer> {
    return buildTraineeTemplate();
  }

  /** Employees typed into the form (JSON). Same validation as the spreadsheet, so both paths behave alike. */
  async enrollTrainees(
    tenantId: string,
    actor: Actor,
    courseId: string,
    people: { fullName: string; email: string; phone?: string | null; employeeNo?: string | null }[],
  ): Promise<TraineeEnrollmentResult[]> {
    if (people.length === 0) throw HttpError.unprocessable('NO_TRAINEES', 'Add at least one employee');
    if (people.length > TRAINEE_LIMITS.maxRows) {
      throw HttpError.unprocessable('TOO_MANY_TRAINEES', `At most ${TRAINEE_LIMITS.maxRows} employees per request`);
    }
    const drafts: { row: number; draft: TraineeDraft }[] = [];
    const errors: { row: number; message: string }[] = [];
    people.forEach((p, i) => {
      const cleaned = cleanTrainee(p);
      if (typeof cleaned === 'string') errors.push({ row: i + 1, message: cleaned });
      else drafts.push({ row: i + 1, draft: cleaned });
    });
    const deduped = dedupeBatch(drafts);
    errors.push(...deduped.errors);
    // All-or-nothing on the input itself: nothing is written until the whole list is clean.
    if (errors.length > 0) throw HttpError.unprocessable('INVALID_TRAINEES', 'Some employees have invalid data', { errors });
    return this.writeEnrollments(tenantId, actor, courseId, deduped.trainees);
  }

  /** Employees from an uploaded .xlsx / .csv. Nothing is written if any row is invalid, so the admin fixes the sheet once. */
  async importTrainees(tenantId: string, actor: Actor, courseId: string, file: Buffer): Promise<TraineeEnrollmentResult[]> {
    const parsed = await parseTraineeSheet(file);
    if (parsed.errors.length > 0) throw HttpError.unprocessable('INVALID_TRAINEE_SHEET', 'The file has rows that need fixing', { errors: parsed.errors });
    return this.writeEnrollments(tenantId, actor, courseId, parsed.trainees);
  }

  // ----- invitations: an e-mail to every newly enrolled employee -----

  /** Like enrollTrainees, and (when asked) e-mails each NEWLY enrolled employee an invitation. */
  async enrollTraineesInvited(
    tenantId: string,
    actor: Actor,
    academy: { name: string; slug: string },
    courseId: string,
    people: { fullName: string; email: string; phone?: string | null; employeeNo?: string | null }[],
    invite: boolean,
  ): Promise<{ results: TraineeEnrollmentResult[]; invitations: number }> {
    const results = await this.enrollTrainees(tenantId, actor, courseId, people);
    return { results, invitations: invite ? await this.queueInvitations(tenantId, academy, courseId, results.filter((r) => r.status === 'enrolled')) : 0 };
  }

  async importTraineesInvited(tenantId: string, actor: Actor, academy: { name: string; slug: string }, courseId: string, file: Buffer, invite: boolean): Promise<{ results: TraineeEnrollmentResult[]; invitations: number }> {
    const results = await this.importTrainees(tenantId, actor, courseId, file);
    return { results, invitations: invite ? await this.queueInvitations(tenantId, academy, courseId, results.filter((r) => r.status === 'enrolled')) : 0 };
  }

  /** Sends the invitation again to the employees the admin enrolled in this course (still active, not finished). */
  async resendInvitations(tenantId: string, academy: { name: string; slug: string }, courseId: string): Promise<number> {
    await this.assertCoursesOwned(tenantId, [courseId]);
    const roster = await this.deps.repository.listCourseRoster(tenantId, courseId);
    const targets = roster.filter((r) => r.source === 'ADMIN' && r.status === 'ACTIVE' && r.completionStatus !== 'COMPLETED').map((r) => ({ email: r.email, fullName: r.fullName ?? r.email, accountCreated: false }));
    return this.queueInvitations(tenantId, academy, courseId, targets);
  }

  /** Resolves when every invitation e-mail started so far has been attempted. */
  async drainInvitations(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  /**
   * Sends in the background (a few at a time) so a list of hundreds never holds the request; a failed e-mail is logged and
   * does not undo anything: the employee is enrolled and can sign in from the academy's login page regardless.
   * Returns how many invitations were queued (0 when e-mail is not available).
   */
  private async queueInvitations(tenantId: string, academy: { name: string; slug: string }, courseId: string, targets: { email: string; fullName: string; accountCreated: boolean }[]): Promise<number> {
    const { mailer, webUrl } = this.deps;
    if (!mailer || !webUrl || targets.length === 0) return 0;
    const course = await this.deps.repository.courseInvitationInfo(tenantId, courseId);
    if (!course) return 0;
    const queue = [...targets];
    const worker = async (): Promise<void> => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          await mailer.send({ to: t.email, ...invitationMessage({ name: t.fullName, academy, webUrl, course, accountCreated: t.accountCreated }) });
        } catch (err) {
          logger.warn('Enrollment invitation e-mail failed', { err: err instanceof Error ? err.message : err });
        }
      }
    };
    const job = Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker)).then(() => undefined);
    this.inflight.add(job);
    void job.finally(() => this.inflight.delete(job));
    return targets.length;
  }

  private async writeEnrollments(tenantId: string, actor: Actor, courseId: string, trainees: TraineeDraft[]): Promise<TraineeEnrollmentResult[]> {
    await this.assertCoursesOwned(tenantId, [courseId]);
    // One hash shared by the batch: it is of a random secret nobody knows, because trainees sign in with an e-mailed code.
    const passwordHash = await this.deps.hashPassword(randomBytes(32).toString('hex'));
    return this.deps.repository.enrollTrainees(tenantId, actor, courseId, trainees, passwordHash);
  }

  async createPlan(tenantId: string, actor: Actor, input: PlanInput): Promise<string> {
    if (new Set(input.courseIds).size !== input.courseIds.length) {
      throw HttpError.unprocessable('DUPLICATE_COURSES', 'A course appears more than once in the plan');
    }
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
      throw HttpError.unprocessable('INVALID_PERIOD', 'The plan must end on or after its start date');
    }
    await this.assertCoursesOwned(tenantId, input.courseIds);
    await this.assertNoOverlap(tenantId, input.courseIds);
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

  /** Step 1 for a course WITH trainees: asks the platform owner to approve (a code goes to the owner's e-mail). */
  async requestCourseDeletion(tenantId: string, actor: Actor, tenantName: string, courseId: string): Promise<{ challengeId: string; expiresInSec: number }> {
    if (!this.deps.approvals) throw new HttpError(503, 'APPROVAL_UNAVAILABLE', 'Owner approval is not available');
    const course = await this.getCourse(tenantId, courseId);
    if (course.enrollmentCount === 0) throw HttpError.unprocessable('NO_APPROVAL_NEEDED', 'This course has no trainees; delete it directly');
    return this.deps.approvals.request({
      tenantId,
      tenantName,
      requesterId: actor.userId,
      courseId,
      details: [`الدورة: ${course.title}`, `عدد المتدربين المسجلين: ${course.enrollmentCount}`],
    });
  }

  /** Step 2: the owner's code (bound to this course and this admin) unlocks the deletion of the course and its trainees' records. */
  async deleteCourseApproved(tenantId: string, actor: Actor, courseId: string, challengeId: string, code: string): Promise<CourseDeletionSummary> {
    if (!this.deps.approvals) throw new HttpError(503, 'APPROVAL_UNAVAILABLE', 'Owner approval is not available');
    await this.getCourse(tenantId, courseId); // 404 before a code is spent
    await this.deps.approvals.confirm({ tenantId, requesterId: actor.userId, courseId, challengeId, code });
    const summary = await this.deps.repository.deleteCourseWithEnrollments(tenantId, actor, courseId);
    if (!summary) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return summary;
  }

  /**
   * Gives a trainer a login (an e-mailed code, no password) and invites them. Returns whether the invitation e-mail went out;
   * a failed e-mail does not undo the account: the trainer can still sign in from the academy's login page.
   */
  async grantTrainerAccount(tenantId: string, actor: Actor, academy: { name: string; slug: string }, trainerId: string): Promise<{ invited: boolean }> {
    // The account has no usable password: the trainer signs in with the code e-mailed to them.
    const passwordHash = await this.deps.hashPassword(randomBytes(32).toString('hex'));
    const r = await this.deps.repository.grantTrainerAccount(tenantId, actor, trainerId, passwordHash);
    if (r.kind === 'not_found') throw HttpError.notFound('TRAINER_NOT_FOUND', 'Trainer not found');
    if (r.kind === 'already_has_account') throw HttpError.conflict('TRAINER_HAS_ACCOUNT', 'This trainer already has a login');
    if (r.kind === 'no_email') throw HttpError.unprocessable('TRAINER_EMAIL_REQUIRED', 'Add the trainer\'s e-mail first');
    if (r.kind === 'email_taken') throw HttpError.conflict('EMAIL_TAKEN', 'This e-mail already has an account in this academy');
    return { invited: await this.invite(r.email, r.fullName, academy) };
  }

  async revokeTrainerAccount(tenantId: string, actor: Actor, trainerId: string): Promise<void> {
    const r = await this.deps.repository.revokeTrainerAccount(tenantId, actor, trainerId);
    if (r === 'not_found') throw HttpError.notFound('TRAINER_NOT_FOUND', 'Trainer not found');
    if (r === 'no_account') throw HttpError.conflict('TRAINER_HAS_NO_ACCOUNT', 'This trainer has no login to remove');
  }

  private async invite(email: string, name: string, academy: { name: string; slug: string }): Promise<boolean> {
    if (!this.deps.mailer || !this.deps.webUrl) return false;
    const url = `${this.deps.webUrl.replace(/\/$/, '')}/${academy.slug}/login`;
    const text = [
      `مرحباً ${name}،`,
      '',
      `أُضيفت لك حسابات دخول مدرّب في أكاديمية «${academy.name}».`,
      `للدخول افتح: ${url}`,
      'واكتب بريدك الإلكتروني هذا، فيصلك رمز من ٦ أرقام تكتبه ثم تدخل إلى صفحتك (دوراتك وجلساتك المباشرة ومتدربوك). لا حاجة لكلمة مرور.',
    ].join('\n');
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1b1f1e;max-width:520px"><p>مرحباً ${esc(name)}،</p><p>أُضيف لك حساب دخول مدرّب في أكاديمية <strong>«${esc(academy.name)}»</strong>.</p><p><a href="${esc(url)}">${esc(url)}</a></p><p>اكتب بريدك الإلكتروني هذا في صفحة الدخول، فيصلك رمز من ٦ أرقام تكتبه ثم تدخل إلى صفحتك (دوراتك وجلساتك المباشرة ومتدربوك). لا حاجة لكلمة مرور.</p></div>`;
    try {
      await this.deps.mailer.send({ to: email, subject: `دعوة دخول مدرّب — ${academy.name}`, text, html });
      return true;
    } catch (err) {
      logger.warn('Trainer invitation e-mail failed', { err: err instanceof Error ? err.message : err });
      return false;
    }
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
      await this.assertNoOverlap(tenantId, input.courseIds);
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

  /** No two dated recorded courses of a plan may share clock time (days and times); undated courses cannot conflict. */
  private async assertNoOverlap(tenantId: string, courseIds: string[]): Promise<void> {
    const pair = firstPairConflict(await this.deps.repository.loadCourseSchedules(tenantId, courseIds));
    if (pair) throw scheduleConflictError({ ...pair.conflict, withCourseId: pair.b.courseId, withTitle: pair.b.title }, null);
  }

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
