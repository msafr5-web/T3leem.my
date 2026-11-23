/** In-memory attendance repository for the HTTP contract tests (the real one is exercised against PostgreSQL elsewhere). */
import { DEFAULT_RULES, mergeRules, type AttendanceSettings, type AttendanceStatus, type Evidence, type Outcome, type SessionKind } from '../../../src/modules/attendance/attendance.engine';
import type { AttendanceRecord, AttendanceRepository, SessionDescriptor, TraineeRef } from '../../../src/modules/attendance/attendance.repository';
import { AttendanceService, type AttendanceOtp } from '../../../src/modules/attendance/attendance.service';

export const LIVE_SESSION = 'a3000000-0000-4000-8000-0000000000a1';
export const DAY_SESSION = 'a3000000-0000-4000-8000-0000000000a2';

export function buildAttendanceFakes(ids: { tenant: string; course: string; courseTitle: string; learner: string; otherLearner: string; otp: AttendanceOtp }) {
  const clock = { now: new Date('2026-12-01T10:00:00+03:00') };
  const t = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00+03:00`);
  const sessions: SessionDescriptor[] = [
    { kind: 'LIVE', ref: LIVE_SESSION, courseId: ids.course, courseTitle: ids.courseTitle, title: 'Live lecture', startsAt: t('10:00'), endsAt: t('11:00'), joinUrl: 'https://zoom.example/join/live', rules: DEFAULT_RULES },
    { kind: 'DAY', ref: DAY_SESSION, courseId: ids.course, courseTitle: ids.courseTitle, title: 'Day 1', startsAt: t('19:00'), endsAt: t('19:40'), joinUrl: null, rules: DEFAULT_RULES },
  ];
  const records = new Map<string, AttendanceRecord>();
  const joins: { userId: string; ref: string; at: Date; leftAt: Date | null }[] = [];
  const k = (userId: string, kind: SessionKind, ref: string) => `${userId}:${kind}:${ref}`;
  const enrolled = new Set([ids.learner]);
  const settings: AttendanceSettings = { latePercent: null, leaveGraceMinutes: null, passPercent: null };

  const repository: AttendanceRepository = {
    listSessions: async (tenantId, from, to, courseId) => (tenantId === ids.tenant ? sessions.filter((s) => s.endsAt >= from && s.startsAt <= to && (!courseId || s.courseId === courseId)) : []),
    getSession: async (tenantId, kind, ref) => (tenantId === ids.tenant ? (sessions.find((s) => s.kind === kind && s.ref === ref) ?? null) : null),
    courseInfo: async (tenantId, courseId) => (tenantId === ids.tenant && courseId === ids.course ? { title: ids.courseTitle, settings: { ...settings } } : null),
    updateCourseSettings: async (tenantId, _actor, courseId, next) => {
      if (tenantId !== ids.tenant || courseId !== ids.course) return false;
      Object.assign(settings, next);
      for (const s of sessions) s.rules = mergeRules(settings);
      for (const [key, r] of records) if (r.source !== 'MANUAL') records.set(key, { ...r, finalizedAt: null, status: 'PENDING' });
      return true;
    },
    setManualStatus: async (_t, _actor, userId, session, status, note, at) => {
      const key = k(userId, session.kind, session.ref);
      const before = records.get(key);
      records.set(key, {
        userId, kind: session.kind, sessionRef: session.ref, status, otpVerifiedAt: before?.otpVerifiedAt ?? null, firstJoinAt: before?.firstJoinAt ?? null, lastLeaveAt: before?.lastLeaveAt ?? null,
        attendedSeconds: before?.attendedSeconds ?? 0, finalizedAt: at, source: 'MANUAL', note,
      });
      return (before?.status as AttendanceStatus | undefined) ?? null;
    },
    clearManualStatus: async (_t, _actor, userId, session) => {
      const key = k(userId, session.kind, session.ref);
      const r = records.get(key);
      if (r?.source !== 'MANUAL') return false;
      records.set(key, { ...r, source: 'OTP', note: null, finalizedAt: null, status: 'PENDING' });
      return true;
    },
    activeCourseIds: async (_t, userId) => (enrolled.has(userId) ? [ids.course] : []),
    courseTrainees: async (): Promise<TraineeRef[]> => [{ userId: ids.learner, name: 'Abdullah', adminEnrolled: true }],
    getRecord: async (_t, userId, kind, ref) => records.get(k(userId, kind, ref)) ?? null,
    listRecords: async (_t, kind, ref) => [...records.values()].filter((r) => r.kind === kind && r.sessionRef === ref),
    listCourseRecords: async () => [...records.values()],
    recordCheckIn: async (_t, userId, session, at) => {
      const existing = records.get(k(userId, session.kind, session.ref));
      if (existing?.otpVerifiedAt) return existing;
      const rec: AttendanceRecord = { userId, kind: session.kind, sessionRef: session.ref, status: 'PENDING', otpVerifiedAt: at, firstJoinAt: null, lastLeaveAt: null, attendedSeconds: 0, finalizedAt: null, source: 'OTP', note: null };
      records.set(k(userId, session.kind, session.ref), rec);
      return rec;
    },
    addJoin: async (_t, userId, session, at) => void joins.push({ userId, ref: session.ref, at, leftAt: null }),
    addLeave: async (_t, userId, session, at) => {
      const open = [...joins].reverse().find((j) => j.userId === userId && j.ref === session.ref && !j.leftAt);
      if (open) open.leftAt = at;
    },
    loadEvidence: async (_t, session, userIds): Promise<Map<string, Evidence>> =>
      new Map(
        userIds.map((id) => [
          id,
          {
            otpVerifiedAt: records.get(k(id, session.kind, session.ref))?.otpVerifiedAt ?? null,
            intervals: joins.filter((j) => j.userId === id && j.ref === session.ref).map((j) => ({ joinedAt: j.at, leftAt: j.leftAt })),
            dayCompletedAt: null,
          },
        ]),
      ),
    saveOutcome: async (_t, userId, session, o: Outcome, finalized) => {
      const prev = records.get(k(userId, session.kind, session.ref));
      if (prev?.source === 'MANUAL') return; // the admin's decision stands
      records.set(k(userId, session.kind, session.ref), {
        userId, kind: session.kind, sessionRef: session.ref, status: o.status, otpVerifiedAt: prev?.otpVerifiedAt ?? null, firstJoinAt: o.firstJoinAt, lastLeaveAt: o.lastLeaveAt,
        attendedSeconds: o.attendedSeconds, finalizedAt: finalized ? clock.now : null, source: prev?.source ?? 'OTP', note: prev?.note ?? null,
      });
    },
    adminContacts: async () => [{ email: 'admin@rukn.test', name: 'Noura' }],
    claimAlert: async () => null,
    markAlertSent: async () => undefined,
    activeTenants: async () => [{ id: ids.tenant, name: 'Rukn' }],
    findTraineeByEmail: async (_t, _c, email) => (email === 'learner@rukn.test' ? ids.learner : null),
  };

  const service = new AttendanceService({ repository, otp: ids.otp, clock: () => clock.now });
  return { repository, service, clock, records, joins, enrolled, sessions, settings };
}
