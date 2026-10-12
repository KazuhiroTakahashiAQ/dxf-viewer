import type { MTextEntity, TextEntity, TextStyle } from '../dxf/model';
import { parseTextSpecials } from '../dxf/text/escapes';
import { parseMText, type MTextItem, type MTextStyle } from '../dxf/text/mtext';
import { fromAxes, multiply, rotationZ, scaling, translation, type Mat34 } from '../geom/matrix';
import { ocsAxes, ocsToWcs } from '../geom/ocs';
import { cross3, DEG, norm3, type Vec3 } from '../geom/vec';
import { resolveFont, type FontSpec } from '../fonts/resolve';

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

export interface PlacedRun {
  text: string;
  /** baseline-left position in local text units (y up) */
  x: number;
  y: number;
  /** em size in local units */
  size: number;
  scaleX: number;
  /** tan(oblique) */
  skew: number;
  font: FontSpec;
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

function measureRun(m: TextMeasurer, text: string, font: FontSpec, size: number, scaleX: number): number {
  return (m.width(text, font) / REF_PX) * size * scaleX;
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
  let size = h / (met.capHeight || 0.7);
  let scaleX = e.widthFactor > 0 ? e.widthFactor : (style?.widthFactor ?? 1);
  const obliqueDeg = e.oblique || style?.oblique || 0;
  const skew = Math.tan(obliqueDeg * DEG);
  const runs = parseTextSpecials(content);
  if (!runs.length) return null;

  let width = 0;
  for (const r of runs) width += measureRun(measurer, r.text, font, size, scaleX);

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
  let height = h;

  if ((halign === 3 || halign === 5) && e.align) {
    const dx = align[0] - insert[0];
    const dy = align[1] - insert[1];
    const L = Math.hypot(dx, dy);
    if (L > 1e-12 && width > 1e-12) {
      rotation = Math.atan2(dy, dx);
      if (halign === 3) {
        const f = L / width;
        size *= f;
        height *= f;
        width = L;
      } else {
        scaleX *= L / width;
        width = L;
      }
    }
  } else if (halign !== 0 || valign !== 0) {
    if (e.align) {
      px = align[0];
      py = align[1];
    }
    if (halign === 1 || halign === 4) x0 = -width / 2;
    else if (halign === 2) x0 = -width;
    if (halign === 4) y0 = -height / 2;
    else if (valign === 1) y0 = size * met.descent;
    else if (valign === 2) y0 = -height / 2;
    else if (valign === 3) y0 = -height;
  }

  const layout = emptyLayout(height);
  let x = x0;
  const underlineY = y0 - size * met.descent * 0.6;
  const overlineY = y0 + height * 1.2;
  const strikeY = y0 + height / 2;
  for (const r of runs) {
    const w = measureRun(measurer, r.text, font, size, scaleX);
    layout.runs.push({ text: r.text, x, y: y0, size, scaleX, skew, font });
    if (r.underline) layout.lines.push(x, underlineY, x + w, underlineY);
    if (r.overline) layout.lines.push(x, overlineY, x + w, overlineY);
    if (r.strike) layout.lines.push(x, strikeY, x + w, strikeY);
    x += w;
  }
  layout.minX = Math.min(x0, x0 + width);
  layout.maxX = Math.max(x0, x0 + width);
  layout.minY = y0 - size * met.descent;
  layout.maxY = y0 + Math.max(height, size * met.ascent);

  const gen = e.generation | 0;
  let m = multiply(ocsToWcs(e.extrusion), translation(px, py, pz));
  m = multiply(m, rotationZ(rotation));
  if (gen & 6) m = multiply(m, scaling(gen & 2 ? -1 : 1, gen & 4 ? -1 : 1, 1));
  return { layout, matrix: m };
}

interface Unit {
  kind: 'text' | 'space' | 'tab' | 'stack';
  text: string;
  item: MTextItem;
  width: number;
  /** may break after this unit */
  breakAfter: boolean;
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;

function styleFont(base: TextStyle | undefined, s: MTextStyle): FontSpec {
  if (!s.font && !s.bold && !s.italic) return resolveFont(base);
  return resolveFont(base, { font: s.font, bold: s.bold, italic: s.italic });
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
  }
  const lines: Line[] = [];

