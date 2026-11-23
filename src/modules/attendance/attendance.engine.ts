/**
 * Attendance rules for corporate training (pure functions, no I/O).
 *
 * A "session" is a live classroom, or one day of a recorded course. Each has a window [startsAt, endsAt].
 * Per session a trainee is:
 *  - PRESENT: checked in (with the e-mailed code) on time and stayed to the end;
 *  - LATE:    checked in after the late threshold (10% of the session's length), but stayed to the end;
 *  - ABSENT:  never checked in, or left before the end (live), or did not finish the day's lessons in time (recorded).
 * Across a course the trainee passes attendance with 85% of the held sessions (PRESENT or LATE).
 *
 * Live sessions: Zoom tells us when they joined and left (several intervals are fine; only the LAST leave counts, so a short
 * disconnect followed by coming back is not leaving). Without Zoom data (links entered by hand) the check-in alone decides.
 * Recorded days: there is no "leave" event, so finishing all of the day's lessons is the check-out.
 */
export const RULES = {
  /** Late = checking in after this share of the session's length has passed. */
  lateFraction: 0.1,
  /** Leaving up to this long before the end still counts as staying to the end. */
  leaveGraceMinutes: 5,
  /** Share of held sessions a trainee must attend (PRESENT or LATE) to pass the course's attendance. */
  passPercent: 85,
  /** Check-in opens this long before the session starts. */
  checkInOpensMinutes: 15,
  /** The academy's admin is told about trainees who have not checked in this long after the start. */
  alertAfterMinutes: 25,
  /** A session is settled this long after it ends (late Zoom events can still arrive). */
  finalizeAfterMinutes: 5,
} as const;

export type SessionKind = 'LIVE' | 'DAY';
export type AttendanceStatus = 'PENDING' | 'PRESENT' | 'LATE' | 'ABSENT';

export interface SessionWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface Interval {
  joinedAt: Date;
  leftAt: Date | null;
}

export interface Evidence {
  /** When the trainee proved who they are with the e-mailed code. */
  otpVerifiedAt: Date | null;
  /** Zoom joins and leaves (live sessions). */
  intervals: Interval[];
  /** Recorded days: when the last of the day's lessons was completed, or null if some are still open. */
  dayCompletedAt?: Date | null;
}

export interface Outcome {
  status: AttendanceStatus;
  firstJoinAt: Date | null;
  lastLeaveAt: Date | null;
  attendedSeconds: number;
}

const MIN = 60_000;

/** Checking in after this moment is LATE. */
export const lateAfter = (w: SessionWindow): Date => new Date(w.startsAt.getTime() + (w.endsAt.getTime() - w.startsAt.getTime()) * RULES.lateFraction);

export const checkInOpensAt = (w: SessionWindow): Date => new Date(w.startsAt.getTime() - RULES.checkInOpensMinutes * MIN);

/** Check-in is possible from a little before the start until the session ends. */
export const checkInOpen = (w: SessionWindow, now: Date): boolean => now >= checkInOpensAt(w) && now < w.endsAt;

export const alertDueAt = (w: SessionWindow): Date => new Date(w.startsAt.getTime() + RULES.alertAfterMinutes * MIN);

export const finalizeDueAt = (w: SessionWindow): Date => new Date(w.endsAt.getTime() + RULES.finalizeAfterMinutes * MIN);

/** Union length (seconds) of the intervals, clipped to the window. An interval still open counts until `now` (at most the end). */
function attendedSeconds(w: SessionWindow, intervals: Interval[], now: Date): number {
  const cap = Math.min(now.getTime(), w.endsAt.getTime());
  const spans = intervals
    .map((i) => [Math.max(i.joinedAt.getTime(), w.startsAt.getTime()), Math.min((i.leftAt ?? new Date(cap)).getTime(), w.endsAt.getTime(), cap)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curFrom = -1;
  let curTo = -1;
  for (const [from, to] of spans) {
    if (from > curTo) {
      if (curTo > curFrom) total += curTo - curFrom;
      curFrom = from;
      curTo = to;
    } else curTo = Math.max(curTo, to);
  }
  if (curTo > curFrom) total += curTo - curFrom;
  return Math.round(total / 1000);
}

export function evaluateLive(w: SessionWindow, ev: Evidence, now: Date): Outcome {
  // Joins after the session is over are not part of it.
  const intervals = ev.intervals.filter((i) => i.joinedAt < w.endsAt);
  const joins = intervals.map((i) => i.joinedAt.getTime());
  const firstJoinAt = joins.length > 0 ? new Date(Math.min(...joins)) : ev.otpVerifiedAt;
  // A missing leave event (still in, or Zoom never said) means "was there until now / until the end".
  const leaves = intervals.map((i) => Math.min((i.leftAt ?? w.endsAt).getTime(), w.endsAt.getTime()));
  const lastLeaveAt = leaves.length > 0 ? new Date(Math.max(...leaves)) : null;
  const seconds = attendedSeconds(w, intervals, now);
  const base = { firstJoinAt, lastLeaveAt, attendedSeconds: seconds };

  if (now < w.endsAt) return { ...base, status: 'PENDING' };
  if (!ev.otpVerifiedAt) return { ...base, status: 'ABSENT' };
  const leftEarly = lastLeaveAt !== null && lastLeaveAt.getTime() < w.endsAt.getTime() - RULES.leaveGraceMinutes * MIN;
  if (leftEarly) return { ...base, status: 'ABSENT' };
  return { ...base, status: firstJoinAt && firstJoinAt > lateAfter(w) ? 'LATE' : 'PRESENT' };
}

export function evaluateDay(w: SessionWindow, ev: Evidence, now: Date): Outcome {
  const checkedIn = ev.otpVerifiedAt;
  const done = ev.dayCompletedAt ?? null;
  const seconds = checkedIn && done && done > checkedIn ? Math.round((done.getTime() - checkedIn.getTime()) / 1000) : 0;
  const base = { firstJoinAt: checkedIn, lastLeaveAt: done, attendedSeconds: seconds };

  if (now < w.endsAt) return { ...base, status: 'PENDING' };
  if (!checkedIn) return { ...base, status: 'ABSENT' };
  // The day counts only if its lessons were finished within the day's own window.
  if (!done || done > w.endsAt) return { ...base, status: 'ABSENT' };
  return { ...base, status: checkedIn > lateAfter(w) ? 'LATE' : 'PRESENT' };
}

export function evaluate(kind: SessionKind, w: SessionWindow, ev: Evidence, now: Date): Outcome {
  return kind === 'LIVE' ? evaluateLive(w, ev, now) : evaluateDay(w, ev, now);
}

export interface CourseAttendance {
  held: number;
  attended: number;
  absent: number;
  late: number;
  /** One decimal; null when no session has been held yet. */
  percent: number | null;
  /** True once the share of held sessions attended reaches the pass mark. */
  passes: boolean | null;
}

/** Course-level figure over the sessions already held (settled ones only: PENDING sessions are not counted yet). */
export function courseAttendance(statuses: AttendanceStatus[]): CourseAttendance {
  const settled = statuses.filter((s) => s !== 'PENDING');
  const late = settled.filter((s) => s === 'LATE').length;
  const attended = settled.filter((s) => s === 'PRESENT' || s === 'LATE').length;
  const held = settled.length;
  const percent = held === 0 ? null : Math.round((attended / held) * 1000) / 10;
  return { held, attended, absent: held - attended, late, percent, passes: percent === null ? null : percent >= RULES.passPercent };
}
