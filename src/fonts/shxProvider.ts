import { ShxFont, ShxFontType } from '@mlightcad/shx-parser';

import type { StrokeProvider } from './strokeFont';

const SIZE = 100;

let sjisTable: Map<string, number> | null = null;
/** Unicode → Shift_JIS code (big fonts used in Japan index glyphs by SJIS). */
function sjisCode(ch: string): number | undefined {
  if (!sjisTable) {
    sjisTable = new Map();
    const dec = new TextDecoder('shift_jis');
    for (let b = 0xa1; b <= 0xdf; b++) sjisTable.set(dec.decode(new Uint8Array([b])), b);
    for (let lead = 0x81; lead <= 0xfc; lead++) {
      if (lead > 0x9f && lead < 0xe0) continue;
      for (let trail = 0x40; trail <= 0xfc; trail++) {
        if (trail === 0x7f) continue;
        const c = dec.decode(new Uint8Array([lead, trail]));
        if (c.length === 1 && c !== '�' && !sjisTable.has(c)) sjisTable.set(c, (lead << 8) | trail);
      }
    }
  }
  return sjisTable.get(ch);
}

/** AutoCAD SHX special codes for %%d, %%p, %%c in non-Unicode shape fonts. */
const SPECIAL: Record<string, number[]> = {
  '°': [0xb0, 127],
  '±': [0xb1, 128],
  'Ø': [0x2205, 0xd8, 129],
  '⌀': [0x2205, 0xd8, 129],
};

export interface ShxInfo {
  provider: StrokeProvider;
  type: 'shapes' | 'bigfont' | 'unifont';
}

/** Build a stroke provider from a user-supplied SHX file. */
export function makeShxProvider(name: string, bytes: ArrayBuffer): ShxInfo {
  const font = new ShxFont(bytes);
  const t = font.fontData.header.fontType;
  const type: ShxInfo['type'] = t === ShxFontType.BIGFONT ? 'bigfont' : t === ShxFontType.UNIFONT ? 'unifont' : 'shapes';
  const metrics = font.getFontMetrics(SIZE);
  const codesFor = (ch: string): number[] => {
    if (type === 'bigfont') {
      const c = sjisCode(ch);
      return c === undefined ? [] : [c];
    }
    const cp = ch.codePointAt(0)!;
    const special = SPECIAL[ch];
    if (type === 'unifont') return special ? [cp, ...special] : [cp];
    return special ? special : cp < 256 ? [cp] : [];
  };
  const codeCache = new Map<string, number | null>();
  const code = (ch: string): number | null => {
    let c = codeCache.get(ch);
    if (c !== undefined) return c;
    c = codesFor(ch).find((x) => font.hasChar(x)) ?? null;
    codeCache.set(ch, c);
    return c;
  };
  const glyphCache = new Map<string, { polys: number[][]; adv: number }>();
  const shape = (ch: string) => {
    let g = glyphCache.get(ch);
    if (g) return g;
    const c = code(ch);
    const s = c === null ? undefined : font.getLayoutCharShape(c, SIZE);
    const polys: number[][] = [];
    if (s) {
      for (const pl of s.polylines) {
        const flat: number[] = [];
        for (const p of pl) flat.push(p.x, -p.y);
        polys.push(flat);
      }
    }
    const adv = s?.lastPoint ? Math.abs(s.lastPoint.x) : metrics.cellWidth;
    g = { polys, adv: adv > 0 ? adv : metrics.cellWidth };
    glyphCache.set(ch, g);
    return g;
  };
  const provider: StrokeProvider = {
    name,
    // big fonts: the cell height equals the text height
    cap: type === 'bigfont' ? SIZE : metrics.capHeight || SIZE,
    baseline: 0,
    has: (ch) => ch === ' ' || code(ch) !== null,
    advance: (ch) => (ch === ' ' && code(ch) === null ? metrics.cellWidth * 0.6 : shape(ch).adv),
    glyph: (ch) => shape(ch).polys,
  };
  return { provider, type };
}
