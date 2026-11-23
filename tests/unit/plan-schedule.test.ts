import { DAY_MS, firstConflict, firstPairConflict, scheduleConflictError, slotsOf, storedDayMinutes, suggestStart, type CourseSchedule } from '../../src/modules/provider/plan-schedule';

// Saudi time is UTC+3 with no daylight saving: 19:00 there is 16:00 UTC.
const at = (iso: string) => new Date(`${iso}:00+03:00`);
const course = (courseId: string, start: string, dayMinutes: number[], title = courseId): CourseSchedule => ({ courseId, title, startsAt: at(start), dayMinutes });

describe('slotsOf', () => {
  it('puts each day exactly 24 h after the previous one, at the same time of day', () => {
    const slots = slotsOf(at('2026-12-01T19:00'), [60, 45, 30]);
    expect(slots.map((s) => [s.day, new Date(s.startMs).toISOString(), (s.endMs - s.startMs) / 60_000])).toEqual([
      [1, '2026-12-01T16:00:00.000Z', 60],
      [2, '2026-12-02T16:00:00.000Z', 45],
      [3, '2026-12-03T16:00:00.000Z', 30],
    ]);
  });
});

describe('firstConflict (a plan never runs two courses at once)', () => {
  const existing = [course('A', '2026-12-01T19:00', [60, 60], 'Course A')]; // 19:00-20:00 on 1 and 2 December

  it('flags the same start, a start inside the other course\'s hour, and a later day that meets the other\'s second day', () => {
    expect(firstConflict({ startsAt: at('2026-12-01T19:00'), dayMinutes: [60] }, existing)).toMatchObject({ withCourseId: 'A', withTitle: 'Course A', day: 1, otherDay: 1 });
    expect(firstConflict({ startsAt: at('2026-12-01T19:30'), dayMinutes: [60] }, existing)).toMatchObject({ day: 1, otherDay: 1 });
    // starts on 30 Nov, so ITS day 2 (1 Dec 19:00) meets A's day 1, and its day 3 meets A's day 2
    expect(firstConflict({ startsAt: at('2026-11-30T19:00'), dayMinutes: [60, 60, 60] }, existing)).toMatchObject({ day: 2, otherDay: 1 });
  });

  it('allows back-to-back (touching), another time of day, or another day', () => {
    expect(firstConflict({ startsAt: at('2026-12-01T20:00'), dayMinutes: [60] }, existing)).toBeNull(); // starts exactly when A ends
    expect(firstConflict({ startsAt: at('2026-12-01T18:00'), dayMinutes: [60] }, existing)).toBeNull(); // ends exactly when A starts
    expect(firstConflict({ startsAt: at('2026-12-01T10:00'), dayMinutes: [60] }, existing)).toBeNull();
    expect(firstConflict({ startsAt: at('2026-12-03T19:00'), dayMinutes: [60] }, existing)).toBeNull();
  });

  it('checks every day of a multi-day course against every day of the others', () => {
    const second = [course('B', '2026-12-10T19:00', [60, 60, 60, 60])]; // 10-13 December
    expect(firstConflict({ startsAt: at('2026-12-08T19:00'), dayMinutes: [60, 60, 60] }, second)).toMatchObject({ day: 3, otherDay: 1 }); // its 10 Dec
    expect(firstConflict({ startsAt: at('2026-12-14T19:00'), dayMinutes: [60, 60] }, second)).toBeNull();
  });

  it('no other courses, no conflict', () => {
    expect(firstConflict({ startsAt: at('2026-12-01T19:00'), dayMinutes: [60] }, [])).toBeNull();
  });
});

describe('suggestStart', () => {
  it('moves forward by whole days, keeping the lecture time, to the first start that fits', () => {
    // A occupies 1-3 December 19:00-20:00. A 2-day course wanting 1 December can first start on 4 December.
    const others = [course('A', '2026-12-01T19:00', [60, 60, 60])];
    const s = suggestStart({ startsAt: at('2026-12-01T19:00'), dayMinutes: [60, 60] }, others);
    expect(s?.toISOString()).toBe(at('2026-12-04T19:00').toISOString());
  });

  it('can slip into a gap between two courses', () => {
    const others = [course('A', '2026-12-01T19:00', [60]), course('B', '2026-12-05T19:00', [60])];
    expect(suggestStart({ startsAt: at('2026-12-01T19:00'), dayMinutes: [60, 60] }, others)?.toISOString()).toBe(at('2026-12-02T19:00').toISOString());
    // a 5-day course does not fit before B, so it goes after B
    expect(suggestStart({ startsAt: at('2026-12-01T19:00'), dayMinutes: [60, 60, 60, 60, 60] }, others)?.toISOString()).toBe(at('2026-12-06T19:00').toISOString());
  });

  it('gives up (null) when nothing fits in the search window', () => {
    const wall = [course('W', '2026-12-01T00:00', Array.from({ length: 800 }, () => 1440))];
    expect(suggestStart({ startsAt: at('2026-12-01T19:00'), dayMinutes: [60] }, wall, 30)).toBeNull();
  });
});

describe('firstPairConflict (a plan saved with its whole course list)', () => {
  it('names the two overlapping courses, or returns null', () => {
    const list = [course('A', '2026-12-01T19:00', [60]), course('B', '2026-12-02T19:00', [60]), course('C', '2026-12-02T19:30', [60], 'Course C')];
    const hit = firstPairConflict(list);
    expect([hit?.a.courseId, hit?.b.courseId]).toEqual(['B', 'C']);
    expect(firstPairConflict(list.slice(0, 2))).toBeNull();
    expect(firstPairConflict([])).toBeNull();
  });
});

describe('storedDayMinutes (the same arithmetic as the planner)', () => {
  it('video minutes + a break between lectures + the discussion', () => {
    // 10:32 + 10:33 of video = 21 min, one 5-minute break, a 15-minute discussion = 41 (the planner shows 41 for this video)
    expect(storedDayMinutes([{ startSecond: 0, endSecond: 632 }, { startSecond: 632, endSecond: 1265 }], 5, 15)).toBe(41);
  });
  it('ignores lessons without times, and a day with no lectures is just the discussion', () => {
    expect(storedDayMinutes([{ startSecond: null, endSecond: null }], 5, 15)).toBe(15);
    expect(storedDayMinutes([], 5, 15)).toBe(15);
  });
});

describe('scheduleConflictError', () => {
  it('is a 422 with what overlaps and the suggested start, in ISO', () => {
    const err = scheduleConflictError({ withCourseId: 'A', withTitle: 'Course A', day: 1, otherDay: 2, at: at('2026-12-01T19:00') }, at('2026-12-04T19:00'));
    expect(err).toMatchObject({ status: 422, code: 'SCHEDULE_CONFLICT' });
    expect(err.details).toEqual({
      conflict: { course_id: 'A', title: 'Course A', day: 1, other_day: 2, at: '2026-12-01T16:00:00.000Z' },
      suggested_start: '2026-12-04T16:00:00.000Z',
    });
    expect(scheduleConflictError({ withCourseId: 'A', withTitle: 'A', day: 1, otherDay: 1, at: new Date(0) }, null).details).toMatchObject({ suggested_start: null });
  });
});

void DAY_MS;
