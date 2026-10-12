/** Save text as a file via a temporary object URL. */
export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * CSV with a UTF-8 BOM (Excel-friendly). Cells starting with = + - @ (or tab/CR)
 * are prefixed with an apostrophe to prevent formula injection.
 */
export function toCsv(header: string[], rows: (string | number | undefined | null)[][]): string {
  const cell = (v: string | number | undefined | null): string => {
    let s = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
