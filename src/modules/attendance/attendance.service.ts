import { HttpError } from '../../shared/utils/http-error';
import {
  checkInOpen,
  checkInOpensAt,
  courseAttendance,
  evaluate,
  finalizeDueAt,
  lateAfter,
  mergeRules,
  RULE_LIMITS,
  type AttendanceRules,
  type AttendanceSettings,
  type AttendanceStatus,
  type CourseAttendance,
  type SessionKind,
} from './attendance.engine';
import type { AttendanceRecord, AttendanceRepository, SessionDescriptor, TraineeRef } from './attendance.repository';

/** The e-mailed code that proves who is checking in (bound to the session, so one code cannot check into another). */
export interface AttendanceOtp {
  request(tenantId: string, tenantName: string, userId: string, sessionRef: string): Promise<{ challengeId: string; expiresInSec: number }>;
  confirm(tenantId: string, userId: string, sessionRef: string, challengeId: string, code: string): Promise<void>;
}

export interface AttendanceServiceDeps {
  repository: AttendanceRepository;
  otp: AttendanceOtp;
  clock?: () => Date;
}

/** Where a session is from the trainee's point of view. */
export type SessionState = 'UPCOMING' | 'OPEN' | 'CHECKED_IN' | 'ENDED';

export interface MySession {
  session: SessionDescriptor;
  state: SessionState;
  checkInOpensAt: Date;
  checkedInAt: Date | null;
  /** The settled result once the session is over and settled; otherwise null. */
  result: AttendanceStatus | null;
}

export interface ReportSession {
  kind: SessionKind;
  ref: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** False while the session has not ended yet (its result is still pending). */
  held: boolean;
}

export interface ReportTrainee {
  userId: string;
  name: string;
  adminEnrolled: boolean;
  /** Status per session ref. */
  statuses: Record<string, AttendanceStatus>;
  /** Sessions where the admin decided the status by hand: session ref -> the reason. */
  adjusted: Record<string, string>;
  summary: CourseAttendance;
}

export interface CourseReport {
  course: { id: string; title: string };
  /** The rules in force for this course, and the settings the admin saved for it (null = default). */
  rules: AttendanceRules;
  settings: AttendanceSettings;
  sessions: ReportSession[];
  trainees: ReportTrainee[];
  /** Share of trainees who reach the pass mark over the sessions held so far (null when nothing is held). */
  passingTrainees: number;
}

const key = (kind: SessionKind, ref: string) => `${kind}:${ref}`;

export class AttendanceService {
  private readonly clock: () => Date;

