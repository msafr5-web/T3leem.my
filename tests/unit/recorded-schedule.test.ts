import { DEFAULT_SCHEDULE, ScheduleError, formatTimestamp, planSchedule, splitDay } from '../../src/modules/lms/recorded/schedule-planner';
import { YoutubeMetadataClient, parseIsoDuration, parseYoutubeVideoId } from '../../src/modules/lms/recorded/youtube';

const minutes = (lectures: { startSecond: number; endSecond: number }[]) => lectures.map((l) => Math.round((l.endSecond - l.startSecond) / 60));

describe('splitDay — balanced lectures within 10–15 min', () => {
  it('splits the 21-minute trial video into 2 × ~10.5 min', () => {
    const lectures = splitDay(0, 1265, DEFAULT_SCHEDULE);
    expect(lectures).toEqual([
      { startSecond: 0, endSecond: 632 },
      { startSecond: 632, endSecond: 1265 },
    ]);
  });

  it('never leaves a stub after a break (71 min → 5 × ~14 min, not 15+15+15+15+11)', () => {
    const lectures = splitDay(0, 71 * 60, DEFAULT_SCHEDULE);
    expect(minutes(lectures)).toEqual([14, 14, 14, 14, 14]);
    expect(lectures[4]!.endSecond).toBe(71 * 60);
  });

  it('prefers one slightly longer lecture over two below the minimum (16 min → 1 × 16)', () => {
    expect(minutes(splitDay(0, 16 * 60, DEFAULT_SCHEDULE))).toEqual([16]);
  });

  it('covers the range exactly, with contiguous segments', () => {
    const lectures = splitDay(100, 100 + 3 * 3600 + 7, DEFAULT_SCHEDULE);
    expect(lectures[0]!.startSecond).toBe(100);
    expect(lectures.at(-1)!.endSecond).toBe(100 + 3 * 3600 + 7);
    lectures.slice(1).forEach((l, i) => expect(l.startSecond).toBe(lectures[i]!.endSecond));
    expect(Math.max(...minutes(lectures))).toBeLessThanOrEqual(15);
  });
});

describe('planSchedule', () => {
  it('trial video: one day, 2 lectures, 1 break, 15 min discussion', () => {
    const plan = planSchedule(1265, DEFAULT_SCHEDULE);
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0]).toMatchObject({ breakCount: 1, videoSeconds: 1265, totalMinutes: 21 + 5 + 15 });
    expect(plan.lectureCount).toBe(2);
    expect(plan.trainingHours).toBe(0.6); // (21.1 + 15) / 60
  });

  it('derives days from the 60-minute daily target and splits evenly', () => {
    const plan = planSchedule(3 * 3600, DEFAULT_SCHEDULE);
    expect(plan.days.map((d) => d.videoSeconds)).toEqual([3600, 3600, 3600]);
    expect(plan.days.every((d) => d.lectures.length === 4)).toBe(true);
  });

  it('honours an explicit number of days and spreads remainder seconds', () => {
    const plan = planSchedule(7201, DEFAULT_SCHEDULE, 2);
    expect(plan.days.map((d) => d.videoSeconds)).toEqual([3601, 3600]);
    expect(plan.days[1]!.lectures.at(-1)!.endSecond).toBe(7201);
  });

  it('rejects schedules that are mostly breaks and talk', () => {
    expect(() => planSchedule(30 * 60, DEFAULT_SCHEDULE, 10)).toThrow(ScheduleError);
    expect(() => planSchedule(13 * 3600, DEFAULT_SCHEDULE)).toThrow('12 hours');
  });
});

