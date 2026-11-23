import { logger } from '../../shared/services/logger';
import type { Mailer } from '../../shared/services/mailer';
import { alertDueAt, finalizeDueAt } from './attendance.engine';
import type { AttendanceRepository, SessionDescriptor } from './attendance.repository';
import type { AttendanceService } from './attendance.service';

export interface SweeperDeps {
  repository: AttendanceRepository;
  service: AttendanceService;
  mailer: Mailer;
  clock?: () => Date;
}

const riyadh = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' });
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * Runs every minute. For every live academy it (1) warns the academy's admin once per session about trainees who still
 * have not checked in 25 minutes after the start, and (2) settles every session that has ended (PRESENT / LATE / ABSENT).
 * Safe to repeat and to run twice at once: the alert has a unique key, and settling just recomputes the same result.
 */
export class AttendanceSweeper {
  private readonly clock: () => Date;

  constructor(private readonly deps: SweeperDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async runOnce(): Promise<{ tenants: number; alerts: number; settled: number }> {
    const totals = { tenants: 0, alerts: 0, settled: 0 };
    for (const tenant of await this.deps.repository.activeTenants()) {
      totals.tenants++;
      try {
        const r = await this.sweepTenant(tenant.id, tenant.name);
        totals.alerts += r.alerts;
        totals.settled += r.settled;
      } catch (err) {
        // One academy's problem must not stop the others.
        logger.warn('Attendance sweep failed for an academy', { tenantId: tenant.id, err: err instanceof Error ? err.message : err });
      }
    }
    return totals;
  }

  async sweepTenant(tenantId: string, tenantName: string): Promise<{ alerts: number; settled: number }> {
    const now = this.clock();
    // Sessions in progress, and those that ended in the last 3 days (late Zoom events and restarts are covered by that margin).
    const sessions = await this.deps.repository.listSessions(tenantId, new Date(now.getTime() - 3 * 24 * 3_600_000), now);
    let alerts = 0;
    let settled = 0;
    for (const s of sessions) {
      if (now >= alertDueAt(s) && now < s.endsAt && (await this.alert(tenantId, tenantName, s))) alerts++;
      if (now >= finalizeDueAt(s) && (await this.settleIfNeeded(tenantId, s, now))) settled++;
    }
    return { alerts, settled };
  }

  private async settleIfNeeded(tenantId: string, s: SessionDescriptor, now: Date): Promise<boolean> {
    const trainees = await this.deps.repository.courseTrainees(tenantId, s.courseId);
    if (trainees.length === 0) return false;
    const done = new Set((await this.deps.repository.listRecords(tenantId, s.kind, s.ref)).filter((r) => r.finalizedAt).map((r) => r.userId));
    if (trainees.every((t) => done.has(t.userId))) return false;
    await this.deps.service.settle(tenantId, s, trainees, now);
    return true;
  }

  /** Tells the academy's admin who has not checked in yet. Returns true when an e-mail went out. */
  private async alert(tenantId: string, tenantName: string, s: SessionDescriptor): Promise<boolean> {
    // Only trainees the academy's admin enrolled (the company's employees) are chased; self-enrolled learners are not.
    const trainees = (await this.deps.repository.courseTrainees(tenantId, s.courseId)).filter((t) => t.adminEnrolled);
    const evidence = await this.deps.repository.loadEvidence(tenantId, s, trainees.map((t) => t.userId));
    const missing = trainees.filter((t) => !evidence.get(t.userId)?.otpVerifiedAt);
    const claim = await this.deps.repository.claimAlert(tenantId, s, missing.length);
    if (!claim) return false;
    const now = this.clock();
    const admins = missing.length > 0 ? await this.deps.repository.adminContacts(tenantId) : [];
    // Nobody is missing (or nobody to tell): the alert is settled without an e-mail, so it is not re-checked every minute.
    if (missing.length === 0 || admins.length === 0) {
      await this.deps.repository.markAlertSent(tenantId, claim.id, now);
      return false;
    }

    const when = riyadh.format(s.startsAt);
    const names = missing.slice(0, 100).map((t) => `• ${t.name}`);
    const more = missing.length > 100 ? [`… و${missing.length - 100} آخرين.`] : [];
    const text = [
      `تنبيه تأخر في «${tenantName}»`,
      '',
      `الجلسة: ${s.title}`,
      `الدورة: ${s.courseTitle}`,
      `الموعد: ${when}`,
      '',
      `لم يسجّل ${missing.length} من المتدربين حضورهم بعد مرور ${25} دقيقة على بدء الجلسة:`,
      ...names,
      ...more,
      '',
      'يمكنك متابعة الحضور والانصراف من لوحة التحكم ← الحضور والانصراف.',
    ].join('\n');
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1b1f1e;max-width:560px"><p><strong>تنبيه تأخر في «${escapeHtml(tenantName)}»</strong></p><ul><li>الجلسة: ${escapeHtml(s.title)}</li><li>الدورة: ${escapeHtml(s.courseTitle)}</li><li>الموعد: ${escapeHtml(when)}</li></ul><p>لم يسجّل ${missing.length} من المتدربين حضورهم بعد مرور 25 دقيقة على بدء الجلسة:</p><ul>${missing.slice(0, 100).map((t) => `<li>${escapeHtml(t.name)}</li>`).join('')}</ul>${missing.length > 100 ? `<p>… و${missing.length - 100} آخرين.</p>` : ''}<p style="color:#555">يمكنك متابعة الحضور والانصراف من لوحة التحكم ← الحضور والانصراف.</p></div>`;
    try {
      await Promise.all(admins.map((a) => this.deps.mailer.send({ to: a.email, subject: `تنبيه تأخر: ${missing.length} متدرب لم يسجّلوا حضورهم — ${s.title}`, text, html })));
    } catch (err) {
      // Left unsent on purpose: the next sweep (while the session is still running) tries again.
      logger.warn('Attendance alert e-mail failed', { tenantId, err: err instanceof Error ? err.message : err });
      return false;
    }
    await this.deps.repository.markAlertSent(tenantId, claim.id, now);
    return true;
  }
}