  constructor(private readonly deps: AttendanceServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  // ---------- the trainee ----------

  /** Today's sessions of the courses the trainee is enrolled in, with what they can do about each. */
  async mySessions(tenantId: string, userId: string): Promise<MySession[]> {
    const now = this.clock();
    const courseIds = new Set(await this.deps.repository.activeCourseIds(tenantId, userId));
    if (courseIds.size === 0) return [];
    // Sessions that ended up to 3 hours ago stay visible (to see how they went); those starting within 24 h are listed.
    const sessions = (await this.deps.repository.listSessions(tenantId, new Date(now.getTime() - 3 * 3_600_000), new Date(now.getTime() + 24 * 3_600_000))).filter((s) => courseIds.has(s.courseId));
    return Promise.all(
      sessions.map(async (session) => {
        const record = await this.deps.repository.getRecord(tenantId, userId, session.kind, session.ref);
        const window = { startsAt: session.startsAt, endsAt: session.endsAt };
        const state: SessionState = record?.otpVerifiedAt ? (now >= session.endsAt ? 'ENDED' : 'CHECKED_IN') : now >= session.endsAt ? 'ENDED' : checkInOpen(window, now) ? 'OPEN' : 'UPCOMING';
        return {
          session,
          state,
          checkInOpensAt: checkInOpensAt(window),
          checkedInAt: record?.otpVerifiedAt ?? null,
          result: record?.finalizedAt ? record.status : null,
        };
      }),
    );
  }

  private async sessionFor(tenantId: string, userId: string, kind: SessionKind, ref: string): Promise<{ session: SessionDescriptor; record: AttendanceRecord | null }> {
    const session = await this.deps.repository.getSession(tenantId, kind, ref);
    if (!session) throw HttpError.notFound('SESSION_NOT_FOUND', 'Session not found');
    if (!(await this.deps.repository.activeCourseIds(tenantId, userId)).includes(session.courseId)) throw HttpError.forbidden('You are not enrolled in this course');
    const now = this.clock();
    if (!checkInOpen({ startsAt: session.startsAt, endsAt: session.endsAt }, now)) {
      throw HttpError.unprocessable('CHECKIN_CLOSED', 'Check-in is open from 15 minutes before the session until it ends', { opens_at: checkInOpensAt(session).toISOString(), ends_at: session.endsAt.toISOString() });
    }
    const record = await this.deps.repository.getRecord(tenantId, userId, kind, ref);
    if (record?.otpVerifiedAt) throw HttpError.conflict('ALREADY_CHECKED_IN', 'You already checked in to this session');
    return { session, record };
  }

  /** Step 1: sends the confirmation code to the trainee's e-mail. */
  async requestCheckIn(tenantId: string, tenantName: string, userId: string, kind: SessionKind, ref: string): Promise<{ challengeId: string; expiresInSec: number }> {
    await this.sessionFor(tenantId, userId, kind, ref);
    return this.deps.otp.request(tenantId, tenantName, userId, ref);
  }

  /** Step 2: the right code records the check-in (late or not is decided by when it happens). */
  async confirmCheckIn(tenantId: string, userId: string, kind: SessionKind, ref: string, challengeId: string, code: string): Promise<{ checkedInAt: Date; late: boolean; joinUrl: string | null }> {
    const { session } = await this.sessionFor(tenantId, userId, kind, ref);
    await this.deps.otp.confirm(tenantId, userId, ref, challengeId, code);
    const now = this.clock();
    const record = await this.deps.repository.recordCheckIn(tenantId, userId, session, now);
    const at = record.otpVerifiedAt ?? now;
    return { checkedInAt: at, late: at > lateAfter(session), joinUrl: session.kind === 'LIVE' ? session.joinUrl : null };
  }

  // ---------- Zoom ----------

  /** A Zoom join / leave event: matched to a trainee by e-mail among the course's enrolled trainees; anyone else is ignored. */
  async onZoomPresence(tenantId: string, classroomId: string, email: string | null, event: 'join' | 'leave', at: Date): Promise<void> {
    if (!email) return;
    const session = await this.deps.repository.getSession(tenantId, 'LIVE', classroomId);
    if (!session) return;
    const userId = await this.deps.repository.findTraineeByEmail(tenantId, session.courseId, email);
    if (!userId) return;
    if (event === 'join') await this.deps.repository.addJoin(tenantId, userId, session, at);
    else await this.deps.repository.addLeave(tenantId, userId, session, at);
  }

  // ---------- settling a session (used by the periodic sweep) ----------

  /** Evaluates every active trainee of the session and stores the result; `finalized` once the settling time has passed. */
  async settle(tenantId: string, session: SessionDescriptor, trainees: TraineeRef[], now: Date): Promise<void> {
    const evidence = await this.deps.repository.loadEvidence(tenantId, session, trainees.map((t) => t.userId));
    const finalized = now >= finalizeDueAt(session);
    for (const t of trainees) {
      const outcome = evaluate(session.kind, { startsAt: session.startsAt, endsAt: session.endsAt, rules: session.rules }, evidence.get(t.userId) ?? { otpVerifiedAt: null, intervals: [] }, now);
      await this.deps.repository.saveOutcome(tenantId, t.userId, session, outcome, finalized);
    }
  }

  // ---------- the academy's admin ----------

  /** Every course that has sessions, with how many sessions were held and how many trainees reach the pass mark. */
  async overview(tenantId: string): Promise<{ courseId: string; title: string; sessions: number; held: number; trainees: number; passingTrainees: number }[]> {
    const sessions = await this.deps.repository.listSessions(tenantId, new Date(0), new Date('2100-01-01T00:00:00Z'));
    const courseIds = [...new Set(sessions.map((s) => s.courseId))];
    const rows = [];
    for (const id of courseIds) {
      const r = await this.courseReport(tenantId, id);
      rows.push({ courseId: id, title: r.course.title, sessions: r.sessions.length, held: r.sessions.filter((s) => s.held).length, trainees: r.trainees.length, passingTrainees: r.passingTrainees });
    }
    return rows.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
  }

  /** Per course: how every trainee did in every session, and the 85% result. Computed from the evidence, not just the stored rows. */
  async courseReport(tenantId: string, courseId: string): Promise<CourseReport> {
    const info = await this.deps.repository.courseInfo(tenantId, courseId);
    if (!info) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    const rules = mergeRules(info.settings);
    const now = this.clock();
    const [sessions, trainees, records] = await Promise.all([
      this.deps.repository.listSessions(tenantId, new Date(0), new Date('2100-01-01T00:00:00Z'), courseId),
      this.deps.repository.courseTrainees(tenantId, courseId),
      this.deps.repository.listCourseRecords(tenantId, courseId),
    ]);
    const stored = new Map(records.map((r) => [`${key(r.kind, r.sessionRef)}:${r.userId}`, r]));
    const statuses = new Map<string, Record<string, AttendanceStatus>>(trainees.map((t) => [t.userId, {}]));
    const adjusted = new Map<string, Record<string, string>>(trainees.map((t) => [t.userId, {}]));

    for (const s of sessions) {
      const held = now >= s.endsAt;
      const settledForAll = trainees.every((t) => stored.get(`${key(s.kind, s.ref)}:${t.userId}`)?.finalizedAt);
      const evidence = held && !settledForAll ? await this.deps.repository.loadEvidence(tenantId, s, trainees.map((t) => t.userId)) : null;
      for (const t of trainees) {
        const row = stored.get(`${key(s.kind, s.ref)}:${t.userId}`);
        let status: AttendanceStatus;
        // The admin's own decision always stands (even for a session not yet over, e.g. excusing someone who is leaving early).
        if (row?.source === 'MANUAL') {
          status = row.status;
          (adjusted.get(t.userId) as Record<string, string>)[s.ref] = row.note ?? '';
        } else if (!held) status = 'PENDING';
        else if (row?.finalizedAt) status = row.status;
        else status = evaluate(s.kind, { startsAt: s.startsAt, endsAt: s.endsAt, rules: s.rules }, evidence?.get(t.userId) ?? { otpVerifiedAt: null, intervals: [] }, now).status;
        (statuses.get(t.userId) as Record<string, AttendanceStatus>)[s.ref] = status;
      }
    }

    const rows = trainees.map((t) => ({
      userId: t.userId,
      name: t.name,
      adminEnrolled: t.adminEnrolled,
      statuses: statuses.get(t.userId) as Record<string, AttendanceStatus>,
      adjusted: adjusted.get(t.userId) as Record<string, string>,
      summary: courseAttendance(Object.values(statuses.get(t.userId) as Record<string, AttendanceStatus>), rules.passPercent),
    }));
    return {
      course: { id: courseId, title: info.title },
      rules,
      settings: info.settings,
      sessions: sessions.map((s) => ({ kind: s.kind, ref: s.ref, title: s.title, startsAt: s.startsAt, endsAt: s.endsAt, held: now >= s.endsAt })),
      trainees: rows,
      passingTrainees: rows.filter((r) => r.summary.passes === true).length,
    };
  }

  // ---------- the academy's admin: rules and manual decisions ----------

  /** Saves the course's own rules (null = back to the default). Each value must be within its allowed range. */
  async updateSettings(tenantId: string, actorId: string, courseId: string, input: AttendanceSettings): Promise<void> {
    const fits = (v: number | null, r: { min: number; max: number }) => v === null || (Number.isInteger(v) && v >= r.min && v <= r.max);
    const bad: string[] = [];
    if (!fits(input.latePercent, RULE_LIMITS.latePercent)) bad.push('late_percent');
    if (!fits(input.leaveGraceMinutes, RULE_LIMITS.leaveGraceMinutes)) bad.push('leave_grace_minutes');
    if (!fits(input.passPercent, RULE_LIMITS.passPercent)) bad.push('pass_percent');
    if (bad.length > 0) throw HttpError.unprocessable('INVALID_SETTINGS', 'A value is outside its allowed range', { fields: bad });
    if (!(await this.deps.repository.updateCourseSettings(tenantId, actorId, courseId, input))) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
  }

  private async manualTarget(tenantId: string, courseId: string, kind: SessionKind, ref: string, userId: string): Promise<SessionDescriptor> {
    const session = await this.deps.repository.getSession(tenantId, kind, ref);
    // The session must belong to THIS course: a decision for another course's session cannot be smuggled in through this one.
    if (!session || session.courseId !== courseId) throw HttpError.notFound('SESSION_NOT_FOUND', 'Session not found in this course');
    if (!(await this.deps.repository.courseTrainees(tenantId, courseId)).some((t) => t.userId === userId)) throw HttpError.notFound('TRAINEE_NOT_FOUND', 'This person is not an active trainee of the course');
    return session;
  }

  /** The admin decides one trainee's status for one session (with a reason). Only once the session has started. */
  async adjust(tenantId: string, actorId: string, courseId: string, input: { kind: SessionKind; ref: string; userId: string; status: Exclude<AttendanceStatus, 'PENDING'>; note: string }): Promise<void> {
    const note = input.note.trim();
    if (note.length < 3 || note.length > 300) throw HttpError.unprocessable('NOTE_REQUIRED', 'Give a reason of 3-300 characters');
    const session = await this.manualTarget(tenantId, courseId, input.kind, input.ref, input.userId);
    const now = this.clock();
    if (session.startsAt > now) throw HttpError.unprocessable('SESSION_NOT_STARTED', 'Attendance can be adjusted once the session has started');
    await this.deps.repository.setManualStatus(tenantId, actorId, input.userId, session, input.status, note, now);
  }

  /** Takes a manual decision back: the automatic result applies again. */
  async revertAdjustment(tenantId: string, actorId: string, courseId: string, kind: SessionKind, ref: string, userId: string): Promise<void> {
    const session = await this.manualTarget(tenantId, courseId, kind, ref, userId);
    if (!(await this.deps.repository.clearManualStatus(tenantId, actorId, userId, session))) throw HttpError.notFound('NO_ADJUSTMENT', 'There is no manual decision to take back');
  }
}
