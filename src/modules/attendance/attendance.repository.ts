import { Prisma } from '@prisma/client';
import { prisma, withTenantTransaction } from '../../config/database';
import { DAY_MS, minutesOf, storedDayMinutes } from '../provider/plan-schedule';
import type { AttendanceStatus, Evidence, Interval, Outcome, SessionKind } from './attendance.engine';

/** One session a trainee can attend: a live classroom, or one day (module) of a recorded course. */
export interface SessionDescriptor {
  kind: SessionKind;
  /** Classroom id (LIVE) or module id (DAY). */
  ref: string;
  courseId: string;
  courseTitle: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** Live sessions: the meeting link shown after a successful check-in. */
  joinUrl: string | null;
}

export interface AttendanceRecord {
  userId: string;
  kind: SessionKind;
  sessionRef: string;
  status: AttendanceStatus;
  otpVerifiedAt: Date | null;
  firstJoinAt: Date | null;
  lastLeaveAt: Date | null;
  attendedSeconds: number;
  finalizedAt: Date | null;
}

export interface TraineeRef {
  userId: string;
  name: string;
  /** Enrolled by the academy's admin (corporate trainee) rather than self-enrolled. */
  adminEnrolled: boolean;
}

export interface AlertClaim {
  id: string;
}

export interface AttendanceRepository {
  /** Sessions whose window touches [from, to], optionally for one course (live classrooms and recorded days). */
  listSessions(tenantId: string, from: Date, to: Date, courseId?: string): Promise<SessionDescriptor[]>;
  getSession(tenantId: string, kind: SessionKind, ref: string): Promise<SessionDescriptor | null>;
  courseTitle(tenantId: string, courseId: string): Promise<string | null>;
  /** Course ids the user is actively enrolled in. */
  activeCourseIds(tenantId: string, userId: string): Promise<string[]>;
  /** Active trainees of a course. */
  courseTrainees(tenantId: string, courseId: string): Promise<TraineeRef[]>;
  getRecord(tenantId: string, userId: string, kind: SessionKind, ref: string): Promise<AttendanceRecord | null>;
  listRecords(tenantId: string, kind: SessionKind, ref: string): Promise<AttendanceRecord[]>;
  /** Records of every session of a course (for the report). */
  listCourseRecords(tenantId: string, courseId: string): Promise<AttendanceRecord[]>;
  /** Marks the trainee as having proved who they are for this session (first time only). */
  recordCheckIn(tenantId: string, userId: string, session: SessionDescriptor, at: Date): Promise<AttendanceRecord>;
  /** Zoom: a participant joined / left. Creates the open interval / closes the latest open one. */
  addJoin(tenantId: string, userId: string, session: SessionDescriptor, at: Date): Promise<void>;
  addLeave(tenantId: string, userId: string, session: SessionDescriptor, at: Date): Promise<void>;
  /** What the engine needs for these users in one session. */
  loadEvidence(tenantId: string, session: SessionDescriptor, userIds: string[]): Promise<Map<string, Evidence>>;
  saveOutcome(tenantId: string, userId: string, session: SessionDescriptor, outcome: Outcome, finalized: boolean): Promise<void>;
  /** The academy's own accounts to alert (TENANT_ADMIN). */
  adminContacts(tenantId: string): Promise<{ email: string; name: string }[]>;
  /** One alert per session. Null when it was already sent; an unsent earlier claim is returned again so it is retried. */
  claimAlert(tenantId: string, session: SessionDescriptor, absentCount: number): Promise<AlertClaim | null>;
  markAlertSent(tenantId: string, alertId: string, at: Date): Promise<void>;
  /** Academies that are live (not suspended), for the periodic sweep. */
  activeTenants(): Promise<{ id: string; name: string }[]>;
  /** Looks up a trainee by e-mail among the active enrollments of the session's course (Zoom gives an e-mail, not a user id). */
  findTraineeByEmail(tenantId: string, courseId: string, email: string): Promise<string | null>;
}

const toRecord = (r: Prisma.SessionAttendanceGetPayload<object>): AttendanceRecord => ({
  userId: r.userId,
  kind: r.kind as SessionKind,
  sessionRef: r.sessionRef,
  status: r.status as AttendanceStatus,
  otpVerifiedAt: r.otpVerifiedAt,
  firstJoinAt: r.firstJoinAt,
  lastLeaveAt: r.lastLeaveAt,
  attendedSeconds: r.attendedSeconds,
  finalizedAt: r.finalizedAt,
});

