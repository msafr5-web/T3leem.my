const sar = new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2 });

/** 1150 -> "١٬١٥٠٫٠٠ ر.س." */
export const formatSar = (amount: number): string => sar.format(amount);

export const courseTypeLabel = { RECORDED: 'دورة مسجلة', LIVE: 'بث مباشر' } as const;

export const lessonTypeLabel = { VIDEO: 'فيديو', ZOOM: 'جلسة مباشرة', PDF: 'ملف PDF' } as const;

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
