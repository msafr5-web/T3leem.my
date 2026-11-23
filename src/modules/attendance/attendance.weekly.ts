import { withTenantTransaction } from '../../config/database';
import { logger } from '../../shared/services/logger';
import type { Mailer } from '../../shared/services/mailer';
import { courseAttendance, type AttendanceStatus } from './attendance.engine';
import type { AttendanceRepository, SessionDescriptor } from './attendance.repository';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Riyadh has no daylight saving: always UTC+3. */
const RIYADH_OFFSET = 3 * HOUR;
/** The digest goes out from Sunday 08:00 Riyadh time, and is still sent (once) if the server was down, for up to 3 days. */
const SEND_HOUR = 8;
const CATCH_UP_DAYS = 3;
const MAX_LISTED = 50;

export interface ReportWeek {
  /** Sunday 00:00 Riyadh, inclusive. */
  start: Date;
  /** The next Sunday 00:00 Riyadh, exclusive. */
  end: Date;
  /** Riyadh date of `start` (YYYY-MM-DD): the idempotency key. */
  key: string;
}

/** The last complete Sunday-to-Saturday week (Riyadh time) before `now`, and whether it is time to send its digest. */
export function reportWeek(now: Date): { week: ReportWeek; due: boolean } {
  const local = new Date(now.getTime() + RIYADH_OFFSET);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const thisSunday = midnightLocal - local.getUTCDay() * DAY; // getUTCDay: 0 = Sunday
  const startLocal = thisSunday - 7 * DAY;
  const start = new Date(startLocal - RIYADH_OFFSET);
  const end = new Date(thisSunday - RIYADH_OFFSET);
  const sendFrom = end.getTime() + SEND_HOUR * HOUR;
  const due = now.getTime() >= sendFrom && now.getTime() < end.getTime() + CATCH_UP_DAYS * DAY + SEND_HOUR * HOUR;
  return { week: { start, end, key: new Date(startLocal).toISOString().slice(0, 10) }, due };
}

export interface WeeklyTrainee {
  name: string;
  held: number;
  attended: number;
  late: number;
  absent: number;
  percent: number | null;
}
export interface WeeklyCourse {
  title: string;
  sessionsHeld: number;
  passPercent: number;
  /** Average of the corporate trainees' attendance percentages; null when nobody had a held session. */
  averagePercent: number | null;
  traineeCount: number;
  /** Trainees below the course's pass mark, lowest first. */
  needFollowUp: WeeklyTrainee[];
}

/** Pure: turns the week's settled statuses into the per-course digest. `statuses` maps userId to that trainee's statuses in the week. */
export function summarizeCourse(title: string, passPercent: number, sessionsHeld: number, trainees: { userId: string; name: string }[], statuses: Map<string, AttendanceStatus[]>): WeeklyCourse {
  const rows = trainees.map((t) => ({ name: t.name, ...courseAttendance(statuses.get(t.userId) ?? [], passPercent) }));
  const counted = rows.filter((r) => r.percent !== null);
  const average = counted.length === 0 ? null : Math.round((counted.reduce((n, r) => n + (r.percent as number), 0) / counted.length) * 10) / 10;
  const needFollowUp = rows
    .filter((r) => r.passes === false)
    .sort((a, b) => (a.percent as number) - (b.percent as number) || a.name.localeCompare(b.name))
    .map((r) => ({ name: r.name, held: r.held, attended: r.attended, late: r.late, absent: r.absent, percent: r.percent }));
  return { title, sessionsHeld, passPercent, averagePercent: average, traineeCount: trainees.length, needFollowUp };
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const dateFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium', timeZone: 'Asia/Riyadh' });
const num = (n: number | null) => (n === null ? '—' : `${n}٪`);

export function renderWeeklyEmail(academy: string, week: ReportWeek, courses: WeeklyCourse[]): { subject: string; text: string; html: string } {
  const from = dateFmt.format(week.start);
  const to = dateFmt.format(new Date(week.end.getTime() - DAY));
  const subject = `التقرير الأسبوعي للحضور — ${academy} (${from} – ${to})`;
  const lines: string[] = [`التقرير الأسبوعي للحضور في «${academy}»`, `الأسبوع: ${from} – ${to}`, ''];
  const parts: string[] = [`<p><strong>التقرير الأسبوعي للحضور في «${escapeHtml(academy)}»</strong><br>الأسبوع: ${escapeHtml(from)} – ${escapeHtml(to)}</p>`];
  for (const c of courses) {
    lines.push(`■ ${c.title}`, `  الجلسات المنعقدة: ${c.sessionsHeld} — المتدربون: ${c.traineeCount} — متوسط الحضور: ${num(c.averagePercent)} (حد النجاح ${c.passPercent}٪)`);
    parts.push(`<h3 style="margin:16px 0 4px">${escapeHtml(c.title)}</h3><p style="margin:0">الجلسات المنعقدة: ${c.sessionsHeld} — المتدربون: ${c.traineeCount} — متوسط الحضور: ${num(c.averagePercent)} (حد النجاح ${c.passPercent}٪)</p>`);
    if (c.needFollowUp.length === 0) {
      lines.push('  لا أحد دون حد النجاح هذا الأسبوع.', '');
      parts.push('<p style="margin:4px 0;color:#2d6a3e">لا أحد دون حد النجاح هذا الأسبوع.</p>');
      continue;
    }
    lines.push('  يحتاجون متابعة:');
    const shown = c.needFollowUp.slice(0, MAX_LISTED);
    for (const t of shown) lines.push(`  • ${t.name}: حضر ${t.attended} من ${t.held} (${num(t.percent)})، غياب ${t.absent}، تأخر ${t.late}`);
    if (c.needFollowUp.length > shown.length) lines.push(`  … و${c.needFollowUp.length - shown.length} آخرين.`);
    lines.push('');
    parts.push(
      `<p style="margin:4px 0">يحتاجون متابعة:</p><ul>${shown.map((t) => `<li>${escapeHtml(t.name)}: حضر ${t.attended} من ${t.held} (${num(t.percent)})، غياب ${t.absent}، تأخر ${t.late}</li>`).join('')}</ul>${c.needFollowUp.length > shown.length ? `<p>… و${c.needFollowUp.length - shown.length} آخرين.</p>` : ''}`,
    );
  }
  lines.push('التفاصيل الكاملة والقرارات اليدوية من لوحة التحكم ← الحضور والانصراف.');
  parts.push('<p style="color:#555">التفاصيل الكاملة والقرارات اليدوية من لوحة التحكم ← الحضور والانصراف.</p>');
  return { subject, text: lines.join('\n'), html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1b1f1e;max-width:600px">${parts.join('')}</div>` };
}

/** Remembers which academy/week digests were sent, so a restart or a second instance never sends one twice. */
export interface WeeklyClaims {
  /** Null when this week's digest was already sent (or another instance is on it); an unsent earlier claim is returned again. */
  claim(tenantId: string, weekKey: string): Promise<{ id: string } | null>;
  markSent(tenantId: string, id: string, at: Date): Promise<void>;
}

export class PrismaWeeklyClaims implements WeeklyClaims {
  claim(tenantId: string, weekKey: string): Promise<{ id: string } | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.attendanceWeeklyReport.findUnique({ where: { tenantId_weekStart: { tenantId, weekStart: weekKey } } });
      if (existing) return existing.sentAt ? null : { id: existing.id };
      return tx.attendanceWeeklyReport.create({ data: { tenantId, weekStart: weekKey }, select: { id: true } });
    }).catch((err: unknown) => {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') return null; // two instances at once: the other owns it
      throw err;
    });
  }

  markSent(tenantId: string, id: string, at: Date): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      await tx.attendanceWeeklyReport.updateMany({ where: { tenantId, id }, data: { sentAt: at } });
    });
  }
}

