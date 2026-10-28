/**
 * Splits one long recorded video into a multi-day schedule of short lectures.
 *
 * Each day: lecture → break → lecture → … → lecture → discussion. Breaks and the discussion are
 * not stored as rows: they carry no content, so they're derived at playback from the course's
 * schedule config (and never count toward progress). Only lectures become lessons.
 *
 * Two split modes, chosen by the course supervisor:
 * - fixed:    a break every N minutes exactly ("every 25 minutes"). The whole video is cut into
 *             N-minute lectures first, then whole lectures are grouped into days — so a day never
 *             starts mid-lecture. A tail shorter than 5 minutes is merged into the lecture before it.
 * - balanced: each day is split into equal lectures within [min, max] minutes, so a 71-minute
 *             day becomes 5 × ~14 min rather than 15 + 15 + 15 + 15 + an 11-minute remainder.
 */

export type SplitMode = 'fixed' | 'balanced';

export interface ScheduleConfig {
  splitMode: SplitMode;
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
  splitMode: 'balanced',
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
  /** fixed mode: a final piece shorter than this joins the previous lecture instead of standing alone. */
  minTailSeconds: 5 * 60,
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

/** fixed mode: N-minute lectures over the whole video; a short tail merges into the last lecture. */
export function splitFixed(durationSeconds: number, lectureMinutes: number): PlannedLecture[] {
  const size = lectureMinutes * 60;
  const lectures: PlannedLecture[] = [];
  for (let start = 0; start < durationSeconds; start += size) {
    lectures.push({ startSecond: start, endSecond: Math.min(start + size, durationSeconds) });
  }
  const last = lectures.at(-1);
  if (lectures.length > 1 && last && last.endSecond - last.startSecond < SCHEDULE_LIMITS.minTailSeconds) {
    lectures.pop();
    lectures[lectures.length - 1]!.endSecond = durationSeconds;
  }
  return lectures;
}

function validate(durationSeconds: number, days: number) {
  if (!Number.isInteger(days) || days < 1) throw new ScheduleError('INVALID_SCHEDULE', 'Days must be a positive whole number');
  if (days > SCHEDULE_LIMITS.days.max || durationSeconds / days < SCHEDULE_LIMITS.minDailyVideoMinutes * 60) {
    throw new ScheduleError('TOO_MANY_DAYS', `Each day needs at least ${SCHEDULE_LIMITS.minDailyVideoMinutes} minutes of video`);
  }
}

function dayOf(day: number, lectures: PlannedLecture[], cfg: ScheduleConfig): PlannedDay {
  const videoSeconds = lectures.reduce((s, l) => s + l.endSecond - l.startSecond, 0);
  const breakCount = Math.max(0, lectures.length - 1);
  return { day, lectures, videoSeconds, breakCount, totalMinutes: Math.round(videoSeconds / 60) + breakCount * cfg.breakMinutes + cfg.discussionMinutes };
}

export function planSchedule(durationSeconds: number, cfg: ScheduleConfig, requestedDays?: number | null): SchedulePlan {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) throw new ScheduleError('INVALID_SCHEDULE', 'Video duration must be a positive number of seconds');
  if (durationSeconds > SCHEDULE_LIMITS.maxVideoSeconds) throw new ScheduleError('VIDEO_TOO_LONG', 'Videos longer than 12 hours are not supported');

  const planned: PlannedDay[] = [];
  if (cfg.splitMode === 'fixed') {
    const all = splitFixed(durationSeconds, cfg.maxLectureMinutes);
    // Whole lectures per day: as many as fit the daily video target (at least one).
    const perDayTarget = Math.max(1, Math.floor(cfg.dailyVideoMinutes / cfg.maxLectureMinutes));
    const days = requestedDays ?? Math.ceil(all.length / perDayTarget);
    validate(durationSeconds, days);
    if (days > all.length) throw new ScheduleError('TOO_MANY_DAYS', 'More days than lectures: shorten the lecture length or use fewer days');
    // Spread lectures evenly; the first days take one extra when it doesn't divide exactly.
    const base = Math.floor(all.length / days);
    let extra = all.length - base * days;
    let cursor = 0;
    for (let d = 1; d <= days; d++) {
      const count = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      planned.push(dayOf(d, all.slice(cursor, cursor + count), cfg));
      cursor += count;
    }
  } else {
    const days = requestedDays ?? Math.max(1, Math.ceil(durationSeconds / (cfg.dailyVideoMinutes * 60)));
    validate(durationSeconds, days);
    // Even split across days; the remainder seconds go one-by-one to the first days.
    const per = Math.floor(durationSeconds / days);
    let extra = durationSeconds - per * days;
    let cursor = 0;
    for (let d = 1; d <= days; d++) {
      const end = cursor + per + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      planned.push(dayOf(d, splitDay(cursor, end, cfg), cfg));
      cursor = end;
    }
  }

  const trainingMinutes = durationSeconds / 60 + planned.length * cfg.discussionMinutes;
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
