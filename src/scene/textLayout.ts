import type { MTextEntity, TextEntity, TextStyle } from '../dxf/model';
import { parseTextSpecials } from '../dxf/text/escapes';
import { parseMText, type MTextItem, type MTextStyle } from '../dxf/text/mtext';
import { fromAxes, multiply, rotationZ, scaling, translation, type Mat34 } from '../geom/matrix';
import { ocsAxes, ocsToWcs } from '../geom/ocs';
import { cross3, DEG, norm3, type Vec3 } from '../geom/vec';
import { bigFontSpec, resolveFont, WIDE_CHAR, type FontSpec } from '../fonts/resolve';
import { hasStrokeGlyph, strokeMeasureCap } from '../fonts/strokeFont';

/** Reference font size used for all measuring/drawing (scaled by transforms). */
export const REF_PX = 100;

export interface FontMetrics {
  /** ratios relative to the em size */
  capHeight: number;
  ascent: number;
  descent: number;
}

export interface TextMeasurer {
  /** advance width at REF_PX */
  width(text: string, font: FontSpec): number;
  metrics(font: FontSpec): FontMetrics;
}

export type RunMode = 'fill' | 'stroke';

export interface PlacedRun {
  text: string;
  /** baseline-left position in local text units (y up) */
  x: number;
  y: number;
  /** fill: em size; stroke: cap height (local units) */
  size: number;
  scaleX: number;
  /** tan(oblique) */
  skew: number;
  font: FontSpec;
  mode: RunMode;
  /** stroke provider id (mode 'stroke') */
  stroke?: string;
  /** inline color override */
  aci?: number;
  rgb?: number;
}

export interface TextLayout {
  runs: PlacedRun[];
  /** decoration and stack line segments (x0,y0,x1,y1)… in local units */
  lines: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** nominal character height (for level-of-detail) */
  height: number;
  /** background mask rectangle (MTEXT) */
  background?: { minX: number; minY: number; maxX: number; maxY: number; aci?: number; rgb?: number; useBackground: boolean };
}

export interface PlacedText {
  layout: TextLayout;
  /** local text plane → entity WCS */
  matrix: Mat34;
}

/** A piece of text drawn with one technique. */
interface Seg {
  text: string;
  mode: RunMode;
  stroke?: string;
  font: FontSpec;
  size: number;
  scaleX: number;
  width: number;
}

type Klass = 'stroke' | 'bigstroke' | 'big' | 'fill';

function classify(ch: string, font: FontSpec): Klass {
  const wide = WIDE_CHAR.test(ch);
  if (font.bigStroke && wide && hasStrokeGlyph(font.bigStroke, ch)) return 'bigstroke';
  if (font.stroke && hasStrokeGlyph(font.stroke, ch)) return 'stroke';
  if (font.bigStroke && hasStrokeGlyph(font.bigStroke, ch)) return 'bigstroke';
  if ((font.stroke || font.bigFont) && wide) return 'big';
  return 'fill';
}

/**
 * Split text into segments by drawing technique (stroke font, big font cell,
 * filled glyphs) and measure them. `h` is the nominal (cap) height.
 */
function segment(text: string, font: FontSpec, h: number, scaleX: number, m: TextMeasurer): Seg[] {
  const segs: Seg[] = [];
  const hh = h * font.heightScale;
  const sx = scaleX * font.widthScale;
  const make = (t: string, k: Klass): Seg => {
    if (k === 'stroke' || k === 'bigstroke') {
      const id = k === 'stroke' ? font.stroke! : font.bigStroke!;
      return { text: t, mode: 'stroke', stroke: id, font, size: hh, scaleX: sx, width: strokeMeasureCap(id, t) * hh * sx };
    }
    if (k === 'big') {
      const bf = bigFontSpec(font);
      // big font glyphs occupy a square cell of the text height
      return { text: t, mode: 'fill', font: bf, size: hh, scaleX: sx, width: (m.width(t, bf) / REF_PX) * hh * sx };
    }
    const size = hh / (m.metrics(font).capHeight || 0.7);
    return { text: t, mode: 'fill', font, size, scaleX: sx, width: (m.width(t, font) / REF_PX) * size * sx };
  };
  if (!font.stroke && !font.bigFont && !font.bigStroke) {
    if (text) segs.push(make(text, 'fill'));
    return segs;
  }
  let cur = '';
  let kind: Klass | null = null;
  for (const ch of text) {
    const k = classify(ch, font);
    if (kind !== null && k !== kind) {
      segs.push(make(cur, kind));
      cur = '';
    }
    kind = k;
    cur += ch;
  }
  if (cur && kind) segs.push(make(cur, kind));
  return segs;
}

