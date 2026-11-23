import {
  RULES,
  alertDueAt,
  checkInOpen,
  courseAttendance,
  evaluate,
  evaluateDay,
  evaluateLive,
  finalizeDueAt,
  lateAfter,
  type Interval,
  type SessionWindow,
} from '../../src/modules/attendance/attendance.engine';

// Saudi time (UTC+3). A one-hour live session 10:00-11:00 on 1 December 2026.
const at = (hhmm: string, day = '2026-12-01') => new Date(`${day}T${hhmm}:00+03:00`);
const win: SessionWindow = { startsAt: at('10:00'), endsAt: at('11:00') };
const after = at('12:00'); // long after the session: everything is settled
const iv = (from: string, to: string | null): Interval => ({ joinedAt: at(from), leftAt: to ? at(to) : null });

describe('thresholds', () => {
  it('late = 10% of the session after its start (6 minutes of an hour), alert = 25 minutes after the start', () => {
    expect(lateAfter(win)).toEqual(at('10:06'));
    expect(lateAfter({ startsAt: at('09:00'), endsAt: at('09:40') })).toEqual(at('09:04')); // 10% of 40 minutes
    expect(alertDueAt(win)).toEqual(at('10:25'));
    expect(finalizeDueAt(win)).toEqual(at('11:05'));
  });

  it('check-in is open from 15 minutes before the start until the end', () => {
    expect(checkInOpen(win, at('09:44'))).toBe(false);
    expect(checkInOpen(win, at('09:45'))).toBe(true);
    expect(checkInOpen(win, at('10:59'))).toBe(true);
    expect(checkInOpen(win, at('11:00'))).toBe(false);
  });
});

describe('live sessions', () => {
  it('is PRESENT when checked in on time and in the call to the end', () => {
    const r = evaluateLive(win, { otpVerifiedAt: at('09:55'), intervals: [iv('10:01', '11:00')] }, after);
    expect(r).toMatchObject({ status: 'PRESENT', firstJoinAt: at('10:01'), lastLeaveAt: at('11:00'), attendedSeconds: 59 * 60 });
  });

  it('is LATE after the 10% mark, even by a minute, but PRESENT right at it', () => {
    expect(evaluateLive(win, { otpVerifiedAt: at('09:58'), intervals: [iv('10:07', '11:00')] }, after).status).toBe('LATE');
    expect(evaluateLive(win, { otpVerifiedAt: at('09:58'), intervals: [iv('10:06', '11:00')] }, after).status).toBe('PRESENT');
  });

  it('is ABSENT when they join and leave before the end, but staying to within 5 minutes of the end still counts', () => {
    expect(evaluateLive(win, { otpVerifiedAt: at('10:00'), intervals: [iv('10:01', '10:40')] }, after).status).toBe('ABSENT');
    expect(evaluateLive(win, { otpVerifiedAt: at('10:00'), intervals: [iv('10:01', '10:54')] }, after).status).toBe('ABSENT'); // 6 minutes early
    expect(evaluateLive(win, { otpVerifiedAt: at('10:00'), intervals: [iv('10:01', '10:55')] }, after).status).toBe('PRESENT'); // 5 minutes early
  });

  it('only the LAST leave counts: dropping out and coming back is not leaving', () => {
    const r = evaluateLive(win, { otpVerifiedAt: at('10:00'), intervals: [iv('10:01', '10:20'), iv('10:25', '11:00')] }, after);
    expect(r.status).toBe('PRESENT');
    expect(r.attendedSeconds).toBe((19 + 35) * 60); // the 5-minute gap is not counted as attended
  });

  it('overlapping intervals are not double counted, and anything outside the window is clipped', () => {
    const r = evaluateLive(win, { otpVerifiedAt: at('09:50'), intervals: [iv('09:40', '10:30'), iv('10:20', '11:30')] }, after);
    expect(r.attendedSeconds).toBe(3600);
  });

  it('without the e-mailed code it is ABSENT even if they were in the call', () => {
    expect(evaluateLive(win, { otpVerifiedAt: null, intervals: [iv('10:01', '11:00')] }, after).status).toBe('ABSENT');
    expect(evaluateLive(win, { otpVerifiedAt: null, intervals: [] }, after).status).toBe('ABSENT');
  });

  it('with no Zoom data (links entered by hand) the check-in alone decides present / late', () => {
    expect(evaluateLive(win, { otpVerifiedAt: at('10:03'), intervals: [] }, after)).toMatchObject({ status: 'PRESENT', firstJoinAt: at('10:03'), lastLeaveAt: null });
    expect(evaluateLive(win, { otpVerifiedAt: at('10:20'), intervals: [] }, after).status).toBe('LATE');
  });

  it('a leave that was never reported (still "in") counts as staying to the end', () => {
    expect(evaluateLive(win, { otpVerifiedAt: at('10:00'), intervals: [iv('10:01', null)] }, after).status).toBe('PRESENT');
  });

  it('is PENDING until the session is over, whatever has happened so far', () => {
    const during = at('10:30');
    expect(evaluateLive(win, { otpVerifiedAt: at('10:00'), intervals: [iv('10:01', null)] }, during)).toMatchObject({ status: 'PENDING', attendedSeconds: 29 * 60 });
    expect(evaluateLive(win, { otpVerifiedAt: null, intervals: [] }, during).status).toBe('PENDING');
  });

  it('joining only after the session ended does not count as joining it', () => {
    const r = evaluateLive(win, { otpVerifiedAt: at('10:00'), intervals: [iv('11:10', '11:20')] }, at('12:00'));
    expect(r.firstJoinAt).toEqual(at('10:00')); // falls back to the check-in
    expect(r.attendedSeconds).toBe(0);
  });
});