const nameOf = (u: { fullName: string | null; email: string }) => u.fullName ?? u.email.split('@')[0] ?? u.email;
const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

type Tx = Prisma.TransactionClient;

/** Recorded days: every dated recorded course contributes one session per day, day N starting N-1 days after day 1 at the same time. */
async function recordedDays(tx: Tx, tenantId: string, filter: { courseId?: string; moduleId?: string }): Promise<SessionDescriptor[]> {
  const courses = await tx.course.findMany({
    where: {
      tenantId,
      sourceVideoId: { not: null },
      scheduleStartsAt: { not: null },
      ...(filter.courseId ? { id: filter.courseId } : {}),
      ...(filter.moduleId ? { modules: { some: { id: filter.moduleId } } } : {}),
    },
    select: {
      id: true,
      title: true,
      scheduleStartsAt: true,
      scheduleConfig: true,
      modules: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, lessons: { select: { startSecond: true, endSecond: true } } } },
    },
  });
  return courses.flatMap((c) =>
    c.modules.flatMap((m, index) => {
      if (filter.moduleId && m.id !== filter.moduleId) return [];
      const start = new Date((c.scheduleStartsAt as Date).getTime() + index * DAY_MS);
      const minutes = storedDayMinutes(m.lessons, minutesOf(c.scheduleConfig, 'breakMinutes'), minutesOf(c.scheduleConfig, 'discussionMinutes'));
      return [{ kind: 'DAY' as const, ref: m.id, courseId: c.id, courseTitle: c.title, title: `${c.title} — ${m.title}`, startsAt: start, endsAt: new Date(start.getTime() + Math.max(1, minutes) * 60_000), joinUrl: null }];
    }),
  );
}

