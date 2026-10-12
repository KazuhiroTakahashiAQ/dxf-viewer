/**
 * Minimal recording implementations of Path2D and CanvasRenderingContext2D
 * that serialize to SVG. The renderer draws into it exactly as into a canvas,
 * so the SVG export matches the screen. Only the API used by the renderer is
 * implemented. All strings are XML-escaped.
 */

type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function mul(m: Affine, n: Affine): Affine {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e4) / 1e4) : '0');

/** Path recorder (commands in local coordinates; arcs converted to cubic Béziers). */
export class SvgPath {
  d: string[] = [];
  private open = false;

  moveTo(x: number, y: number): void {
    this.d.push(`M${num(x)} ${num(y)}`);
    this.open = true;
  }
  lineTo(x: number, y: number): void {
    if (!this.open) return this.moveTo(x, y);
    this.d.push(`L${num(x)} ${num(y)}`);
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!this.open) this.moveTo(x1, y1);
    this.d.push(`C${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)}`);
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    if (!this.open) this.moveTo(x1, y1);
    this.d.push(`Q${num(x1)} ${num(y1)} ${num(x)} ${num(y)}`);
  }
  closePath(): void {
    if (!this.open) return;
    this.d.push('Z');
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.ellipse(x, y, r, r, 0, a0, a1, ccw);
  }
  /** Canvas ellipse semantics (sweep normalisation as in the HTML spec). */
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    const TAU = Math.PI * 2;
    let sweep = a1 - a0;
    if (!ccw) {
      if (sweep >= TAU) sweep = TAU;
      else {
        sweep %= TAU;
        if (sweep < 0) sweep += TAU;
      }
    } else if (-sweep >= TAU) sweep = -TAU;
    else {
      sweep %= TAU;
      if (sweep > 0) sweep -= TAU;
    }
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const pt = (t: number): [number, number] => {
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      return [x + ex * cr - ey * sr, y + ex * sr + ey * cr];
    };
    const d = (t: number): [number, number] => {
      const ex = -rx * Math.sin(t);
      const ey = ry * Math.cos(t);
      return [ex * cr - ey * sr, ex * sr + ey * cr];
    };
    const [px, py] = pt(a0);
    if (this.open) this.lineTo(px, py);
    else this.moveTo(px, py);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const h = sweep / n;
    const k = (4 / 3) * Math.tan(h / 4);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + h * i;
      const t1 = t0 + h;
      const p0 = pt(t0);
      const p1 = pt(t1);
      const d0 = d(t0);
      const d1 = d(t1);
      this.bezierCurveTo(p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]);
    }
  }
  addPath(p: SvgPath): void {
    this.d.push(...p.d);
  }
  toString(): string {
    return this.d.join('');
  }
}

interface Gradient {
  kind: 'linear' | 'radial';
  coords: number[];
  stops: [number, string][];
  addColorStop(o: number, c: string): void;
}

interface State {
  m: Affine;
  fillStyle: string | Gradient;
  strokeStyle: string | Gradient;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  dash: number[];
  dashOffset: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  clip: string | null;
}

