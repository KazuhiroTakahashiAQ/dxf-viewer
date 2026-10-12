import type { TextStyle } from '../dxf/model';
import { BUNDLED_FONT_FAMILIES } from './bundledFamilies';
import { shxToStroke } from './strokeFont';

export interface FontSpec {
  /** CSS font-family list used for filled (TrueType-like) glyphs */
  family: string;
  bold: boolean;
  italic: boolean;
  /** display name of the substitute */
  primary: string;
  /** font name as written in the drawing */
  requested: string;
  /** Hershey stroke font id when the drawing font is an SHX stroke font */
  stroke?: string;
  /** CJK/full-width characters are drawn in square cells (SHX big font behaviour) */
  bigFont?: boolean;
  /** stroke provider for big-font glyphs (user-supplied big font SHX) */
  bigStroke?: string;
  widthScale: number;
  heightScale: number;
}

export interface FontOverride {
  /** 'auto' | bundled family id | 'stroke:<hershey id>' | 'local:<family name>' */
  target: string;
  widthScale: number;
  heightScale: number;
}

export interface UserFontInfo {
  kind: 'ttf' | 'shx';
  /** CSS family registered for TrueType/OpenType user fonts */
  family?: string;
  /** stroke provider id for SHX user fonts */
  strokeId?: string;
  shxType?: 'shapes' | 'bigfont' | 'unifont';
}

interface FontConfig {
  preferLocal: boolean;
  overrides: Record<string, FontOverride>;
  /** user fonts keyed by lower-case file base name (without extension) */
  userFonts: Map<string, UserFontInfo>;
}

const config: FontConfig = { preferLocal: true, overrides: {}, userFonts: new Map() };

function userFont(name: string | undefined): UserFontInfo | undefined {
  if (!name) return undefined;
  const key = name.replace(/^.*[\\/]/, '').replace(/\.(shx|ttf|ttc|otf|woff2?)$/i, '').trim().toLowerCase();
  return config.userFonts.get(key);
}

export function configureFonts(c: Partial<FontConfig>): void {
  Object.assign(config, c);
}

export function fontConfig(): Readonly<FontConfig> {
  return config;
}

const q = (name: string) => `"${name.replace(/"/g, '')}"`;
const bundled = (id: string) => {
  const f = BUNDLED_FONT_FAMILIES.find((x) => x.id === id);
  return f ? q(f.cssFamily) : '';
};

const JP_GOTHIC = bundled('biz-udgothic');
/** Fallback appended to every stack so CJK glyphs always resolve. */
const TAIL = `${JP_GOTHIC}, sans-serif`;

interface Rule {
  test: RegExp;
  /** bundled ids in fallback order */
  ids: string[];
  /** names of the real font that may be installed locally */
  local: string[];
}

/**
 * Mapping from font names found in drawings (STYLE font file, XDATA family,
 * MTEXT \f) to bundled substitutes. First match wins.
 */
