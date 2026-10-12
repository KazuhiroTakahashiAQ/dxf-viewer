/**
 * AutoCAD Color Index palette.
 * Indices 10–249 follow AutoCAD's HSV construction: 24 hues (15° steps) ×
 * value levels [1, .65, .5, .3, .15] × saturation [1, .5], truncated to bytes.
 */
function hsvToRgb(h: number, s: number, v: number): number {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  const to = (u: number) => Math.min(255, Math.floor((u + m) * 255 + 1e-9));
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

function buildPalette(): Uint32Array {
  const p = new Uint32Array(256);
  const base = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  base.forEach((c, i) => (p[i] = c));
  const values = [1, 0.65, 0.5, 0.3, 0.15];
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15;
    const k = (i - 10) % 10;
    const v = values[k >> 1];
    const s = k % 2 === 0 ? 1 : 0.5;
    p[i] = hsvToRgb(hue, s, v);
  }
  const grays = [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff];
  grays.forEach((c, i) => (p[250 + i] = c));
  return p;
}

export const ACI_PALETTE = buildPalette();

export const ACI_BYBLOCK = 0;
export const ACI_BYLAYER = 256;

export function aciToRgb(aci: number): number {
  return ACI_PALETTE[Math.abs(aci) & 0xff];
}

export function rgbToCss(rgb: number): string {
  return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
}

/** Perceived luminance 0..1 */
export function luminance(rgb: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * DXF transparency (group 440): 0x020000TT = alpha TT (0 transparent, 255 opaque),
 * 0x01000000 = BYBLOCK, 0 = BYLAYER. Returns opacity 0..1 or undefined for BY*.
 */
export function transparencyToAlpha(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if ((v & 0x02000000) !== 0) return (v & 0xff) / 255;
  return undefined;
}
