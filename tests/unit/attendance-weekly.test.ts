import { WeeklyReportSender, renderWeeklyEmail, reportWeek, summarizeCourse, type WeeklyClaims } from '../../src/modules/attendance/attendance.weekly';
import type { AttendanceRepository, SessionDescriptor } from '../../src/modules/attendance/attendance.repository';

// Riyadh is UTC+3 all year. 2026-11-22 is a Sunday.
const riyadh = (iso: string) => new Date(`${iso}+03:00`);

describe('reportWeek', () => {
  it('on Sunday 08:00 it reports the week that just ended (Sunday to Saturday, Riyadh)', () => {
    const { week, due } = reportWeek(riyadh('2026-11-22T08:00:00'));
    expect(due).toBe(true);
    expect(week.key).toBe('2026-11-15');
    expect(week.start).toEqual(riyadh('2026-11-15T00:00:00'));
    expect(week.end).toEqual(riyadh('2026-11-22T00:00:00'));
  });

  it('is not due before 08:00 Sunday, nor in mid-week after the catch-up window', () => {
    expect(reportWeek(riyadh('2026-11-22T07:59:00')).due).toBe(false);
    expect(reportWeek(riyadh('2026-11-24T07:59:00')).due).toBe(true); // Tuesday morning: still catching up
    expect(reportWeek(riyadh('2026-11-25T08:00:00')).due).toBe(false); // Wednesday: too late, skip it
    expect(reportWeek(riyadh('2026-11-27T12:00:00')).due).toBe(false);
  });

  it('uses the Riyadh date: Saturday 23:30 UTC is already Sunday 02:30 in Riyadh but still before 08:00', () => {
    const r = reportWeek(new Date('2026-11-21T23:30:00Z'));
    expect(r.week.key).toBe('2026-11-15');
    expect(r.due).toBe(false);
  });
});

describe('summarizeCourse', () => {
  const people = [
    { userId: 'a', name: 'أحمد' },
    { userId: 'b', name: 'بدر' },
    { userId: 'c', name: 'جمال' },
    { userId: 'd', name: 'دانة' },
  ];
  it('averages the trainees who had held sessions and lists those below the pass mark, lowest first', () => {
    const s = summarizeCourse('سلامة', 85, 4, people, new Map([
      ['a', ['PRESENT', 'PRESENT', 'LATE', 'PRESENT']],
      ['b', ['PRESENT', 'ABSENT', 'ABSENT', 'PRESENT']],
      ['c', ['ABSENT', 'ABSENT', 'ABSENT', 'PRESENT']],
    ]));
    expect(s.averagePercent).toBe(58.3); // (100 + 50 + 25) / 3
    expect(s.traineeCount).toBe(4);
    expect(s.needFollowUp.map((t) => [t.name, t.percent, t.absent, t.late])).toEqual([['جمال', 25, 3, 0], ['بدر', 50, 2, 0]]);
  });

  it('a trainee with no settled session is neither averaged nor flagged', () => {
    const s = summarizeCourse('x', 85, 1, people.slice(0, 1), new Map());
    expect(s.averagePercent).toBeNull();
    expect(s.needFollowUp).toEqual([]);
  });
});

describe('renderWeeklyEmail', () => {
  const week = reportWeek(riyadh('2026-11-22T08:00:00')).week;
  it('escapes names and titles in the HTML and lists the follow-ups in the text', () => {
    const mail = renderWeeklyEmail('شركة <هيلة>', week, [
      { title: 'دورة <b>', sessionsHeld: 2, passPercent: 85, averagePercent: 50, traineeCount: 2, needFollowUp: [{ name: '<script>x</script>', held: 2, attended: 1, late: 0, absent: 1, percent: 50 }] },
    ]);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain('• <script>x</script>: حضر 1 من 2 (50٪)');
    expect(mail.subject).toContain('التقرير الأسبوعي للحضور');
  });

  it('says so when nobody is below the mark', () => {
    const mail = renderWeeklyEmail('A', week, [{ title: 'T', sessionsHeld: 1, passPercent: 85, averagePercent: 100, traineeCount: 1, needFollowUp: [] }]);
    expect(mail.text).toContain('لا أحد دون حد النجاح');
  });
});