function segWidth(segs: Seg[]): number {
  let w = 0;
  for (const s of segs) w += s.width;
  return w;
}

function emptyLayout(height: number): TextLayout {
  return { runs: [], lines: [], minX: 0, minY: 0, maxX: 0, maxY: 0, height };
}

/** TEXT / ATTRIB / ATTDEF layout. */
export function layoutText(e: TextEntity, style: TextStyle | undefined, measurer: TextMeasurer, displayText?: string): PlacedText | null {
  const content = displayText ?? e.text;
  const h = e.height > 0 ? e.height : style?.height && style.height > 0 ? style.height : 2.5;
  const font = resolveFont(style);
  const met = measurer.metrics(font);
  let scaleX = e.widthFactor > 0 ? e.widthFactor : (style?.widthFactor ?? 1);
  const obliqueDeg = e.oblique || style?.oblique || 0;
  const skew = Math.tan(obliqueDeg * DEG);
  const runs = parseTextSpecials(content);
  if (!runs.length) return null;

  let hEff = h;
  const segRuns = () => runs.map((r) => ({ r, segs: segment(r.text, font, hEff, scaleX, measurer) }));
  let pieces = segRuns();
  let width = pieces.reduce((s, p) => s + segWidth(p.segs), 0);

  const insert = e.insert;
  const align = e.align ?? insert;
  let px = insert[0];
  let py = insert[1];
  const pz = insert[2];
  let rotation = (e.rotation || 0) * DEG;
  let x0 = 0;
  let y0 = 0;
  const halign = e.halign | 0;
  const valign = e.valign | 0;
  const descent = hEff * (met.descent / (met.capHeight || 0.7));

  if ((halign === 3 || halign === 5) && e.align) {
    const dx = align[0] - insert[0];
    const dy = align[1] - insert[1];
    const L = Math.hypot(dx, dy);
    if (L > 1e-12 && width > 1e-12) {
      rotation = Math.atan2(dy, dx);
      if (halign === 3) hEff = (h * L) / width;
      else scaleX = (scaleX * L) / width;
      pieces = segRuns();
      width = pieces.reduce((s, p) => s + segWidth(p.segs), 0);
    }
  } else if (halign !== 0 || valign !== 0) {
    if (e.align) {
      px = align[0];
      py = align[1];
    }
    if (halign === 1 || halign === 4) x0 = -width / 2;
    else if (halign === 2) x0 = -width;
    if (halign === 4) y0 = -hEff / 2;
    else if (valign === 1) y0 = descent;
    else if (valign === 2) y0 = -hEff / 2;
    else if (valign === 3) y0 = -hEff;
  }

  const layout = emptyLayout(hEff);
  let x = x0;
  const underlineY = y0 - descent * 0.6;
  const overlineY = y0 + hEff * 1.2;
  const strikeY = y0 + hEff / 2;
  for (const { r, segs } of pieces) {
    const start = x;
    for (const s of segs) {
      layout.runs.push({ text: s.text, x, y: y0, size: s.size, scaleX: s.scaleX, skew, font: s.font, mode: s.mode, stroke: s.stroke });
      x += s.width;
    }
    if (r.underline) layout.lines.push(start, underlineY, x, underlineY);
    if (r.overline) layout.lines.push(start, overlineY, x, overlineY);
    if (r.strike) layout.lines.push(start, strikeY, x, strikeY);
  }
  layout.minX = Math.min(x0, x0 + width);
  layout.maxX = Math.max(x0, x0 + width);
  layout.minY = y0 - descent;
  layout.maxY = y0 + hEff * 1.25;

  const gen = e.generation | 0;
  let m = multiply(ocsToWcs(e.extrusion), translation(px, py, pz));
  m = multiply(m, rotationZ(rotation));
  if (gen & 6) m = multiply(m, scaling(gen & 2 ? -1 : 1, gen & 4 ? -1 : 1, 1));
  return { layout, matrix: m };
}

interface Unit {
  kind: 'text' | 'space' | 'tab' | 'stack';
  segs: Seg[];
  item: MTextItem;
  width: number;
  /** may break after this unit */
  breakAfter: boolean;
}

const CJK = WIDE_CHAR;
const WORD_RE = /\s+|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿가-힣豈-﫿＀-｠￠-￦]|[^\sᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿가-힣豈-﫿＀-｠￠-￦]+/g;

