import type { TextStyle } from '../dxf/model';

export interface FontSpec {
  /** CSS font-family list */
  family: string;
  bold: boolean;
  italic: boolean;
  /** primary bundled family id used for the stack (for display/diagnostics) */
  primary: string;
  /** what the font name in the drawing was */
  requested: string;
  /** SHX big font substitute: full-width glyphs get a square cell */
  bigFont?: boolean;
}

const JP_GOTHIC = '"dxfv BIZ UDGothic"';
const JP_PGOTHIC = '"dxfv BIZ UDPGothic"';
const JP_MINCHO = '"dxfv BIZ UDMincho"';
const JP_PMINCHO = '"dxfv BIZ UDPMincho"';
const JP_SANS = '"dxfv Noto Sans JP"';
const JP_SERIF = '"dxfv Noto Serif JP"';
const ARIMO = '"dxfv Arimo"';
const TINOS = '"dxfv Tinos"';
const COUSINE = '"dxfv Cousine"';
const CARLITO = '"dxfv Carlito"';
const CALADEA = '"dxfv Caladea"';

/** Fallback appended to every stack so CJK glyphs always resolve. */
const TAIL = `${JP_GOTHIC}, sans-serif`;

interface Rule {
  test: RegExp;
  stack: string;
  primary: string;
}

/**
 * Mapping from font names found in drawings (STYLE font file, XDATA family,
 * MTEXT \f) to bundled substitutes. Order matters: first match wins.
 */
const RULES: Rule[] = [
  { test: /(ms\s*|ｍｓ\s*)(p|ｐ)\s*(gothic|ゴシック)|msgothic.*p|ms\s*pgothic/i, stack: `${JP_PGOTHIC}, ${ARIMO}`, primary: 'BIZ UDPGothic' },
  { test: /(ms\s*|ｍｓ\s*)(p|ｐ)\s*(mincho|明朝)|ms\s*pmincho/i, stack: `${JP_PMINCHO}, ${TINOS}`, primary: 'BIZ UDPMincho' },
  { test: /ms\s*ui\s*gothic|msgothic|ms\s*gothic|ｍｓ\s*ゴシック|ms\s*ゴシック|osaka.?mono|msgoth/i, stack: `${JP_GOTHIC}, ${ARIMO}`, primary: 'BIZ UDGothic' },
  { test: /msmincho|ms\s*mincho|ｍｓ\s*明朝|ms\s*明朝|msmin/i, stack: `${JP_MINCHO}, ${TINOS}`, primary: 'BIZ UDMincho' },
  { test: /biz\s*ud\s*p\s*gothic|bizudp.?gothic/i, stack: `${JP_PGOTHIC}, ${ARIMO}`, primary: 'BIZ UDPGothic' },
  { test: /biz\s*ud\s*gothic|bizud.?gothic/i, stack: `${JP_GOTHIC}, ${ARIMO}`, primary: 'BIZ UDGothic' },
  { test: /biz\s*ud\s*p\s*mincho/i, stack: `${JP_PMINCHO}, ${TINOS}`, primary: 'BIZ UDPMincho' },
  { test: /biz\s*ud\s*mincho/i, stack: `${JP_MINCHO}, ${TINOS}`, primary: 'BIZ UDMincho' },
  { test: /meiryo|メイリオ|yu\s*gothic|游ゴシック|yugoth|hg.*(gothic|ｺﾞｼｯｸ|ゴシック)|hiragino.*(sans|kaku|角)|ヒラギノ角|noto\s*sans\s*(jp|cjk)|源ノ角/i, stack: `${JP_SANS}, ${ARIMO}`, primary: 'Noto Sans JP' },
  { test: /yu\s*mincho|游明朝|yumin|hg.*(mincho|明朝)|hiragino.*(mincho|明朝)|ヒラギノ明朝|noto\s*serif\s*(jp|cjk)|源ノ明朝/i, stack: `${JP_SERIF}, ${TINOS}`, primary: 'Noto Serif JP' },
  { test: /courier|consolas|monotxt|lucida\s*console/i, stack: `${COUSINE}, ${JP_GOTHIC}`, primary: 'Cousine' },
  { test: /times|century|georgia|garamond|book\s*antiqua|romant|romanc|romand|serif/i, stack: `${TINOS}, ${JP_MINCHO}`, primary: 'Tinos' },
  { test: /calibri/i, stack: `${CARLITO}, ${JP_GOTHIC}`, primary: 'Carlito' },
  { test: /cambria/i, stack: `${CALADEA}, ${JP_MINCHO}`, primary: 'Caladea' },
  { test: /arial|helvetica|segoe|verdana|tahoma|swiss|sans/i, stack: `${ARIMO}, ${JP_GOTHIC}`, primary: 'Arimo' },
];

/** SHX fonts that are Japanese big fonts or Japanese-oriented shape fonts. */
const JP_SHX = /extfont|bigfont|@?extfont2|kst32|jis|jpn|jw|ms[-_]?gothic/i;

function baseName(file: string): string {
  return file.replace(/^.*[\\/]/, '').trim();
}

/**
 * Resolve a text style (and optional MTEXT \f override) to a CSS font stack.
 * Returns bundled-font stacks only (local installed fonts are preferred later
 * by putting the requested family first when available).
 */
export function resolveFont(style: TextStyle | undefined, override?: { font?: string; bold?: boolean; italic?: boolean }): FontSpec {
  const fontFile = baseName(style?.font ?? '');
  const family = style?.family ?? '';
  const big = baseName(style?.bigFont ?? '');
  const requested = override?.font || family || fontFile || 'txt';
  const ttfBold = ((style?.ttfFlags ?? 0) & 0x2000000) !== 0;
  const ttfItalic = ((style?.ttfFlags ?? 0) & 0x1000000) !== 0;
  const bold = override?.bold ?? ttfBold;
  const italic = override?.italic ?? ttfItalic;
  for (const name of [requested, family, fontFile]) {
    if (!name) continue;
    for (const r of RULES) {
      if (r.test.test(name)) {
        return { family: `${r.stack}, ${TAIL}`, bold, italic, primary: r.primary, requested };
      }
    }
  }
  // SHX fonts: Latin stroke fonts approximated with Arimo, Japanese big fonts with BIZ UDGothic
  const isShx = /\.shx$/i.test(fontFile) || (!/\.(ttf|ttc|otf)$/i.test(fontFile) && !family);
  if (isShx && (JP_SHX.test(fontFile) || JP_SHX.test(big))) {
    return { family: `${ARIMO}, ${TAIL}`, bold, italic, primary: 'BIZ UDGothic (big font)', requested, bigFont: !!big };
  }
  return { family: `${ARIMO}, ${TAIL}`, bold, italic, primary: 'Arimo', requested, bigFont: !!big };
}

export function cssFont(spec: FontSpec, px: number): string {
  return `${spec.italic ? 'italic ' : ''}${spec.bold ? 'bold ' : ''}${px}px ${spec.family}`;
}