  const sizeOf = (s: MTextStyle, font: FontSpec) => s.height / (measurer.metrics(font).capHeight || 0.7);

  for (const para of parsed.paragraphs) {
    const align = para.props.align ?? (col === 0 ? 'l' : col === 1 ? 'c' : 'r');
    const units: Unit[] = [];
    for (const it of para.items) {
      if (it.kind === 'tab') {
        units.push({ kind: 'tab', text: '', item: it, width: 0, breakAfter: true });
        continue;
      }
      if (it.kind === 'stack') {
        const font = styleFont(style, it.style);
        const size = sizeOf(it.style, font) * 0.7;
        const w = Math.max(
          measureRun(measurer, it.upper, font, size, it.style.widthFactor),
          measureRun(measurer, it.lower, font, size, it.style.widthFactor),
        );
        units.push({ kind: 'stack', text: '', item: it, width: w * (it.type === '^' ? 1 : 1.05), breakAfter: false });
        continue;
      }
      // split text into breakable units
      const font = styleFont(style, it.style);
      const size = sizeOf(it.style, font);
      const re = /\s+|[⺀-鿿가-힯豈-﫿＀-￯　-〿]|[^\s⺀-鿿가-힯豈-﫿＀-￯　-〿]+/g;
      for (const m of it.text.matchAll(re)) {
        const t = m[0];
        const isSpace = /^\s+$/.test(t) && !t.includes(' ');
        const w = measureRun(measurer, t, font, size, it.style.widthFactor) * (it.style.tracking || 1);
        units.push({ kind: isSpace ? 'space' : 'text', text: t, item: it, width: w, breakAfter: isSpace || CJK.test(t) });
      }
    }
    // wrap
    const indentFirst = para.props.indent * h;
    const leftIndent = para.props.left * h;
    const avail = refWidth - leftIndent - para.props.right * h;
    let cur: Line = { units: [], width: 0, maxH: h, align, left: leftIndent + indentFirst };
    let lastBreak = -1;
    const pushLine = () => {
      // trim trailing spaces
      while (cur.units.length && cur.units[cur.units.length - 1].kind === 'space') {
        cur.width -= cur.units.pop()!.width;
      }
      lines.push(cur);
    };
    for (const u of units) {
      let w = u.width;
      if (u.kind === 'tab') {
        const tabW = 4 * h;
        const pos = cur.left + cur.width;
        const stops = para.props.tabs.map((t) => t * h).filter((t) => t > pos - leftIndent + 1e-9);
        const next = stops.length ? leftIndent + stops[0] : Math.floor((pos + 1e-9) / tabW + 1) * tabW;
        w = Math.max(0, next - pos);
        u.width = w;
      }
      if (cur.units.length && u.kind !== 'space' && cur.left - leftIndent + cur.width + w > avail + 1e-9) {
        if (lastBreak >= 0 && lastBreak < cur.units.length - 1) {
          const rest = cur.units.splice(lastBreak + 1);
          cur.width = cur.units.reduce((s, x) => s + x.width, 0);
          pushLine();
          cur = { units: rest, width: rest.reduce((s, x) => s + x.width, 0), maxH: h, align, left: leftIndent };
        } else {
          pushLine();
          cur = { units: [], width: 0, maxH: h, align, left: leftIndent };
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
  }

  // vertical metrics
  const lineAdvance = (ln: Line) => (e.lineSpacingStyle === 2 ? h : ln.maxH) * spacing * (5 / 3);
  const blockWidth = Number.isFinite(refWidth) ? refWidth : Math.max(0, ...lines.map((l) => l.left + l.width));
  let y = -(lines[0]?.maxH ?? h);
  const baselines: number[] = [];
  lines.forEach((ln, i) => {
    if (i > 0) y -= lineAdvance(ln);
    baselines.push(y);
  });
  const totalH = -y;
  // anchor offsets: origin is the attachment point
  const ox = col === 0 ? 0 : col === 1 ? -blockWidth / 2 : -blockWidth;
  const oy = row === 0 ? 0 : row === 1 ? totalH / 2 : totalH;

  let minX = Infinity;
  let maxX = -Infinity;
  lines.forEach((ln, i) => {
    const base = baselines[i] + oy;
    const lineW = ln.width;
    let x = ox + ln.left;
    const free = blockWidth - ln.left - lineW;
    if (Number.isFinite(free)) {
      if (ln.align === 'c') x += free / 2;
      else if (ln.align === 'r') x += free;
    }
    for (const u of ln.units) {
      const it = u.item;
      if (it.kind === 'text' && u.kind !== 'space') {
        const font = styleFont(style, it.style);
        const size = sizeOf(it.style, font);
        const skew = Math.tan((it.style.oblique || 0) * DEG);
        layout.runs.push({ text: u.text, x, y: base, size, scaleX: it.style.widthFactor, skew, font, aci: it.style.aci, rgb: it.style.rgb });
        const met = measurer.metrics(font);
        if (it.style.underline) layout.lines.push(x, base - size * met.descent * 0.6, x + u.width, base - size * met.descent * 0.6);
        if (it.style.overline) layout.lines.push(x, base + it.style.height * 1.2, x + u.width, base + it.style.height * 1.2);
        if (it.style.strike) layout.lines.push(x, base + it.style.height / 2, x + u.width, base + it.style.height / 2);
      } else if (it.kind === 'text' && u.kind === 'space' && (it.style.underline || it.style.strike)) {
        if (it.style.underline) layout.lines.push(x, base - it.style.height * 0.25, x + u.width, base - it.style.height * 0.25);
      } else if (it.kind === 'stack') {
        const font = styleFont(style, it.style);
        const size = sizeOf(it.style, font) * 0.7;
        const sh = it.style.height;
        const wu = measureRun(measurer, it.upper, font, size, it.style.widthFactor);
        const wl = measureRun(measurer, it.lower, font, size, it.style.widthFactor);
        const center = it.type !== '^';
        const xu = center ? x + (u.width - wu) / 2 : x;
        const xl = center ? x + (u.width - wl) / 2 : x;
        const color = { aci: it.style.aci, rgb: it.style.rgb };
        if (it.type === '#') {
          layout.runs.push({ text: it.upper, x, y: base + sh * 0.45, size, scaleX: it.style.widthFactor, skew: 0, font, ...color });
          layout.runs.push({ text: it.lower, x: x + u.width - wl, y: base - sh * 0.05, size, scaleX: it.style.widthFactor, skew: 0, font, ...color });
          layout.lines.push(x + u.width * 0.2, base - sh * 0.1, x + u.width * 0.8, base + sh * 1.0);
        } else {
          layout.runs.push({ text: it.upper, x: xu, y: base + sh * 0.6, size, scaleX: it.style.widthFactor, skew: 0, font, ...color });
          layout.runs.push({ text: it.lower, x: xl, y: base - sh * 0.4, size, scaleX: it.style.widthFactor, skew: 0, font, ...color });
          if (it.type === '/') layout.lines.push(x, base + sh * 0.4, x + u.width, base + sh * 0.4);
        }
      }
      x += u.width;
    }
    if (ln.units.length) {
      minX = Math.min(minX, ox + ln.left);
      maxX = Math.max(maxX, x);
    }
  });
  if (!layout.runs.length && !layout.lines.length) return null;
  layout.minX = Number.isFinite(refWidth) ? ox : minX;
  layout.maxX = Number.isFinite(refWidth) ? ox + blockWidth : maxX;
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

  // orientation
  const z = norm3(e.extrusion ?? [0, 0, 1]);
  let xAxis: Vec3;
  if (e.xAxis && Math.hypot(e.xAxis[0], e.xAxis[1], e.xAxis[2]) > 1e-12) {
    const d = e.xAxis[0] * z[0] + e.xAxis[1] * z[1] + e.xAxis[2] * z[2];
    xAxis = norm3([e.xAxis[0] - d * z[0], e.xAxis[1] - d * z[1], e.xAxis[2] - d * z[2]]);
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
  const matrix = fromAxes(xAxis, yAxis, z, e.insert);
  return { layout, matrix };
}