async function liveSessions(tx: Tx, tenantId: string, filter: { from?: Date; to?: Date; courseId?: string; classroomId?: string }): Promise<SessionDescriptor[]> {
  const rows = await tx.virtualClassroom.findMany({
    where: {
      tenantId,
      courseId: filter.courseId ?? { not: null },
      status: { not: 'CANCELLED' },
      ...(filter.classroomId ? { id: filter.classroomId } : {}),
      // A classroom can last up to 12 hours: look back that far so one that began earlier but still runs is included.
      ...(filter.from || filter.to ? { startsAt: { ...(filter.from ? { gte: new Date(filter.from.getTime() - 12 * 3_600_000) } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
    },
    select: { id: true, title: true, startsAt: true, durationMinutes: true, joinUrl: true, courseId: true, course: { select: { title: true } } },
  });
  return rows.flatMap((r) =>
    r.courseId && r.course
      ? [{ kind: 'LIVE' as const, ref: r.id, courseId: r.courseId, courseTitle: r.course.title, title: r.title, startsAt: r.startsAt, endsAt: new Date(r.startsAt.getTime() + r.durationMinutes * 60_000), joinUrl: r.joinUrl }]
      : [],
  );
}

export class PrismaAttendanceRepository implements AttendanceRepository {
  listSessions(tenantId: string, from: Date, to: Date, courseId?: string): Promise<SessionDescriptor[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const [live, days] = await Promise.all([liveSessions(tx, tenantId, { from, to, courseId }), recordedDays(tx, tenantId, { courseId })]);
      return [...live, ...days].filter((s) => s.endsAt >= from && s.startsAt <= to).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    });
  }

  getSession(tenantId: string, kind: SessionKind, ref: string): Promise<SessionDescriptor | null> {
    return withTenantTransaction(tenantId, async (tx) => ((kind === 'LIVE' ? await liveSessions(tx, tenantId, { classroomId: ref }) : await recordedDays(tx, tenantId, { moduleId: ref }))[0] ?? null));
  }

  async courseTitle(tenantId: string, courseId: string): Promise<string | null> {
    return withTenantTransaction(tenantId, async (tx) => (await tx.course.findFirst({ where: { tenantId, id: courseId }, select: { title: true } }))?.title ?? null);
  }

  async activeCourseIds(tenantId: string, userId: string): Promise<string[]> {
    return withTenantTransaction(tenantId, async (tx) => (await tx.enrollment.findMany({ where: { tenantId, userId, status: 'ACTIVE' }, select: { courseId: true } })).map((e) => e.courseId));
  }

  courseTrainees(tenantId: string, courseId: string): Promise<TraineeRef[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const rows = await tx.enrollment.findMany({
        where: { tenantId, courseId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { source: true, user: { select: { id: true, fullName: true, email: true } } },
      });
      return rows.map((e) => ({ userId: e.user.id, name: nameOf(e.user), adminEnrolled: e.source === 'ADMIN' }));
    });
  }

  getRecord(tenantId: string, userId: string, kind: SessionKind, ref: string): Promise<AttendanceRecord | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const r = await tx.sessionAttendance.findUnique({ where: { userId_kind_sessionRef: { userId, kind, sessionRef: ref } } });
      return r ? toRecord(r) : null;
    });
  }

  listRecords(tenantId: string, kind: SessionKind, ref: string): Promise<AttendanceRecord[]> {
    return withTenantTransaction(tenantId, async (tx) => (await tx.sessionAttendance.findMany({ where: { tenantId, kind, sessionRef: ref } })).map(toRecord));
  }

  listCourseRecords(tenantId: string, courseId: string): Promise<AttendanceRecord[]> {
    return withTenantTransaction(tenantId, async (tx) => (await tx.sessionAttendance.findMany({ where: { tenantId, courseId } })).map(toRecord));
  }

  recordCheckIn(tenantId: string, userId: string, session: SessionDescriptor, at: Date): Promise<AttendanceRecord> {
    return withTenantTransaction(tenantId, async (tx) => {
      const key = { userId_kind_sessionRef: { userId, kind: session.kind, sessionRef: session.ref } };
      const existing = await tx.sessionAttendance.findUnique({ where: key });
      // The first check-in is the one that counts: checking in again later cannot make a late arrival look on time.
      if (existing?.otpVerifiedAt) return toRecord(existing);
      const base = { otpVerifiedAt: at, ...(session.kind === 'DAY' ? { firstJoinAt: at } : {}) };
      const row = existing
        ? await tx.sessionAttendance.update({ where: key, data: base })
        : await tx.sessionAttendance.create({ data: { tenantId, userId, courseId: session.courseId, kind: session.kind, sessionRef: session.ref, startsAt: session.startsAt, endsAt: session.endsAt, ...base } });
      return toRecord(row);
    });
  }

  private async ensureRow(tx: Tx, tenantId: string, userId: string, session: SessionDescriptor): Promise<void> {
    const found = await tx.sessionAttendance.findUnique({ where: { userId_kind_sessionRef: { userId, kind: session.kind, sessionRef: session.ref } }, select: { id: true } });
    if (found) return;
    try {
      await tx.sessionAttendance.create({ data: { tenantId, userId, courseId: session.courseId, kind: session.kind, sessionRef: session.ref, startsAt: session.startsAt, endsAt: session.endsAt, source: 'ZOOM' } });
    } catch (err) {
      if (!isUnique(err)) throw err;
    }
  }

  addJoin(tenantId: string, userId: string, session: SessionDescriptor, at: Date): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      await this.ensureRow(tx, tenantId, userId, session);
      const open = await tx.attendanceInterval.findFirst({ where: { tenantId, userId, kind: session.kind, sessionRef: session.ref, leftAt: null }, select: { id: true } });
      // Zoom can repeat a join event: one open interval at a time.
      if (!open) await tx.attendanceInterval.create({ data: { tenantId, userId, kind: session.kind, sessionRef: session.ref, joinedAt: at } });
    });
  }

  addLeave(tenantId: string, userId: string, session: SessionDescriptor, at: Date): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      await this.ensureRow(tx, tenantId, userId, session);
      const open = await tx.attendanceInterval.findFirst({ where: { tenantId, userId, kind: session.kind, sessionRef: session.ref, leftAt: null }, orderBy: { joinedAt: 'desc' }, select: { id: true, joinedAt: true } });
      if (open) await tx.attendanceInterval.update({ where: { id: open.id }, data: { leftAt: at < open.joinedAt ? open.joinedAt : at } });
      // A leave with no join before it (the join event was missed): record the person as there from the start of the session.
      else await tx.attendanceInterval.create({ data: { tenantId, userId, kind: session.kind, sessionRef: session.ref, joinedAt: session.startsAt, leftAt: at < session.startsAt ? session.startsAt : at } });
    });
  }

  loadEvidence(tenantId: string, session: SessionDescriptor, userIds: string[]): Promise<Map<string, Evidence>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const out = new Map<string, Evidence>(userIds.map((id) => [id, { otpVerifiedAt: null, intervals: [] as Interval[], dayCompletedAt: null }]));
      const records = await tx.sessionAttendance.findMany({ where: { tenantId, kind: session.kind, sessionRef: session.ref, userId: { in: userIds } }, select: { userId: true, otpVerifiedAt: true } });
      for (const r of records) (out.get(r.userId) as Evidence).otpVerifiedAt = r.otpVerifiedAt;
      if (session.kind === 'LIVE') {
        const intervals = await tx.attendanceInterval.findMany({ where: { tenantId, kind: 'LIVE', sessionRef: session.ref, userId: { in: userIds } }, select: { userId: true, joinedAt: true, leftAt: true } });
        for (const i of intervals) (out.get(i.userId) as Evidence).intervals.push({ joinedAt: i.joinedAt, leftAt: i.leftAt });
      } else {
        // The day is done when EVERY lesson of the module is completed; the moment of the last one is the "check-out".
        const lessons = await tx.lesson.findMany({ where: { tenantId, moduleId: session.ref }, select: { id: true } });
        if (lessons.length > 0) {
          const progress = await tx.lessonProgress.findMany({
            where: { tenantId, lessonId: { in: lessons.map((l) => l.id) }, enrollment: { courseId: session.courseId, userId: { in: userIds } } },
            select: { completedAt: true, enrollment: { select: { userId: true } } },
          });
          const byUser = new Map<string, Date[]>();
          for (const p of progress) byUser.set(p.enrollment.userId, [...(byUser.get(p.enrollment.userId) ?? []), p.completedAt]);
          for (const [userId, dates] of byUser) if (dates.length >= lessons.length) (out.get(userId) as Evidence).dayCompletedAt = new Date(Math.max(...dates.map((d) => d.getTime())));
        }
      }
      return out;
    });
  }

  saveOutcome(tenantId: string, userId: string, session: SessionDescriptor, outcome: Outcome, finalized: boolean): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      const data = { status: outcome.status, firstJoinAt: outcome.firstJoinAt, lastLeaveAt: outcome.lastLeaveAt, attendedSeconds: outcome.attendedSeconds, finalizedAt: finalized ? new Date() : null };
      await tx.sessionAttendance.upsert({
        where: { userId_kind_sessionRef: { userId, kind: session.kind, sessionRef: session.ref } },
        update: data,
        create: { tenantId, userId, courseId: session.courseId, kind: session.kind, sessionRef: session.ref, startsAt: session.startsAt, endsAt: session.endsAt, ...data },
      });
    });
  }

  adminContacts(tenantId: string): Promise<{ email: string; name: string }[]> {
    return withTenantTransaction(tenantId, async (tx) => (await tx.user.findMany({ where: { tenantId, role: 'TENANT_ADMIN' }, select: { email: true, fullName: true } })).map((u) => ({ email: u.email, name: u.fullName ?? u.email })));
  }

  claimAlert(tenantId: string, session: SessionDescriptor, absentCount: number): Promise<AlertClaim | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const where = { tenantId_kind_sessionRef: { tenantId, kind: session.kind, sessionRef: session.ref } };
      const existing = await tx.attendanceAlert.findUnique({ where });
      if (existing) return existing.sentAt ? null : { id: existing.id };
      const created = await tx.attendanceAlert.create({ data: { tenantId, kind: session.kind, sessionRef: session.ref, absentCount }, select: { id: true } });
      return { id: created.id };
    }).catch((err: unknown) => {
      // Two sweeps at once: the other one owns this alert.
      if (isUnique(err)) return null;
      throw err;
    });
  }

  markAlertSent(tenantId: string, alertId: string, at: Date): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      await tx.attendanceAlert.updateMany({ where: { tenantId, id: alertId }, data: { sentAt: at } });
    });
  }

  async activeTenants(): Promise<{ id: string; name: string }[]> {
    return prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
  }

  findTraineeByEmail(tenantId: string, courseId: string, email: string): Promise<string | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const e = await tx.enrollment.findFirst({ where: { tenantId, courseId, status: 'ACTIVE', user: { email: email.trim().toLowerCase() } }, select: { userId: true } });
      return e?.userId ?? null;
    });
  }
}
