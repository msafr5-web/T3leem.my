/** The platform's own WhatsApp line: support, enquiries and the first message to new subscribers. */
export const SUPPORT_PHONE = '+966566477687';

export const WELCOME_MESSAGE = 'أهلاً بك في منصة تعليمي T3leem.my';

const digits = (v: string) => v.replace(/\D/g, '');

/** A wa.me link (opens WhatsApp with the text ready to send) for an international number such as +966566477687. */
export function waLink(phone: string, text?: string): string {
  return `https://wa.me/${digits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export const supportLink = (text?: string) => waLink(SUPPORT_PHONE, text);

/**
 * Accepts what people type (05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX, 00966...) and returns the
 * international form +9665XXXXXXXX, or null when it is not a plausible number.
 */
export function normalizePhone(raw: string): string | null {
  let d = digits(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = `966${d.slice(1)}`;
  else if (d.startsWith('5') && d.length === 9) d = `966${d}`;
  return /^[1-9][0-9]{8,14}$/.test(d) ? `+${d}` : null;
}