const RULES: Rule[] = [
  { test: /(ms\s*|ｍｓ\s*)(p|ｐ)\s*(gothic|ゴシック)|ms\s*pgothic/i, ids: ['biz-udpgothic', 'arimo'], local: ['MS PGothic', 'ＭＳ Ｐゴシック'] },
  { test: /(ms\s*|ｍｓ\s*)(p|ｐ)\s*(mincho|明朝)|ms\s*pmincho/i, ids: ['biz-udpmincho', 'tinos'], local: ['MS PMincho', 'ＭＳ Ｐ明朝'] },
  { test: /ms\s*ui\s*gothic/i, ids: ['biz-udpgothic', 'arimo'], local: ['MS UI Gothic'] },
  { test: /msgothic|ms\s*gothic|ｍｓ\s*ゴシック|ms\s*ゴシック|osaka.?mono|msgoth/i, ids: ['biz-udgothic', 'arimo'], local: ['MS Gothic', 'ＭＳ ゴシック'] },
  { test: /msmincho|ms\s*mincho|ｍｓ\s*明朝|ms\s*明朝|msmin/i, ids: ['biz-udmincho', 'tinos'], local: ['MS Mincho', 'ＭＳ 明朝'] },
  { test: /biz\s*ud\s*p\s*gothic|bizudp.?gothic/i, ids: ['biz-udpgothic', 'arimo'], local: ['BIZ UDPGothic'] },
  { test: /biz\s*ud\s*gothic|bizud.?gothic/i, ids: ['biz-udgothic', 'arimo'], local: ['BIZ UDGothic'] },
  { test: /biz\s*ud\s*p\s*mincho/i, ids: ['biz-udpmincho', 'tinos'], local: ['BIZ UDPMincho'] },
  { test: /biz\s*ud\s*mincho/i, ids: ['biz-udmincho', 'tinos'], local: ['BIZ UDMincho'] },
  { test: /meiryo|メイリオ/i, ids: ['noto-sans-jp', 'arimo'], local: ['Meiryo', 'メイリオ'] },
  { test: /yu\s*gothic|游ゴシック|yugoth/i, ids: ['noto-sans-jp', 'arimo'], local: ['Yu Gothic', '游ゴシック', 'YuGothic'] },
  { test: /hg.*(gothic|ｺﾞｼｯｸ|ゴシック)|hiragino.*(sans|kaku|角)|ヒラギノ角|noto\s*sans\s*(jp|cjk)|源ノ角/i, ids: ['noto-sans-jp', 'arimo'], local: [] },
  { test: /yu\s*mincho|游明朝|yumin/i, ids: ['noto-serif-jp', 'tinos'], local: ['Yu Mincho', '游明朝', 'YuMincho'] },
  { test: /hg.*(mincho|明朝)|hiragino.*(mincho|明朝)|ヒラギノ明朝|noto\s*serif\s*(jp|cjk)|源ノ明朝/i, ids: ['noto-serif-jp', 'tinos'], local: [] },
  { test: /courier|consolas|lucida\s*console/i, ids: ['cousine', 'biz-udgothic'], local: ['Courier New'] },
  { test: /times|century|georgia|garamond|book\s*antiqua/i, ids: ['tinos', 'biz-udmincho'], local: ['Times New Roman'] },
  { test: /calibri/i, ids: ['carlito', 'biz-udgothic'], local: ['Calibri'] },
  { test: /cambria/i, ids: ['caladea', 'biz-udmincho'], local: ['Cambria'] },
  { test: /arial\s*narrow|arialn/i, ids: ['arimo', 'biz-udgothic'], local: ['Arial Narrow'] },
  { test: /arial|helvetica|segoe|verdana|tahoma|swiss/i, ids: ['arimo', 'biz-udgothic'], local: ['Arial', 'Helvetica'] },
];

/** Narrow families approximated by horizontal scaling of a regular substitute. */
const NARROW = /narrow|arialn|condensed/i;

/** SHX files that are Japanese (big) fonts rather than Latin stroke fonts. */
const JP_SHX = /^@?(extfont|bigfont|kst32|jis|jpn|jw|kanji|tfas|rebro)/i;

function baseName(file: string): string {
  return file.replace(/^.*[\\/]/, '').trim();
}

function isShxName(n: string): boolean {
  return /\.shx$/i.test(n) || (!!n && !/\.(ttf|ttc|otf|pfb)$/i.test(n) && /^[a-z0-9_@-]+$/i.test(n) && !/arial|times|courier|gothic|mincho|meiryo|calibri|cambria|century|verdana|tahoma|segoe|helvetica/i.test(n));
}

function stackFor(ids: string[], local: string[]): string {
  const parts: string[] = [];
  if (config.preferLocal) parts.push(...local.map(q));
  parts.push(...ids.map(bundled).filter(Boolean));
  parts.push(TAIL);
  return parts.join(', ');
}

function displayOf(ids: string[]): string {
  return BUNDLED_FONT_FAMILIES.find((f) => f.id === ids[0])?.displayName ?? ids[0];
}

function applyOverride(spec: FontSpec): FontSpec {
  const ov = config.overrides[spec.requested.toLowerCase()];
  if (!ov) return spec;
  const out = { ...spec, widthScale: spec.widthScale * (ov.widthScale || 1), heightScale: spec.heightScale * (ov.heightScale || 1) };
  if (ov.target.startsWith('user:')) {
    const u = config.userFonts.get(ov.target.slice(5).toLowerCase());
    if (u?.kind === 'ttf' && u.family) {
      out.stroke = undefined;
      out.family = `${q(u.family)}, ${TAIL}`;
      out.primary = `User: ${ov.target.slice(5)}`;
    } else if (u?.strokeId) {
      if (u.shxType === 'bigfont') out.bigStroke = u.strokeId;
      else out.stroke = u.strokeId;
      out.primary = `User SHX: ${ov.target.slice(5)}`;
    }
  } else if (ov.target.startsWith('stroke:')) {
    out.stroke = ov.target.slice(7);
    out.primary = `Stroke: ${out.stroke}`;
  } else if (ov.target.startsWith('local:')) {
    const name = ov.target.slice(6);
    out.stroke = undefined;
    out.family = `${q(name)}, ${TAIL}`;
    out.primary = name;
  } else if (ov.target !== 'auto') {
    out.stroke = undefined;
    out.family = `${bundled(ov.target)}, ${TAIL}`;
    out.primary = displayOf([ov.target]);
  }
  return out;
}