describe('WeeklyReportSender', () => {
  const sunday = riyadh('2026-11-22T08:30:00');
  const session = (ref: string, start: string, over: Partial<SessionDescriptor> = {}): SessionDescriptor => ({
    kind: 'LIVE', ref, courseId: 'c1', courseTitle: 'سلامة', title: ref, startsAt: riyadh(start), endsAt: new Date(riyadh(start).getTime() + 3_600_000), joinUrl: null,
    rules: { lateFraction: 0.1, leaveGraceMinutes: 5, passPercent: 85 }, ...over,
  });
  const rec = (userId: string, status: string) => ({ userId, status, kind: 'LIVE', sessionRef: 'x', otpVerifiedAt: null, firstJoinAt: null, lastLeaveAt: null, attendedSeconds: 0, finalizedAt: sunday, source: 'OTP', note: null });

  function setup(opts: { sessions?: SessionDescriptor[]; admins?: { email: string; name: string }[]; sendFails?: boolean } = {}) {
    const sent: { to: string; subject: string }[] = [];
    const claimed = new Map<string, { id: string; sent: boolean }>();
    const claims: WeeklyClaims = {
      claim: async (t, k) => {
        const key = `${t}|${k}`;
        const c = claimed.get(key);
        if (c) return c.sent ? null : { id: c.id };
        claimed.set(key, { id: key, sent: false });
        return { id: key };
      },
      markSent: async (t, id) => { for (const [k, v] of claimed) if (k === id) claimed.set(k, { ...v, sent: true }); void t; },
    };
    const sessions = opts.sessions ?? [session('s1', '2026-11-16T10:00:00'), session('s2', '2026-11-17T10:00:00')];
    const repository = {
      activeTenants: async () => [{ id: 'T1', name: 'هيلة', slug: 'hela' }],
      listSessions: async () => sessions,
      courseTrainees: async () => [{ userId: 'u1', name: 'سارة', adminEnrolled: true }, { userId: 'u2', name: 'خالد', adminEnrolled: true }, { userId: 'u3', name: 'ذاتي', adminEnrolled: false }],
      listRecords: async (_t: string, _k: string, ref: string) => (ref === 's1' ? [rec('u1', 'PRESENT'), rec('u2', 'ABSENT'), rec('u3', 'ABSENT')] : [rec('u1', 'PRESENT'), rec('u2', 'ABSENT')]),
      adminContacts: async () => opts.admins ?? [{ email: 'hr@hela.test', name: 'HR' }],
    } as unknown as AttendanceRepository;
    const mailer = { send: async (m: { to: string; subject: string }) => { if (opts.sendFails) throw new Error('smtp'); sent.push(m); } };
    const sender = new WeeklyReportSender({ repository, claims, mailer: mailer as never, clock: () => sunday });
    return { sender, sent, claimed };
  }

  it('e-mails the academy admins once, counting only corporate trainees, and never twice for the same week', async () => {
    const { sender, sent } = setup();
    expect(await sender.runOnce()).toEqual({ academies: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('hr@hela.test');
    expect(await sender.runOnce()).toEqual({ academies: 1, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it('skips sessions outside the week and ones that have not ended; sends nothing when nothing was held', async () => {
    const { sender, sent } = setup({ sessions: [session('s1', '2026-11-14T10:00:00'), session('s2', '2026-11-22T09:00:00')] });
    expect((await sender.runOnce()).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('a failed e-mail is retried on the next run; no admins settles the week without an e-mail', async () => {
    const failing = setup({ sendFails: true });
    expect((await failing.sender.runOnce()).sent).toBe(0);
    expect([...failing.claimed.values()][0]?.sent).toBe(false);
    const none = setup({ admins: [] });
    expect((await none.sender.runOnce()).sent).toBe(0);
    expect([...none.claimed.values()][0]?.sent).toBe(true);
  });

  it('does nothing outside the sending window', async () => {
    const { sender, claimed } = setup();
    const late = new WeeklyReportSender({ ...(sender as unknown as { deps: ConstructorParameters<typeof WeeklyReportSender>[0] }).deps, clock: () => riyadh('2026-11-26T12:00:00') });
    expect(await late.runOnce()).toEqual({ academies: 0, sent: 0 });
    expect(claimed.size).toBe(0);
  });
});
