import { en, type MessageKey, type Messages } from './en';

export type { MessageKey } from './en';

export type Locale = 'en';

const catalogs: Record<Locale, Messages> = { en };

let current: Locale = 'en';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** Translate `key`, replacing `{name}` placeholders from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogs[current][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}