/** Records drawing calls as SVG elements. */
export class SvgContext {
  private out: string[] = [];
  private defs: string[] = [];
  private stack: State[] = [];
  private s: State = { m: IDENTITY, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1, dash: [], dashOffset: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', clip: null };
  private path = new SvgPath();
  private ids = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  // --- state ---
  save(): void {
    this.stack.push({ ...this.s, dash: [...this.s.dash] });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) this.s = s;
  }
  setTransform(a: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (typeof a === 'object') this.s.m = [a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0];
    else this.s.m = [a, b!, c!, d!, e!, f!];
  }
  resetTransform(): void {
    this.s.m = IDENTITY;
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.s.m = mul(this.s.m, [a, b, c, d, e, f]);
  }
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }
  rotate(a: number): void {
    this.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0);
  }
  getTransform(): DOMMatrix {
    const [a, b, c, d, e, f] = this.s.m;
    return { a, b, c, d, e, f } as DOMMatrix;
  }
  set fillStyle(v: string | Gradient) {
    this.s.fillStyle = v;
  }
  get fillStyle(): string | Gradient {
    return this.s.fillStyle;
  }
  set strokeStyle(v: string | Gradient) {
    this.s.strokeStyle = v;
  }
  get strokeStyle(): string | Gradient {
    return this.s.strokeStyle;
  }
  set lineWidth(v: number) {
    this.s.lineWidth = v;
  }
  get lineWidth(): number {
    return this.s.lineWidth;
  }
  set lineCap(v: string) {
    this.s.lineCap = v;
  }
  set lineJoin(v: string) {
    this.s.lineJoin = v;
  }
  set globalAlpha(v: number) {
    this.s.globalAlpha = v;
  }
  get globalAlpha(): number {
    return this.s.globalAlpha;
  }
  set lineDashOffset(v: number) {
    this.s.dashOffset = v;
  }
  set font(v: string) {
    this.s.font = v;
  }
  get font(): string {
    return this.s.font;
  }
  set textAlign(v: string) {
    this.s.textAlign = v;
  }
  set textBaseline(v: string) {
    this.s.textBaseline = v;
  }
  setLineDash(d: number[]): void {
    this.s.dash = [...d];
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient {
    const g: Gradient = { kind: 'linear', coords: [x0, y0, x1, y1], stops: [], addColorStop: (o, c) => g.stops.push([o, c]) };
    return g;
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient {
    const g: Gradient = { kind: 'radial', coords: [x0, y0, r0, x1, y1, r1], stops: [], addColorStop: (o, c) => g.stops.push([o, c]) };
    return g;
  }
  measureText(text: string): TextMetrics {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.s.font)?.[1] ?? '10');
    return { width: text.length * size * 0.6 } as TextMetrics;
  }

  // --- direct path ---
  beginPath(): void {
    this.path = new SvgPath();
  }
  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.path.bezierCurveTo(a, b, c, d, e, f);
  }
  quadraticCurveTo(a: number, b: number, c: number, d: number): void {
    this.path.quadraticCurveTo(a, b, c, d);
  }
  closePath(): void {
    this.path.closePath();
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.rect(x, y, w, h);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void {
    this.path.arc(x, y, r, a0, a1, ccw);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void {
    this.path.ellipse(x, y, rx, ry, rot, a0, a1, ccw);
  }

  // --- painting ---
  private paint(style: string | Gradient): string {
    if (typeof style === 'string') return xmlEscape(style);
    const id = `g${++this.ids}`;
    const stops = style.stops.map(([o, c]) => `<stop offset="${num(o)}" stop-color="${xmlEscape(c)}"/>`).join('');
    const c = style.coords.map(num);
    if (style.kind === 'linear') this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}">${stops}</linearGradient>`);
    else this.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" fx="${c[0]}" fy="${c[1]}" cx="${c[3]}" cy="${c[4]}" r="${c[5]}">${stops}</radialGradient>`);
    return `url(#${id})`;
  }
  private common(): string {
    const m = this.s.m;
    let a = m === IDENTITY || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) ? '' : ` transform="matrix(${m.map(num).join(' ')})"`;
    if (this.s.globalAlpha < 1) a += ` opacity="${num(this.s.globalAlpha)}"`;
    return a;
  }
  /**
   * Clip paths are recorded in device space, so a clipped element is wrapped in an
   * untransformed group (a clip-path on the element itself would be interpreted
   * in the element's transformed user space).
   */
  private emit(el: string): void {
    this.out.push(this.s.clip ? `<g clip-path="url(#${this.s.clip})">${el}</g>` : el);
  }
  stroke(p?: SvgPath | Path2D): void {
    const d = String((p as unknown as SvgPath) ?? this.path);
    if (!d) return;
    const dash = this.s.dash.length && this.s.dash.some((v) => v > 0) ? ` stroke-dasharray="${this.s.dash.map(num).join(' ')}" stroke-dashoffset="${num(this.s.dashOffset)}"` : '';
    this.emit(`<path d="${d}" fill="none" stroke="${this.paint(this.s.strokeStyle)}" stroke-width="${num(this.s.lineWidth)}" stroke-linecap="${this.s.lineCap}" stroke-linejoin="${this.s.lineJoin}"${dash}${this.common()}/>`);
  }
  fill(p?: SvgPath | Path2D | CanvasFillRule, rule?: CanvasFillRule): void {
    let path = this.path;
    if (typeof p === 'string') rule = p;
    else if (p) path = p as unknown as SvgPath;
    const d = String(path);
    if (!d) return;
    this.emit(`<path d="${d}" fill="${this.paint(this.s.fillStyle)}"${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${this.common()}/>`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const p = new SvgPath();
    p.rect(x, y, w, h);
    this.fill(p);
  }
  clearRect(): void {
    /* background is drawn explicitly by the renderer */
  }
  clip(p?: SvgPath | Path2D | CanvasFillRule, rule?: CanvasFillRule): void {
    let path = this.path;
    if (typeof p === 'string') rule = p;
    else if (p) path = p as unknown as SvgPath;
    const id = `c${++this.ids}`;
    const m = this.s.m;
    // nested clips: the new clip path is itself clipped by the current one
    const parent = this.s.clip ? ` clip-path="url(#${this.s.clip})"` : '';
    this.defs.push(`<clipPath id="${id}"${parent}><path d="${String(path)}" transform="matrix(${m.map(num).join(' ')})"${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    this.s.clip = id;
  }
  fillText(text: string, x: number, y: number): void {
    const anchor = this.s.textAlign === 'center' ? 'middle' : this.s.textAlign === 'right' || this.s.textAlign === 'end' ? 'end' : 'start';
    const baseline = this.s.textBaseline === 'middle' ? 'middle' : this.s.textBaseline === 'top' || this.s.textBaseline === 'hanging' ? 'hanging' : this.s.textBaseline === 'bottom' ? 'text-after-edge' : 'alphabetic';
    this.emit(
      `<text x="${num(x)}" y="${num(y)}" fill="${this.paint(this.s.fillStyle)}" style="font: ${xmlEscape(this.s.font)}; white-space: pre" text-anchor="${anchor}" dominant-baseline="${baseline}"${this.common()}>${xmlEscape(text)}</text>`,
    );
  }
  strokeText(): void {
    /* not used by the renderer */
  }
  drawImage(): void {
    /* raster images are not embedded in SVG exports */
  }

  toSvg(title: string): string {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${num(this.width)}" height="${num(this.height)}" viewBox="0 0 ${num(this.width)} ${num(this.height)}">`,
      `<title>${xmlEscape(title)}</title>`,
      this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '',
      ...this.out,
      '</svg>',
    ].join('\n');
  }
}