describe('YouTube links', () => {
  it.each([
    ['https://www.youtube.com/watch?v=ZJQ-c4HyeX8', 'ZJQ-c4HyeX8'],
    ['https://youtu.be/ZJQ-c4HyeX8?si=abc', 'ZJQ-c4HyeX8'],
    ['https://m.youtube.com/watch?feature=share&v=ZJQ-c4HyeX8', 'ZJQ-c4HyeX8'],
    ['https://www.youtube.com/embed/ZJQ-c4HyeX8', 'ZJQ-c4HyeX8'],
    ['https://www.youtube.com/shorts/ZJQ-c4HyeX8', 'ZJQ-c4HyeX8'],
    ['https://www.youtube.com/live/ZJQ-c4HyeX8?t=10', 'ZJQ-c4HyeX8'],
    ['ZJQ-c4HyeX8', 'ZJQ-c4HyeX8'],
  ])('%s → %s', (url, id) => expect(parseYoutubeVideoId(url)).toBe(id));

  it.each(['https://evil.com/watch?v=ZJQ-c4HyeX8', 'https://youtube.com.evil.com/watch?v=ZJQ-c4HyeX8', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=short', ''])(
    'rejects %s',
    (url) => expect(parseYoutubeVideoId(url)).toBeNull(),
  );

  it('parses ISO-8601 durations and timestamps', () => {
    expect(parseIsoDuration('PT21M5S')).toBe(1265);
    expect(parseIsoDuration('PT1H2M')).toBe(3720);
    expect(parseIsoDuration('P0D')).toBeNull();
    expect(formatTimestamp(632)).toBe('10:32');
    expect(formatTimestamp(3725)).toBe('1:02:05');
  });
});

describe('YoutubeMetadataClient (no API key)', () => {
  const respond = (status: number, body: string) => new Response(body, { status });

  it('combines oEmbed title with the watch page duration', async () => {
    const fetchImpl = jest.fn(async (url: string | URL | Request) =>
      String(url).includes('/oembed') ? respond(200, JSON.stringify({ title: 'Learn GitHub', author_name: 'Syntax' })) : respond(200, '..."lengthSeconds":"1265",...'),
    ) as unknown as typeof fetch;
    const result = await new YoutubeMetadataClient(undefined, fetchImpl).lookup('ZJQ-c4HyeX8');
    expect(result).toEqual({ kind: 'ok', info: { videoId: 'ZJQ-c4HyeX8', title: 'Learn GitHub', channel: 'Syntax', durationSeconds: 1265 } });
  });

  it('maps oEmbed 401 to not_embeddable and 404 to not_found; duration falls back to null', async () => {
    const make = (status: number) => new YoutubeMetadataClient(undefined, (async () => respond(status, '')) as unknown as typeof fetch);
    expect(await make(401).lookup('ZJQ-c4HyeX8')).toEqual({ kind: 'not_embeddable' });
    expect(await make(404).lookup('ZJQ-c4HyeX8')).toEqual({ kind: 'not_found' });
    const noLength = new YoutubeMetadataClient(undefined, (async (url: string) =>
      String(url).includes('/oembed') ? respond(200, '{"title":"T"}') : respond(200, '<html>changed</html>')) as unknown as typeof fetch);
    expect(await noLength.lookup('ZJQ-c4HyeX8')).toMatchObject({ kind: 'ok', info: { durationSeconds: null } });
  });

  it('network failure → unavailable (never throws)', async () => {
    const failing = new YoutubeMetadataClient(undefined, (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch);
    expect(await failing.lookup('ZJQ-c4HyeX8')).toEqual({ kind: 'unavailable' });
  });
});

describe('fixed split — "a break every N minutes" chosen by the supervisor', () => {
  const every = (n: number, extra: Partial<typeof DEFAULT_SCHEDULE> = {}) => ({ ...DEFAULT_SCHEDULE, splitMode: 'fixed' as const, maxLectureMinutes: n, ...extra });

  it('cuts exactly every 25 minutes; the remainder becomes the last lecture', () => {
    const plan = planSchedule(110 * 60, every(25), 1);
    expect(minutes(plan.days[0]!.lectures)).toEqual([25, 25, 25, 25, 10]);
    expect(plan.days[0]!.breakCount).toBe(4);
  });

  it('merges a tail shorter than 5 minutes into the previous lecture', () => {
    expect(minutes(planSchedule(62 * 60, every(30), 1).days[0]!.lectures)).toEqual([30, 32]);
  });

  it('groups whole lectures into days — a day never starts mid-lecture', () => {
    const plan = planSchedule(150 * 60, every(30)); // 5 lectures, 2 per 60-minute day → 3 days
    expect(plan.days.map((d) => minutes(d.lectures))).toEqual([[30, 30], [30, 30], [30]]);
    expect(plan.days[1]!.lectures[0]!.startSecond).toBe(60 * 60);
    const two = planSchedule(150 * 60, every(30), 2);
    expect(two.days.map((d) => d.lectures.length)).toEqual([3, 2]);
  });

  it('rejects more days than lectures', () => {
    expect(() => planSchedule(50 * 60, every(25), 3)).toThrow('More days than lectures');
  });
});
