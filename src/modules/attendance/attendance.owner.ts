import { logger } from '../../shared/services/logger';
import type { AttendanceRepository } from './attendance.repository';
import type { AttendanceService, CourseAttendanceRow } from './attendance.service';

/** One academy's attendance at a glance, for the platform owner. */
export interface AcademyAttendance {
  tenantId: string;
  slug: string;
  name: string;
  /** Courses that have sessions. */
  courses: number;
  /** Sessions already held across those courses. */
  heldSessions: number;
  trainees: number;
  /** Trainees at or above their course's pass mark. */
  passingTrainees: number;
  /** Attended (present or late) share of all trainee-sessions held; null when nothing was held. */
  attendancePercent: number | null;
  lateSlots: number;
  absentSlots: number;
}

export interface OwnerAttendanceTotals {
  academies: number;
  courses: number;
  heldSessions: number;
  trainees: number;
  passingTrainees: number;
  attendancePercent: number | null;
}

const pct = (attended: number, held: number): number | null => (held === 0 ? null : Math.round((attended / held) * 1000) / 10);

/**
 * The platform owner's view across academies. It reads each live academy through the same attendance service the academy's
 * admin uses (one tenant at a time, under that academy's isolation), so the owner sees exactly the figures the academy sees.
 */
export class OwnerAttendanceService {
  constructor(private readonly deps: { repository: AttendanceRepository; service: AttendanceService }) {}

  async summary(): Promise<{ academies: AcademyAttendance[]; totals: OwnerAttendanceTotals }> {
    const academies: AcademyAttendance[] = [];
    let attendedAll = 0;
    let heldAll = 0;
    for (const t of await this.deps.repository.activeTenants()) {
      try {
        const rows = await this.deps.service.overview(t.id);
        const attended = rows.reduce((n, r) => n + r.attendedSlots, 0);
        const held = rows.reduce((n, r) => n + r.heldSlots, 0);
        attendedAll += attended;
        heldAll += held;
        academies.push({
          tenantId: t.id,
          slug: t.slug,
          name: t.name,
          courses: rows.length,
          heldSessions: rows.reduce((n, r) => n + r.held, 0),
          trainees: rows.reduce((n, r) => n + r.trainees, 0),
          passingTrainees: rows.reduce((n, r) => n + r.passingTrainees, 0),
          attendancePercent: pct(attended, held),
          lateSlots: rows.reduce((n, r) => n + r.lateSlots, 0),
          absentSlots: rows.reduce((n, r) => n + (r.heldSlots - r.attendedSlots), 0),
        });
      } catch (err) {
        // One academy's trouble must not blank the owner's whole page.
        logger.warn('Owner attendance summary failed for an academy', { tenantId: t.id, err: err instanceof Error ? err.message : err });
      }
    }
    academies.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const totals: OwnerAttendanceTotals = {
      academies: academies.length,
      courses: academies.reduce((n, a) => n + a.courses, 0),
      heldSessions: academies.reduce((n, a) => n + a.heldSessions, 0),
      trainees: academies.reduce((n, a) => n + a.trainees, 0),
      passingTrainees: academies.reduce((n, a) => n + a.passingTrainees, 0),
      attendancePercent: pct(attendedAll, heldAll),
    };
    return { academies, totals };
  }

  /** The courses of one academy (any status: the owner may look at a suspended academy too). */
  courses(tenantId: string): Promise<CourseAttendanceRow[]> {
    return this.deps.service.overview(tenantId);
  }
}
