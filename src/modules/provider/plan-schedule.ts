import type { Prisma } from '@prisma/client';
import { HttpError } from '../../shared/utils/http-error';
import { DEFAULT_SCHEDULE } from '../lms/recorded/schedule-planner';

/**
 * Scheduling rules of a training plan made of recorded courses.
 *
 * A recorded course runs on consecutive days: day N opens N-1 days after the first day, at the same time of day, and takes
 * that day's total minutes (lectures + breaks + discussion). Two courses of the SAME PLAN must never overlap: no day of one
 * may share clock time with a day of the other. Touching (one ends exactly when the other starts) is fine.
 * Saudi time has no daylight saving, so "same time of day" is exactly 24 h later.
 */
export const DAY_MS = 86_400_000;

/** A dated recorded course: when day 1 starts and how long each day takes. */
export interface CourseSchedule {
  courseId: string;
  title: string;
  startsAt: Date;
  /** Total minutes of each day, in order (one entry per day). */
  dayMinutes: number[];
}

export interface ScheduleConflict {
  withCourseId: string;
  withTitle: string;
  /** Day of the course being checked / of the other course that overlap. */
  day: number;
  otherDay: number;
  /** When the overlapping day of the course being checked starts. */
  at: Date;
}

interface Slot {
  day: number;
  startMs: number;
  endMs: number;
}

export function slotsOf(startsAt: Date, dayMinutes: number[]): Slot[] {
  return dayMinutes.map((minutes, i) => {
    const startMs = startsAt.getTime() + i * DAY_MS;
    return { day: i + 1, startMs, endMs: startMs + minutes * 60_000 };
  });
}

const overlaps = (a: Slot, b: Slot) => a.startMs < b.endMs && b.startMs < a.endMs;

/** The first overlap between a candidate (start + day lengths) and the courses already in the plan, or null. */
export function firstConflict(candidate: { startsAt: Date; dayMinutes: number[] }, others: CourseSchedule[]): ScheduleConflict | null {
  const mine = slotsOf(candidate.startsAt, candidate.dayMinutes);
  for (const other of others) {
    const theirs = slotsOf(other.startsAt, other.dayMinutes);
    for (const a of mine) {
      const hit = theirs.find((b) => overlaps(a, b));
      if (hit) return { withCourseId: other.courseId, withTitle: other.title, day: a.day, otherDay: hit.day, at: new Date(a.startMs) };
    }
  }
  return null;
}

/**
 * The earliest start that fits: the requested time moved forward by whole days (the time of day stays the lecture time the
 * admin chose) until nothing overlaps. Null only if nothing fits within the search window.
 */
export function suggestStart(candidate: { startsAt: Date; dayMinutes: number[] }, others: CourseSchedule[], maxShiftDays = 730): Date | null {
  for (let shift = 1; shift <= maxShiftDays; shift++) {
    const startsAt = new Date(candidate.startsAt.getTime() + shift * DAY_MS);
    if (!firstConflict({ startsAt, dayMinutes: candidate.dayMinutes }, others)) return startsAt;
  }
  return null;
}

/** For a whole list (a plan saved with its course list): the first pair that overlaps, or null. */
export function firstPairConflict(list: CourseSchedule[]): { a: CourseSchedule; b: CourseSchedule; conflict: ScheduleConflict } | null {
  for (let i = 0; i < list.length; i++) {
    const a = list[i] as CourseSchedule;
    const conflict = firstConflict(a, list.slice(i + 1));
    if (conflict) return { a, b: list.find((c) => c.courseId === conflict.withCourseId) as CourseSchedule, conflict };
  }
  return null;
}

/** Minutes of one stored day: video + a break between consecutive lectures + the discussion (same formula as the planner). */
export function storedDayMinutes(lectures: { startSecond: number | null; endSecond: number | null }[], breakMinutes: number, discussionMinutes: number): number {
  const parts = lectures.filter((l): l is { startSecond: number; endSecond: number } => l.startSecond !== null && l.endSecond !== null);
  const videoSeconds = parts.reduce((sum, l) => sum + Math.max(0, l.endSecond - l.startSecond), 0);
  return Math.round(videoSeconds / 60) + Math.max(0, parts.length - 1) * breakMinutes + discussionMinutes;
}

export const minutesOf = (cfg: Prisma.JsonValue | null, key: 'breakMinutes' | 'discussionMinutes'): number => {
  const v = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>)[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_SCHEDULE[key];
};

/** Schedules of the dated recorded courses among `courseIds` (courses with no start date can never conflict, so they are left out). */
export async function loadCourseSchedules(tx: Prisma.TransactionClient, tenantId: string, courseIds: string[]): Promise<CourseSchedule[]> {
  if (courseIds.length === 0) return [];
  const rows = await tx.course.findMany({
    where: { tenantId, id: { in: courseIds }, sourceVideoId: { not: null }, scheduleStartsAt: { not: null } },
    select: {
      id: true,
      title: true,
      scheduleStartsAt: true,
      scheduleConfig: true,
      modules: { orderBy: { sortOrder: 'asc' }, select: { lessons: { select: { startSecond: true, endSecond: true } } } },
    },
  });
  return rows.flatMap((c) =>
    c.scheduleStartsAt
      ? [
          {
            courseId: c.id,
            title: c.title,
            startsAt: c.scheduleStartsAt,
            dayMinutes: c.modules.map((m) => storedDayMinutes(m.lessons, minutesOf(c.scheduleConfig, 'breakMinutes'), minutesOf(c.scheduleConfig, 'discussionMinutes'))),
          },
        ]
      : [],
  );
}

/**
 * Puts the plan's courses in start-date order (earliest first). Courses without a start date keep their relative order after
 * the dated ones. Called whenever a plan's course list changes or a course's start date moves, so the order is always right.
 */
export async function orderPlanByStart(tx: Prisma.TransactionClient, tenantId: string, planId: string): Promise<void> {
  const links = await tx.trainingPlanCourse.findMany({
    where: { tenantId, planId },
    orderBy: { sortOrder: 'asc' },
    select: { courseId: true, sortOrder: true, course: { select: { scheduleStartsAt: true } } },
  });
  const dated = links.filter((l) => l.course.scheduleStartsAt).sort((a, b) => (a.course.scheduleStartsAt as Date).getTime() - (b.course.scheduleStartsAt as Date).getTime());
  const undated = links.filter((l) => !l.course.scheduleStartsAt);
  const ordered = [...dated, ...undated];
  for (const [index, link] of ordered.entries()) {
    if (link.sortOrder !== index) await tx.trainingPlanCourse.update({ where: { planId_courseId: { planId, courseId: link.courseId } }, data: { sortOrder: index } });
  }
}

/** 422 SCHEDULE_CONFLICT: what overlaps (course, day) and, when one fits, the first free start at the same time of day. */
export function scheduleConflictError(conflict: ScheduleConflict, suggestedStart: Date | null): HttpError {
  return HttpError.unprocessable('SCHEDULE_CONFLICT', `The course overlaps "${conflict.withTitle}" (day ${conflict.otherDay})`, {
    conflict: { course_id: conflict.withCourseId, title: conflict.withTitle, day: conflict.day, other_day: conflict.otherDay, at: conflict.at.toISOString() },
    suggested_start: suggestedStart ? suggestedStart.toISOString() : null,
  });
}
