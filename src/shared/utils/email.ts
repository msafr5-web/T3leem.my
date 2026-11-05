/**
 * Characters that are invisible or that only steer text direction. Right-to-left keyboards, copy-paste from chats
 * and Arabic web pages often leave one of them inside an e-mail address (browsers then refuse it with
 * "the part after @ must not contain the symbol ''"). None of them can be part of a real address.
 */
const INVISIBLE = /[\u00A0\u061C\u180E\u200B-\u200F\u2028\u2029\u202A-\u202F\u2060-\u2064\u2066-\u206F\u3000\uFEFF\s]/g;

/** Strips whitespace and invisible direction marks; non-strings pass through for the validators to reject. */
export function cleanEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(INVISIBLE, '') : value;
}
