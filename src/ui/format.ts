const UNIT_NAMES: Record<number, string> = {
  0: '',
  1: 'in',
  2: 'ft',
  3: 'mi',
  4: 'mm',
  5: 'cm',
  6: 'm',
  7: 'km',
  8: 'µin',
  9: 'mil',
  10: 'yd',
  11: 'Å',
  12: 'nm',
  13: 'µm',
  14: 'dm',
  15: 'dam',
  16: 'hm',
  17: 'Gm',
  18: 'AU',
  19: 'ly',
  20: 'pc',
};

export function unitName(insunits: number | undefined): string {
  return UNIT_NAMES[insunits ?? 0] ?? '';
}

export function formatNumber(v: number, precision: number): string {
  if (!Number.isFinite(v)) return '—';
  const p = Math.max(0, Math.min(12, precision));
  return v.toFixed(p);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

/** Compact number for "1 px = …" displays. */
export function formatScale(unitsPerPx: number): string {
  if (!Number.isFinite(unitsPerPx) || unitsPerPx <= 0) return '—';
  const exp = Math.floor(Math.log10(unitsPerPx));
  const digits = Math.max(0, 2 - exp);
  return unitsPerPx >= 1e6 || unitsPerPx < 1e-4 ? unitsPerPx.toExponential(2) : unitsPerPx.toFixed(Math.min(8, digits));
}

export function rgbCss(rgb: number): string {
  return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
}

/** Number formatting for measurements: drawing precision ($LUPREC) and unit name. */
export function measureFormat(insUnits: number | undefined, luprec: number | undefined, coordPrecision: number): { len: (v: number) => string; area: (v: number) => string; coord: (v: number) => string } {
  const p = coordPrecision >= 0 ? coordPrecision : Math.max(2, Math.min(8, luprec ?? 4));
  const u = unitName(insUnits);
  return {
    len: (v) => `${formatNumber(v, p)}${u ? ` ${u}` : ''}`,
    area: (v) => `${formatNumber(v, p)}${u ? ` ${u}²` : ''}`,
    coord: (v) => formatNumber(v, p),
  };
}
