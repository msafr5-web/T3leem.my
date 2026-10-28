const sar = new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2 });

/** 1150 -> "١٬١٥٠٫٠٠ ر.س." */
export const formatSar = (amount: number): string => sar.format(amount);

/** 1150 -> "١٬١٥٠" (whole riyals, for stat tiles). */
export const formatNumber = (n: number): string => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1 }).format(n);

// ar-SA defaults to the Umm al-Qura (Hijri) calendar; providers enter Gregorian dates, so pin
// the Gregorian calendar and Riyadh time explicitly — otherwise dates would display shifted.
const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' });
const dateTimeFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Riyadh',
});

/** "2027-06-30" or ISO -> "٣٠ يونيو ٢٠٢٧" */
export const formatDate = (value: string | null): string => {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
};

const dayMonthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' });
/** ISO -> "٢٥ أكتوبر" (for compact date badges) */
export const formatDayMonth = (iso: string): string => dayMonthFmt.format(new Date(iso));

/** ISO -> "الأحد، ٢٥ أكتوبر، ٦:٠٠ م" (Riyadh time) */
export const formatDateTime = (iso: string): string => dateTimeFmt.format(new Date(iso));

export const courseTypeLabel = { RECORDED: 'دورة مسجلة', LIVE: 'بث مباشر' } as const;
export const planTypeLabel = { TRAINING: 'خطة تدريبية', DEVELOPMENT: 'خطة تطويرية' } as const;
export const planStatusLabel = { DRAFT: 'مسودة', ACTIVE: 'نشطة', ARCHIVED: 'مؤرشفة' } as const;
export const meetingProviderLabel = { ZOOM: 'Zoom', TEAMS: 'Microsoft Teams', GOOGLE_MEET: 'Google Meet', OTHER: 'أخرى' } as const;
export const classroomStatusLabel = { SCHEDULED: 'مجدول', COMPLETED: 'منتهٍ', CANCELLED: 'ملغى' } as const;

export const lessonTypeLabel = { VIDEO: 'فيديو', ZOOM: 'جلسة مباشرة', PDF: 'ملف PDF', YOUTUBE: 'جزء مسجّل' } as const;

/** 632 -> "10:32", 3725 -> "1:02:05" (video timestamps stay in Latin digits, left-to-right). */
export const formatTimestamp = (total: number): string => {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh is UTC+3 all year (no DST)

/** Day N (0-based) of a recorded course opens N days after day 1, at the same lecture time. */
export const dayOpensAt = (startsAt: string, dayIndex: number): Date => new Date(new Date(startsAt).getTime() + dayIndex * DAY_MS);

/** ISO -> { date: "2026-11-01", time: "19:00" } in Riyadh time, for date/time inputs. */
export const riyadhInputs = (iso: string | null): { date: string; time: string } => {
  if (!iso) return { date: '', time: '' };
  const local = new Date(new Date(iso).getTime() + RIYADH_OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

const timeFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
/** ISO -> "٧:٠٠ م" (Riyadh time) */
export const formatTime = (iso: string): string => timeFmt.format(new Date(iso));

/** 1265 -> "٢١ دقيقة" */
export const formatMinutes = (seconds: number): string => `${new Intl.NumberFormat('ar-SA').format(Math.max(1, Math.round(seconds / 60)))} دقيقة`;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const isValidSlug = (slug: string): boolean => SLUG_RE.test(slug);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** Brand colors come from tenant data; only a strict hex value may reach inline CSS. */
export const safeBrandColor = (value: unknown): string | undefined =>
  typeof value === 'string' && HEX_RE.test(value) ? value : undefined;

/**
 * Post-login redirect target. Only a path inside the same academy is accepted, so a crafted
 * `?next=https://evil.example` (or `//evil.example`) can't turn login into an open redirect.
 */
export function safeNextPath(slug: string, next: unknown): string {
  if (typeof next !== 'string') return `/${slug}`;
  return next.startsWith(`/${slug}/`) && !next.startsWith('//') && !next.includes('\\') ? next : `/${slug}`;
}