export interface WeeklyDeps {
  repository: AttendanceRepository;
  claims: WeeklyClaims;
  mailer: Mailer;
  clock?: () => Date;
}

/**
 * Once a week (Sunday morning, Riyadh) e-mails each academy's admins how the company's trainees attended last week:
 * average per course and who is below the pass mark. Only trainees the admin enrolled are counted (the company's employees).
 */
export class WeeklyReportSender {
  private readonly clock: () => Date;

  constructor(private readonly deps: WeeklyDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async runOnce(): Promise<{ academies: number; sent: number }> {
    const totals = { academies: 0, sent: 0 };
    const { week, due } = reportWeek(this.clock());
    if (!due) return totals;
    for (const tenant of await this.deps.repository.activeTenants()) {
      totals.academies++;
      try {
        if (await this.sendFor(tenant.id, tenant.name, week)) totals.sent++;
      } catch (err) {
        logger.warn('Weekly attendance report failed for an academy', { tenantId: tenant.id, err: err instanceof Error ? err.message : err });
      }
    }
    return totals;
  }

  /** Returns true when an e-mail went out. */
  async sendFor(tenantId: string, tenantName: string, week: ReportWeek): Promise<boolean> {
    const claim = await this.deps.claims.claim(tenantId, week.key);
    if (!claim) return false;
    const now = this.clock();
    const courses = await this.build(tenantId, week, now);
    const admins = courses.length > 0 ? await this.deps.repository.adminContacts(tenantId) : [];
    // Nothing was held (or nobody to tell): settled without an e-mail, so it is not re-checked every run.
    if (courses.length === 0 || admins.length === 0) {
      await this.deps.claims.markSent(tenantId, claim.id, now);
      return false;
    }
    const mail = renderWeeklyEmail(tenantName, week, courses);
    try {
      await Promise.all(admins.map((a) => this.deps.mailer.send({ to: a.email, ...mail })));
    } catch (err) {
      // Left unsent on purpose: the next run (within the catch-up window) tries again.
      logger.warn('Weekly attendance e-mail failed', { tenantId, err: err instanceof Error ? err.message : err });
      return false;
    }
    await this.deps.claims.markSent(tenantId, claim.id, now);
    return true;
  }

  private async build(tenantId: string, week: ReportWeek, now: Date): Promise<WeeklyCourse[]> {
    const all = await this.deps.repository.listSessions(tenantId, week.start, week.end);
    // Held sessions that started inside the week.
    const held = all.filter((s) => s.startsAt >= week.start && s.startsAt < week.end && s.endsAt <= now);
    const byCourse = new Map<string, SessionDescriptor[]>();
    for (const s of held) byCourse.set(s.courseId, [...(byCourse.get(s.courseId) ?? []), s]);

    const out: WeeklyCourse[] = [];
    for (const [courseId, sessions] of byCourse) {
      const trainees = (await this.deps.repository.courseTrainees(tenantId, courseId)).filter((t) => t.adminEnrolled);
      if (trainees.length === 0) continue;
      const statuses = new Map<string, AttendanceStatus[]>();
      for (const s of sessions) {
        const records = new Map((await this.deps.repository.listRecords(tenantId, s.kind, s.ref)).map((r) => [r.userId, r]));
        for (const t of trainees) {
          const r = records.get(t.userId);
          // Not settled yet (PENDING / no row): left out rather than guessed.
          if (!r || r.status === 'PENDING') continue;
          statuses.set(t.userId, [...(statuses.get(t.userId) ?? []), r.status]);
        }
      }
      const first = sessions[0] as SessionDescriptor;
      out.push(summarizeCourse(first.courseTitle, first.rules.passPercent, sessions.length, trainees, statuses));
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }
}