/**
 * Resolve a text style (and optional MTEXT \f/\F override) to a font spec.
 */
export function resolveFont(style: TextStyle | undefined, override?: { font?: string; bold?: boolean; italic?: boolean; shx?: boolean }): FontSpec {
  const fontFile = baseName(style?.font ?? '');
  const family = style?.family ?? '';
  const big = baseName(style?.bigFont ?? '');
  const ttfBold = ((style?.ttfFlags ?? 0) & 0x2000000) !== 0;
  const ttfItalic = ((style?.ttfFlags ?? 0) & 0x1000000) !== 0;
  const bold = override?.bold ?? ttfBold;
  const italic = override?.italic ?? ttfItalic;
  const requested = (override?.font || family || fontFile || 'txt').trim();
  const base = { bold, italic, requested, widthScale: 1, heightScale: 1 };
  const bigUser = userFont(big);
  const bigStroke = bigUser?.kind === 'shx' && bigUser.strokeId ? bigUser.strokeId : undefined;

  // 0. user-supplied fonts matching the requested name
  const uf = userFont(override?.font) ?? (override?.font ? undefined : userFont(family) ?? userFont(fontFile));
  if (uf?.kind === 'ttf' && uf.family) {
    return applyOverride({ ...base, family: `${q(uf.family)}, ${TAIL}`, primary: `User: ${requested}` });
  }
  if (uf?.kind === 'shx' && uf.strokeId) {
    const isBig = uf.shxType === 'bigfont';
    return applyOverride({
      ...base,
      family: stackFor(['arimo', 'biz-udgothic'], []),
      primary: `User SHX: ${requested}`,
      stroke: isBig ? undefined : uf.strokeId,
      bigFont: true,
      bigStroke: isBig ? uf.strokeId : bigStroke,
    });
  }

  // 1. TrueType-like names
  for (const name of override?.font ? [override.font] : [family, fontFile]) {
    if (!name || (override?.shx && isShxName(name))) continue;
    for (const r of RULES) {
      if (r.test.test(name)) {
        const isFamilyName = !!(override?.font || family) && !/\.(ttf|ttc|otf|shx)$/i.test(name);
        const local = isFamilyName ? [name, ...r.local] : r.local;
        return applyOverride({
          ...base,
          family: stackFor(r.ids, [...new Set(local)]),
          primary: displayOf(r.ids),
          widthScale: NARROW.test(name) ? 0.82 : 1,
        });
      }
    }
  }
  // 2. SHX fonts: stroke substitute for Latin, square cells for CJK
  const shxName = override?.font && (override.shx || isShxName(override.font)) ? override.font : fontFile || (family ? '' : 'txt');
  if (shxName && isShxName(shxName) && !(family && !override?.font)) {
    const jpMain = JP_SHX.test(baseName(shxName));
    return applyOverride({
      ...base,
      family: stackFor(['arimo', 'biz-udgothic'], []),
      primary: jpMain ? 'BIZ UDGothic (big font)' : `Hershey ${shxToStroke(shxName)}`,
      stroke: jpMain ? undefined : shxToStroke(shxName),
      bigFont: !!big || jpMain,
      bigStroke,
    });
  }
  // 3. unknown TrueType names: try the name locally, then a sans substitute
  const local = family || override?.font ? [family || override!.font!] : [];
  return applyOverride({ ...base, family: stackFor(['arimo', 'biz-udgothic'], local), primary: 'Arimo' });
}

/** Font spec for SHX big-font (CJK) glyphs. */
export function bigFontSpec(base: FontSpec): FontSpec {
  return { ...base, family: `${JP_GOTHIC}, sans-serif`, stroke: undefined, bigStroke: undefined, primary: 'BIZ UDGothic (big font)' };
}

export function cssFont(spec: FontSpec, px: number): string {
  return `${spec.italic ? 'italic ' : ''}${spec.bold ? 'bold ' : ''}${px}px ${spec.family}`;
}

/** Full-width / CJK characters (drawn from the big font for SHX styles). */
export const WIDE_CHAR = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
