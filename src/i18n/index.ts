import { en, type MessageKey, type Messages } from './en';
import { ja } from './ja';
import { JA_PATTERNS, JA_TERMS } from './terms.ja';

export type { MessageKey } from './en';

export type Locale = 'en' | 'ja';
/** UI language preference: follow the browser, or a fixed language */
export type LocalePref = 'auto' | Locale;

const catalogs: Record<Locale, Messages> = { en, ja };

let current: Locale = 'en';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** The language to use for a preference ('auto' follows the browser's language list). */
export function resolveLocale(pref: LocalePref, languages: readonly string[] = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []): Locale {
  if (pref !== 'auto') return pref;
  for (const l of languages) {
    const base = l.toLowerCase().split('-')[0];
    if (base === 'ja') return 'ja';
    if (base === 'en') return 'en';
  }
  return 'en';
}

/** Translate `key`, replacing `{name}` placeholders from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogs[current][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/**
 * Translate a fixed English string produced outside the UI (worker labels,
 * group-code meanings, header variable descriptions, diagnostics). Unknown
 * strings are returned unchanged, so drawing content is never altered.
 */
export function tx(text: string): string {
  if (current === 'en' || !text) return text;
  const exact = JA_TERMS[text];
  if (exact !== undefined) return exact;
  for (const [re, rep] of JA_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    // $n inserts a captured part as is (names from the drawing); %n translates it (nested fixed text)
    return rep.replace(/([$%])(\d)/g, (_, k: string, n: string) => (k === '%' ? tx(m[Number(n)] ?? '') : (m[Number(n)] ?? '')));
  }
  return text;
}

const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Keyboard shortcut for display: "Ctrl+Shift+F" → "⌘⇧F" on Apple platforms. */
export function shortcut(keys: string): string {
  if (!apple) return keys;
  return keys.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥');
}
