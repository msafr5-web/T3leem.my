'use client';

import { useEffect } from 'react';

/** Same set as the API's `cleanEmail`: whitespace, zero-width and direction marks (left behind by RTL keyboards and pasting). */
const INVISIBLE = /[\u00A0\u061C\u180E\u200B-\u200F\u2028\u2029\u202A-\u202F\u2060-\u2064\u2066-\u206F\u3000\uFEFF\s]/g;

/**
 * Cleans every e-mail field as the user types or pastes, before the browser validates it. Without it a single
 * invisible character makes the browser refuse an address that looks perfectly right.
 * Listens at the document in the capture phase, so React sees the cleaned value in its own onChange.
 */
export function EmailGuard() {
  useEffect(() => {
    const onInput = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== 'email') return;
      const cleaned = el.value.replace(INVISIBLE, '');
      if (cleaned === el.value) return;
      const caret = el.selectionStart;
      const removedBefore = caret === null ? 0 : el.value.slice(0, caret).length - el.value.slice(0, caret).replace(INVISIBLE, '').length;
      el.value = cleaned;
      if (caret !== null) {
        try {
          el.setSelectionRange(caret - removedBefore, caret - removedBefore);
        } catch {
          // type=email does not allow selection ranges in every browser; the caret then goes to the end
        }
      }
    };
    document.addEventListener('input', onInput, true);
    return () => document.removeEventListener('input', onInput, true);
  }, []);
  return null;
}