describe('recorded days', () => {
  it('is PRESENT when checked in on time and the day\'s lessons were finished within the day', () => {
    const r = evaluateDay(win, { otpVerifiedAt: at('09:58'), intervals: [], dayCompletedAt: at('10:50') }, after);
    expect(r).toMatchObject({ status: 'PRESENT', firstJoinAt: at('09:58'), lastLeaveAt: at('10:50') });
    expect(r.attendedSeconds).toBe(52 * 60);
  });

  it('is LATE when checking in after the 10% mark, and ABSENT when the lessons were not finished by the end', () => {
    expect(evaluateDay(win, { otpVerifiedAt: at('10:10'), intervals: [], dayCompletedAt: at('10:55') }, after).status).toBe('LATE');
    expect(evaluateDay(win, { otpVerifiedAt: at('10:00'), intervals: [], dayCompletedAt: null }, after).status).toBe('ABSENT');
    expect(evaluateDay(win, { otpVerifiedAt: at('10:00'), intervals: [], dayCompletedAt: at('11:30') }, after).status).toBe('ABSENT'); // finished after the day
    expect(evaluateDay(win, { otpVerifiedAt: null, intervals: [], dayCompletedAt: at('10:30') }, after).status).toBe('ABSENT'); // no check-in
  });

  it('is PENDING until the day is over', () => {
    expect(evaluateDay(win, { otpVerifiedAt: at('10:00'), intervals: [], dayCompletedAt: null }, at('10:30')).status).toBe('PENDING');
  });

  it('evaluate() picks the rule by kind', () => {
    const ev = { otpVerifiedAt: at('10:00'), intervals: [iv('10:01', '10:10')], dayCompletedAt: at('10:50') };
    expect(evaluate('LIVE', win, ev, after).status).toBe('ABSENT'); // left at 10:10
    expect(evaluate('DAY', win, ev, after).status).toBe('PRESENT'); // finished the day's lessons
  });
});

describe('course attendance (85%)', () => {
  const rep = (present: number, late: number, absent: number, pending = 0) =>
    courseAttendance([...Array(present).fill('PRESENT'), ...Array(late).fill('LATE'), ...Array(absent).fill('ABSENT'), ...Array(pending).fill('PENDING')]);

  it('counts PRESENT and LATE as attended, over the sessions already held only', () => {
    expect(rep(6, 1, 1)).toEqual({ held: 8, attended: 7, absent: 1, late: 1, percent: 87.5, passes: true });
    expect(rep(6, 0, 2)).toMatchObject({ percent: 75, passes: false });
    expect(rep(5, 0, 0, 3)).toMatchObject({ held: 5, percent: 100, passes: true }); // three sessions still to come are ignored
  });

  it('85% exactly passes; just below does not; nothing held yet has no figure', () => {
    expect(rep(17, 0, 3)).toMatchObject({ percent: 85, passes: true });
    expect(rep(16, 0, 3)).toMatchObject({ percent: 84.2, passes: false });
    expect(rep(0, 0, 0, 4)).toEqual({ held: 0, attended: 0, absent: 0, late: 0, percent: null, passes: null });
    expect(RULES.passPercent).toBe(85);
  });
});
