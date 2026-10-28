/**
 * Splits one long recorded video into a multi-day schedule of short lectures.
 *
 * Each day: lecture → break → lecture → … → lecture → discussion. Breaks and the discussion are
 * not stored as rows: they carry no content, so they're derived at playback from the course's
 * schedule config (and never count toward progress). Only lectures become lessons.
 *
 * Lectures within a day are balanced (equal length) instead of greedy fixed-size chunks, so a
 * 71-minute day becomes 3 × ~24 min rather than 35 + 35 + a 1-minute stub after a break.
 */

export interface ScheduleConfig {
  /** Lectures are never longer than this (unless shorter pieces would fall under the minimum). */
  maxLectureMinutes: number;
  /** Lectures shorter than this are avoided by using fewer, longer pieces. */
  minLectureMinutes: number;
  breakMinutes: number;
  discussionMinutes: number;
  /** Video minutes per day used when the number of days isn't chosen explicitly. */
  dailyVideoMinutes: number;
}

/** Owner-approved defaults: 10–15 min lectures, 5 min breaks, 15 min discussion. */
export const DEFAULT_SCHEDULE: ScheduleConfig = {
  maxLectureMinutes: 15,
  minLectureMinutes: 10,
  breakMinutes: 5,
  discussionMinutes: 15,
  dailyVideoMinutes: 60,
};

export const SCHEDULE_LIMITS = {
  lectureMinutes: { min: 3, max: 60 },
  breakMinutes: { min: 0, max: 30 },
  discussionMinutes: { min: 0, max: 60 },
  dailyVideoMinutes: { min: 10, max: 240 },
  days: { min: 1, max: 60 },
  /** A day must hold at least this much video, or the schedule is mostly breaks and talk. */
  minDailyVideoMinutes: 5,
  maxVideoSeconds: 12 * 3600,
} as const;

export interface PlannedLecture {
  startSecond: number;
  endSecond: number;
}

export interface PlannedDay {
  day: number;
  lectures: PlannedLecture[];
  videoSeconds: number;
  breakCount: number;
  /** Video + breaks + discussion: the learner's time commitment for the day. */
  totalMinutes: number;
}

export interface SchedulePlan {
  days: PlannedDay[];
  videoSeconds: number;
  lectureCount: number;
  /** Video + discussion (breaks excluded): what the course reports as training hours. */
  trainingHours: number;
}

export class ScheduleError extends Error {
  constructor(
    readonly code: 'VIDEO_TOO_LONG' | 'TOO_MANY_DAYS' | 'INVALID_SCHEDULE',
    message: string,
  ) {
    super(message);
  }
}

/** Balanced split of [start, end) into lectures within the min/max length. */
export function splitDay(start: number, end: number, cfg: Pick<ScheduleConfig, 'maxLectureMinutes' | 'minLectureMinutes'>): PlannedLecture[] {
  const total = end - start;
  if (total <= 0) return [];
  const max = cfg.maxLectureMinutes * 60;
  const min = Math.min(cfg.minLectureMinutes, cfg.maxLectureMinutes) * 60;
  let count = Math.max(1, Math.ceil(total / max));
  // Balanced pieces under the minimum (e.g. 16 min → 2 × 8): use fewer, slightly longer ones.
  if (count > 1 && total / count < min) count = Math.max(1, Math.floor(total / min));
  const base = Math.floor(total / count);
  const lectures: PlannedLecture[] = [];
  let cursor = start;
  for (let i = 0; i < count; i++) {
    const to = i === count - 1 ? end : cursor + base; // the last one absorbs rounding seconds
    lectures.push({ startSecond: cursor, endSecond: to });
    cursor = to;
  }
  return lectures;
}

export function planSchedule(durationSeconds: number, cfg: ScheduleConfig, requestedDays?: number | null): SchedulePlan {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) throw new ScheduleError('INVALID_SCHEDULE', 'Video duration must be a positive number of seconds');
  if (durationSeconds > SCHEDULE_LIMITS.maxVideoSeconds) throw new ScheduleError('VIDEO_TOO_LONG', 'Videos longer than 12 hours are not supported');

  const days = requestedDays ?? Math.max(1, Math.ceil(durationSeconds / (cfg.dailyVideoMinutes * 60)));
  if (!Number.isInteger(days) || days < 1) throw new ScheduleError('INVALID_SCHEDULE', 'Days must be a positive whole number');
  if (days > SCHEDULE_LIMITS.days.max || durationSeconds / days < SCHEDULE_LIMITS.minDailyVideoMinutes * 60) {
    throw new ScheduleError('TOO_MANY_DAYS', `Each day needs at least ${SCHEDULE_LIMITS.minDailyVideoMinutes} minutes of video`);
  }

  // Even split across days; the remainder seconds go one-by-one to the first days.
  const per = Math.floor(durationSeconds / days);
  let extra = durationSeconds - per * days;
  const planned: PlannedDay[] = [];
  let cursor = 0;
  for (let d = 1; d <= days; d++) {
    const end = cursor + per + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    const lectures = splitDay(cursor, end, cfg);
    const breakCount = Math.max(0, lectures.length - 1);
    const videoSeconds = end - cursor;
    planned.push({
      day: d,
      lectures,
      videoSeconds,
      breakCount,
      totalMinutes: Math.round(videoSeconds / 60) + breakCount * cfg.breakMinutes + cfg.discussionMinutes,
    });
    cursor = end;
  }

  const trainingMinutes = durationSeconds / 60 + days * cfg.discussionMinutes;
  return {
    days: planned,
    videoSeconds: durationSeconds,
    lectureCount: planned.reduce((s, d) => s + d.lectures.length, 0),
    // One decimal, matching courses.training_hours DECIMAL(6,1).
    trainingHours: Math.round((trainingMinutes / 60) * 10) / 10,
  };
}

/** "632" → "10:32", "3725" → "1:02:05" */
export function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
