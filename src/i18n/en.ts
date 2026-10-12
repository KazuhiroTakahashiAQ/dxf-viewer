/**
 * English UI strings. Every user-visible string goes through `t()` so another
 * language (e.g. `ja.ts`) can be added by providing the same keys.
 */
export const en = {
  'app.title': 'DXF Viewer',
  'app.tagline': 'Inspect DXF drawings entirely in your browser. Files never leave your device.',
  'welcome.open': 'Open DXF files…',
  'welcome.drop': 'or drop files anywhere',
  'pwa.updateAvailable': 'A new version is available.',
  'pwa.reload': 'Reload',
  'pwa.dismiss': 'Dismiss',
  'pwa.offlineReady': 'Ready to work offline.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