function styleFont(base: TextStyle | undefined, s: MTextStyle): FontSpec {
  if (!s.font && !s.bold && !s.italic) return resolveFont(base);
  return resolveFont(base, { font: s.font, bold: s.bold, italic: s.italic, shx: s.shx });
}

/** MTEXT layout (also used for multi-line attributes). */
export function layoutMText(
  e: MTextEntity,
  styles: (name: string) => TextStyle | undefined,
  measurer: TextMeasurer,
): PlacedText | null {
  const style = styles(e.style);
  const h = e.height > 0 ? e.height : style?.height && style.height > 0 ? style.height : 2.5;
  const parsed = parseMText(e.text, h);
  const layout = emptyLayout(h);
  const refWidth = e.refWidth > 0 ? e.refWidth : Infinity;
  const attachment = e.attachment >= 1 && e.attachment <= 9 ? e.attachment : 1;
  const col = (attachment - 1) % 3; // 0 left, 1 center, 2 right
  const row = Math.floor((attachment - 1) / 3); // 0 top, 1 middle, 2 bottom
  const spacing = e.lineSpacingFactor > 0 ? e.lineSpacingFactor : 1;

  interface Line {
    units: Unit[];
    width: number;
    maxH: number;
    align: 'l' | 'c' | 'r' | 'j' | 'd';
    left: number;
    columnBreak: boolean;
    /** last line of its paragraph (not stretched when justified) */
    last?: boolean;
  }
  const lines: Line[] = [];

  for (const para of parsed.paragraphs) {
    const align = para.props.align ?? (col === 0 ? 'l' : col === 1 ? 'c' : 'r');
    const units: Unit[] = [];
    for (const it of para.items) {
      if (it.kind === 'tab') {
        units.push({ kind: 'tab', segs: [], item: it, width: 0, breakAfter: true });
        continue;
      }
      if (it.kind === 'stack') {
        const font = styleFont(style, it.style);
        const sh = it.style.height * 0.7;
        const wu = segWidth(segment(it.upper, font, sh, it.style.widthFactor, measurer));
        const wl = segWidth(segment(it.lower, font, sh, it.style.widthFactor, measurer));
        units.push({ kind: 'stack', segs: [], item: it, width: Math.max(wu, wl) * 1.05, breakAfter: false });
        continue;
      }
      const font = styleFont(style, it.style);
      for (const m of it.text.matchAll(WORD_RE)) {
        const t = m[0];
        const isSpace = /^\s+$/.test(t) && !t.includes(' ');
        const segs = segment(t, font, it.style.height, it.style.widthFactor, measurer);
        const tracking = it.style.tracking || 1;
        units.push({ kind: isSpace ? 'space' : 'text', segs, item: it, width: segWidth(segs) * tracking, breakAfter: isSpace || CJK.test(t) });
      }
    }
    const indentFirst = para.props.indent * h;
    const leftIndent = para.props.left * h;
    // with columns, text wraps at the column width (not the total width)
    const wrapWidth = e.columnType > 0 && e.columnWidth > 0 ? e.columnWidth : refWidth;
    const avail = wrapWidth - leftIndent - para.props.right * h;
    let cur: Line = { units: [], width: 0, maxH: h, align, left: leftIndent + indentFirst, columnBreak: para.columnBreak };
    let lastBreak = -1;
    const pushLine = () => {
      while (cur.units.length && cur.units[cur.units.length - 1].kind === 'space') cur.width -= cur.units.pop()!.width;
      lines.push(cur);
    };
    for (const u of units) {
      let w = u.width;
      if (u.kind === 'tab') {
        const tabW = 4 * h;
        const pos = cur.left + cur.width;
        const stops = para.props.tabs.map((tb) => tb * h).filter((tb) => tb > pos - leftIndent + 1e-9);
        const next = stops.length ? leftIndent + stops[0] : Math.floor((pos + 1e-9) / tabW + 1) * tabW;
        w = Math.max(0, next - pos);
        u.width = w;
      }
      if (cur.units.length && u.kind !== 'space' && cur.left - leftIndent + cur.width + w > avail + 1e-9) {
        if (lastBreak >= 0 && lastBreak < cur.units.length - 1) {
          const rest = cur.units.splice(lastBreak + 1);
          cur.width = cur.units.reduce((s, x) => s + x.width, 0);
          pushLine();
          cur = { units: rest, width: rest.reduce((s, x) => s + x.width, 0), maxH: h, align, left: leftIndent, columnBreak: false };
        } else {
          pushLine();
          cur = { units: [], width: 0, maxH: h, align, left: leftIndent, columnBreak: false };
        }
        lastBreak = -1;
      }
      cur.units.push(u);
      cur.width += w;
      const uh = u.item.kind === 'tab' ? h : u.item.style.height;
      if (uh > cur.maxH) cur.maxH = uh;
      if (u.breakAfter) lastBreak = cur.units.length - 1;
    }
    pushLine();
    lines[lines.length - 1].last = true;
  }

  // columns: static (1) / dynamic (2) column layout
  const columnCount = e.columnType > 0 ? Math.max(1, e.columnCount || 1) : 1;
  const lineAdvance = (ln: Line) => (e.lineSpacingStyle === 2 ? h : ln.maxH) * spacing * (5 / 3);
  const columnWidth = e.columnType > 0 && e.columnWidth > 0 ? e.columnWidth : Number.isFinite(refWidth) ? refWidth : 0;
  const gutter = e.columnGutter > 0 ? e.columnGutter : h;
  const placed: { line: Line; baseline: number; colX: number }[] = [];
  let column = 0;
  let y = 0;
  let colTop = true;
  let maxColH = 0;
  // a column height of 0 means "auto": use the defined height of the text frame
  const colHeight = (c: number): number => {
    const v = e.columnHeights[c];
    if (v > 0) return v;
    const defined = Number(e.definedHeight) || 0;
    const vertical = Number(e.verticalHeight) || 0;
    if (defined > 0) return defined;
    return vertical > 0 ? vertical : Infinity;
  };
  for (const ln of lines) {
    const adv = colTop ? ln.maxH : lineAdvance(ln);
    const wouldBe = -(y - adv);
    if (columnCount > 1 && column < columnCount - 1 && !colTop && (ln.columnBreak || wouldBe > colHeight(column) + 1e-9)) {
      maxColH = Math.max(maxColH, -y);
      column++;
      y = 0;
      colTop = true;
    }
    y -= colTop ? ln.maxH : lineAdvance(ln);
    colTop = false;
    placed.push({ line: ln, baseline: y, colX: column * (columnWidth + gutter) });
  }
  const totalH = Math.max(maxColH, -y);
  const blockWidth =
    columnCount > 1
      ? (column + 1) * columnWidth + column * gutter
      : Number.isFinite(refWidth)
        ? refWidth
        : Math.max(0, ...lines.map((l) => l.left + l.width));
  const ox = col === 0 ? 0 : col === 1 ? -blockWidth / 2 : -blockWidth;
  const oy = row === 0 ? 0 : row === 1 ? totalH / 2 : totalH;
  const lineBoxWidth = columnCount > 1 ? columnWidth : blockWidth;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const { line: ln, baseline, colX } of placed) {
    const base = baseline + oy;
    let x = ox + colX + ln.left;
    const free = lineBoxWidth - ln.left - ln.width;
    // justified (all but the last line) and distributed lines stretch the spaces
    let stretch = 0;
    if (Number.isFinite(free)) {
      if (ln.align === 'c') x += free / 2;
      else if (ln.align === 'r') x += free;
      else if (free > 0 && ((ln.align === 'j' && !ln.last) || ln.align === 'd')) {
        const spaces = ln.units.filter((u) => u.kind === 'space').length;
        if (spaces) stretch = free / spaces;
      }
    }
    for (const u of ln.units) {
      const it = u.item;
      const color = it.kind !== 'tab' ? { aci: it.style.aci, rgb: it.style.rgb } : {};
      if (it.kind === 'text' && u.kind !== 'space') {
        const skew = Math.tan((it.style.oblique || 0) * DEG);
        const tracking = it.style.tracking || 1;
        let sx = x;
        for (const s of u.segs) {
          layout.runs.push({ text: s.text, x: sx, y: base, size: s.size, scaleX: s.scaleX * tracking, skew, font: s.font, mode: s.mode, stroke: s.stroke, ...color });
          sx += s.width * tracking;
        }
        const met = measurer.metrics(styleFont(style, it.style));
        const desc = it.style.height * (met.descent / (met.capHeight || 0.7));
        if (it.style.underline) layout.lines.push(x, base - desc * 0.6, x + u.width, base - desc * 0.6);
        if (it.style.overline) layout.lines.push(x, base + it.style.height * 1.2, x + u.width, base + it.style.height * 1.2);
        if (it.style.strike) layout.lines.push(x, base + it.style.height / 2, x + u.width, base + it.style.height / 2);
      } else if (it.kind === 'text' && u.kind === 'space') {
        if (it.style.underline) layout.lines.push(x, base - it.style.height * 0.25, x + u.width, base - it.style.height * 0.25);
        if (it.style.strike) layout.lines.push(x, base + it.style.height / 2, x + u.width, base + it.style.height / 2);
      } else if (it.kind === 'stack') {
        const font = styleFont(style, it.style);
        const sh = it.style.height;
        const segsU = segment(it.upper, font, sh * 0.7, it.style.widthFactor, measurer);
        const segsL = segment(it.lower, font, sh * 0.7, it.style.widthFactor, measurer);
        const wu = segWidth(segsU);
        const wl = segWidth(segsL);
        const put = (segs: Seg[], sx: number, sy: number) => {
          for (const s of segs) {
            layout.runs.push({ text: s.text, x: sx, y: sy, size: s.size, scaleX: s.scaleX, skew: 0, font: s.font, mode: s.mode, stroke: s.stroke, ...color });
            sx += s.width;
          }
        };
        if (it.type === '#') {
          put(segsU, x, base + sh * 0.45);
          put(segsL, x + u.width - wl, base - sh * 0.05);
          layout.lines.push(x + u.width * 0.2, base - sh * 0.1, x + u.width * 0.8, base + sh * 1.0);
        } else {
          const center = it.type !== '^';
          put(segsU, center ? x + (u.width - wu) / 2 : x, base + sh * 0.6);
          put(segsL, center ? x + (u.width - wl) / 2 : x, base - sh * 0.4);
          if (it.type === '/') layout.lines.push(x, base + sh * 0.4, x + u.width, base + sh * 0.4);
        }
      }
      x += u.width + (u.kind === 'space' ? stretch : 0);
    }
    if (ln.units.length) {
      minX = Math.min(minX, ox + colX + ln.left);
      maxX = Math.max(maxX, x);
    }
  }
  if (!layout.runs.length && !layout.lines.length) return null;
  const fixedWidth = Number.isFinite(refWidth) || columnCount > 1;
  layout.minX = fixedWidth ? ox : minX;
  layout.maxX = fixedWidth ? ox + blockWidth : maxX;
  layout.maxY = oy;
  layout.minY = oy - totalH - h * 0.3;

  if (e.bgFlags & 3) {
    const margin = Math.max(0, (e.bgScale || 1.5) - 1) * h;
    layout.background = {
      minX: layout.minX - margin,
      maxX: layout.maxX + margin,
      minY: oy - totalH - margin,
      maxY: oy + margin,
      aci: e.bgFlags & 1 ? e.bgColor : undefined,
      rgb: e.bgFlags & 1 ? e.bgTrueColor : undefined,
      useBackground: (e.bgFlags & 2) !== 0 || (e.bgFlags & 1) === 0,
    };
  }

  // orientation: MTEXT insertion point and x-axis are WCS
  const z = norm3(e.extrusion ?? [0, 0, 1]);
  let xAxis: Vec3;
  if (e.xAxis && Math.hypot(e.xAxis[0], e.xAxis[1], e.xAxis[2]) > 1e-12) {
    const d = e.xAxis[0] * z[0] + e.xAxis[1] * z[1] + e.xAxis[2] * z[2];
    xAxis = norm3([e.xAxis[0] - d * z[0], e.xAxis[1] - d * z[1], e.xAxis[2] - d * z[2]]);
  } else if (!e.hasRotation && Math.abs(z[2]) > 1e-9) {
    // neither 11 nor 50: the WCS x-axis projected onto the text plane (as ezdxf
    // MText.get_text_direction); matters for mirrored MTEXT with extrusion (0, 0, -1)
    xAxis = norm3([1 - z[0] * z[0], -z[0] * z[1], -z[0] * z[2]]);
  } else {
    const ax = ocsAxes(z);
    const r = e.rotation || 0;
    xAxis = norm3([
      ax.x[0] * Math.cos(r) + ax.y[0] * Math.sin(r),
      ax.x[1] * Math.cos(r) + ax.y[1] * Math.sin(r),
      ax.x[2] * Math.cos(r) + ax.y[2] * Math.sin(r),
    ]);
  }
  const yAxis = norm3(cross3(z, xAxis));
  return { layout, matrix: fromAxes(xAxis, yAxis, z, e.insert) };
}
