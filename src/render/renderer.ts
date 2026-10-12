import { aciToRgb, luminance } from '../dxf/colors';
import { affineInvert, affineMultiply, type Affine2 } from '../geom/matrix';
import { cssFont } from '../fonts/resolve';
import { strokeProvider } from '../fonts/strokeFont';
import type { HatchItem, ImageItem, Scene, TextItem, Tile } from '../scene/scene';
import type { Style } from '../scene/style';
import { REF_PX } from '../scene/textLayout';
import { viewLinear, type ViewState, type Viewport } from '../shared/view';

export type Ctx2D = OffscreenCanvasRenderingContext2D;

export interface RenderOptions {
  background: number;
  /** 'file' follows $LWDISPLAY */
  lineweights: 'file' | 'on' | 'off';
  lineweightScale: number;
  linetypes: boolean;
  fills: boolean;
  texts: boolean;
  /** hide texts smaller than this (CSS px) */
  minTextPx: number;
  monochrome: boolean;
  /** per scene layer: 1 visible, 0 hidden (after overrides) */
  layerOn: Uint8Array;
  layerFrozen: Uint8Array;
  pdmode: number;
  pdsize: number;
  lwdisplay: boolean;
}

/** Options for drawing into part of the canvas (paper space viewports). */
export interface RenderExtra {
  /** clear the canvas with the background color (default true) */
  clear?: boolean;
  /** device px where the view center maps (default: canvas center) */
  origin?: [number, number];
  /** device px area that is visible (for culling) */
  rect?: Box;
  /** additional frozen layers (viewport freeze) */
  extraFrozen?: Uint8Array;
}

export interface RenderStats {
  tiles: number;
  batches: number;
  texts: number;
  ms: number;
}

const cssCache = new Map<number, string>();
function css(rgb: number): string {
  let s = cssCache.get(rgb);
  if (!s) {
    s = '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
    cssCache.set(rgb, s);
  }
  return s;
}

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

function intersects(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

const strokePathCache = new Map<string, Path2D>();
let pathFactory: () => Path2D = () => new Path2D();

/** Use another Path2D implementation (SVG export); null restores the native one. */
export function setPathFactory(f: (() => Path2D) | null): void {
  pathFactory = f ?? (() => new Path2D());
  strokePathCache.clear();
}

/** Path of a whole string in a stroke font (glyph units, y down). */
function strokeTextPath(font: string, text: string): Path2D {
  const key = font + '\u0000' + text;
  let p = strokePathCache.get(key);
  if (p) return p;
  p = pathFactory();
  const sp = strokeProvider(font);
  if (!sp) return p;
  let x = 0;
  for (const ch of text) {
    for (const poly of sp.glyph(ch)) {
      if (poly.length < 2) continue;
      p.moveTo(x + poly[0], poly[1]);
      if (poly.length === 2) p.lineTo(x + poly[0] + 0.01, poly[1]);
      for (let i = 2; i < poly.length; i += 2) p.lineTo(x + poly[i], poly[i + 1]);
    }
    x += sp.advance(ch);
  }
  if (strokePathCache.size > 50_000) strokePathCache.clear();
  strokePathCache.set(key, p);
  return p;
}

/** Inline MTEXT color (\c / \C); 0 = BYBLOCK and 256 = BYLAYER use the entity color. */
function runColor(rgb: number | undefined, aci: number | undefined, entity: string, fg: number): string {
  if (rgb !== undefined) return css(rgb);
  if (aci === undefined || aci === 0 || aci === 256) return entity;
  return aci === 7 ? css(fg) : css(aciToRgb(aci));
}

/** Scale of an affine (device px per unit). */
function affScale(m: Affine2): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

interface Frame {
  ctx: Ctx2D;
  opts: RenderOptions;
  fg: number;
  dpr: number;
  W: number;
  H: number;
  scaleDev: number;
  vb: Box;
  view: ViewState;
  lin: [number, number, number, number];
  chainVis: Uint8Array;
  stats: RenderStats;
  font: string;
  ox: number;
  oy: number;
  frozen: Uint8Array;
}

export class Renderer {
  constructor(private scene: Scene) {}

  private visible(f: Frame, st: Style): boolean {
    return f.opts.layerOn[st.layer] === 1 && f.frozen[st.layer] === 0 && f.chainVis[st.chain] === 1;
  }

  private colorOf(f: Frame, st: Style): string {
    if (f.opts.monochrome || st.fg) return css(f.fg);
    return css(st.rgb);
  }

  private chainVisible(frozen: Uint8Array): Uint8Array {
    const chains = this.scene.styles.chains;
    const vis = new Uint8Array(chains.length);
    for (let i = 0; i < chains.length; i++) vis[i] = chains[i].every((l) => !frozen[l]) ? 1 : 0;
    return vis;
  }

  private dash(st: Style, scaleDev: number): number[] | null {
    if (st.lt < 0) return null;
    const lt = this.scene.styles.linetypes[st.lt];
    if (!lt) return null;
    const total = lt.pattern.reduce((s, v) => s + Math.abs(v), 0) * st.lts;
    if (total * scaleDev < 4) return null; // pattern smaller than a few pixels → solid
    const dot = 1 / scaleDev;
    const seq: { len: number; dash: boolean }[] = [];
    for (const v of lt.pattern) {
      const len = v === 0 ? dot : Math.abs(v) * st.lts;
      const isDash = v >= 0;
      const last = seq[seq.length - 1];
      if (last && last.dash === isDash) last.len += len;
      else seq.push({ len, dash: isDash });
    }
    if (!seq.length) return null;
    if (!seq[0].dash) seq.unshift({ len: 0, dash: true });
    const arr = seq.map((s) => s.len);
    if (arr.length % 2 === 1) arr.push(0);
    return arr;
  }

  private lwOn(opts: RenderOptions): boolean {
    return opts.lineweights === 'on' || (opts.lineweights === 'file' && opts.lwdisplay);
  }

  private lineWidthPx(f: Frame, st: Style): number {
    if (!this.lwOn(f.opts)) return f.dpr;
    // 0.25 mm ≈ 1 CSS px, like AutoCAD's model-space lineweight display
    return Math.max(1, (st.lw / 25) * f.opts.lineweightScale) * f.dpr;
  }

  private tileTransform(f: Frame, t: Tile): Affine2 {
    const [a, b, c, d] = f.lin;
    const dx = t.ox - f.view.cx;
    const dy = t.oy - f.view.cy;
    return [a * f.dpr, b * f.dpr, c * f.dpr, d * f.dpr, f.ox + (a * dx + c * dy) * f.dpr, f.oy + (b * dx + d * dy) * f.dpr];
  }

  render(ctx: Ctx2D, view: ViewState, vp: Viewport, opts: RenderOptions, extra: RenderExtra = {}): RenderStats {
    const t0 = performance.now();
    const dpr = vp.dpr;
    const W = vp.width * dpr;
    const H = vp.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (extra.clear !== false) {
      ctx.fillStyle = css(opts.background);
      ctx.fillRect(0, 0, W, H);
    }
    const [ox, oy] = extra.origin ?? [W / 2, H / 2];
    let frozen = opts.layerFrozen;
    if (extra.extraFrozen) {
      frozen = new Uint8Array(Math.max(frozen.length, extra.extraFrozen.length));
      for (let i = 0; i < frozen.length; i++) frozen[i] = (opts.layerFrozen[i] || extra.extraFrozen[i]) ? 1 : 0;
    }
    const lin = viewLinear(view);
    const rect = extra.rect ?? { minX: 0, minY: 0, maxX: W, maxY: H };
    // visible world box: invert the device mapping at the rect corners
    const det = lin[0] * lin[3] - lin[1] * lin[2];
    const corners = [
      [rect.minX, rect.minY],
      [rect.maxX, rect.minY],
      [rect.minX, rect.maxY],
      [rect.maxX, rect.maxY],
    ].map(([x, y]) => {
      const X = (x - ox) / dpr;
      const Y = (y - oy) / dpr;
      return [view.cx + (lin[3] * X - lin[2] * Y) / det, view.cy + (-lin[1] * X + lin[0] * Y) / det];
    });
    const vb = {
      minX: Math.min(...corners.map((p) => p[0])),
      maxX: Math.max(...corners.map((p) => p[0])),
      minY: Math.min(...corners.map((p) => p[1])),
      maxY: Math.max(...corners.map((p) => p[1])),
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const f: Frame = {
      ctx,
      opts,
      fg: luminance(opts.background) < 0.5 ? 0xffffff : 0x000000,
      dpr,
      W,
      H,
      scaleDev: view.scale * dpr,
      vb,
      view,
      lin,
      chainVis: this.chainVisible(frozen),
      stats: { tiles: 0, batches: 0, texts: 0, ms: 0 },
      font: '',
      ox,
      oy,
      frozen,
    };
    const tiles = this.scene.tileList.filter((t) => t.count > 0 && intersects(t.bbox, f.vb));
    f.stats.tiles = tiles.length;

    if (this.scene.strict) {
      for (const t of tiles) this.withClip(f, t, () => this.drawAll(f, t));
      this.drawInfinite(f);
    } else {
      const pass = (fn: (t: Tile) => void) => {
        for (const t of tiles) this.withClip(f, t, () => fn(t));
      };
      pass((t) => this.drawImages(f, t));
      if (opts.fills) pass((t) => this.drawFills(f, t));
      pass((t) => this.drawStrokes(f, t));
      this.drawInfinite(f);
      pass((t) => this.drawPoints(f, t));
      if (opts.texts) pass((t) => this.drawTexts(f, t));
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    f.stats.ms = performance.now() - t0;
    return f.stats;
  }

  private withClip(f: Frame, t: Tile, draw: () => void): void {
    if (!t.clip) {
      draw();
      return;
    }
    const m = this.tileTransform(f, t);
    f.ctx.save();
    f.ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    f.ctx.clip(t.clip as Path2D);
    draw();
    f.ctx.restore();
    f.font = '';
  }

  private drawAll(f: Frame, t: Tile): void {
    this.drawImages(f, t);
    if (f.opts.fills) this.drawFills(f, t);
    this.drawStrokes(f, t);
    this.drawPoints(f, t);
    if (f.opts.texts) this.drawTexts(f, t);
  }

  // ---------- fills & hatches ----------
  private drawFills(f: Frame, t: Tile): void {
    const { ctx } = f;
    for (const h of t.hatches) {
      if (!this.visible(f, h.style) || !intersects(h.bbox, f.vb)) continue;
      this.drawHatch(f, t, h);
    }
    let set = false;
    for (const batch of t.batchList) {
      if (!batch.fills.length || !this.visible(f, batch.style)) continue;
      if (!set) {
        const m = this.tileTransform(f, t);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        set = true;
      }
      ctx.globalAlpha = batch.style.alpha;
      ctx.fillStyle = this.colorOf(f, batch.style);
      for (const p of batch.fills) ctx.fill(p as Path2D, 'evenodd');
    }
  }

  private drawHatch(f: Frame, t: Tile, h: HatchItem): void {
    const { ctx } = f;
    const base = affineMultiply(this.tileTransform(f, t), h.m);
    ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
    ctx.globalAlpha = h.style.alpha;
    const color = h.solidColor !== undefined && !f.opts.monochrome ? css(h.solidColor) : this.colorOf(f, h.style);
    const path = h.path as Path2D;
    if (h.gradient && !f.opts.monochrome) {
      ctx.fillStyle = this.gradient(ctx, h);
      ctx.fill(path, h.fillRule);
    } else if (h.solid || h.gradient) {
      ctx.fillStyle = color;
      ctx.fill(path, h.fillRule);
    } else {
      this.drawPattern(f, h, base, color, path);
    }
    if (h.outline) {
      ctx.strokeStyle = color;
      ctx.lineWidth = f.dpr / affScale(base);
      ctx.setLineDash([]);
      ctx.stroke(path);
    }
  }

  private gradient(ctx: Ctx2D, h: HatchItem): CanvasGradient {
    const g = h.gradient!;
    const L = h.local;
    const cx = (L.minX + L.maxX) / 2;
    const cy = (L.minY + L.maxY) / 2;
    const w = L.maxX - L.minX;
    const hh = L.maxY - L.minY;
    const dx = Math.cos(g.angle);
    const dy = Math.sin(g.angle);
    const half = (Math.abs(w * dx) + Math.abs(hh * dy)) / 2 || 1;
    const shift = Math.max(-1, Math.min(1, g.shift || 0));
    const name = g.name.replace(/^INV/, '');
    const inv = g.name.startsWith('INV');
    const a = css(inv ? g.c2 : g.c1);
    const b = css(inv ? g.c1 : g.c2);
    if (name === 'SPHERICAL' || name === 'HEMISPHERICAL' || name === 'CURVED') {
      const r = Math.hypot(w, hh) / 2 || 1;
      const k = name === 'HEMISPHERICAL' ? -1 : name === 'CURVED' ? -2 : shift;
      const ox = cx + dx * half * k;
      const oy = cy + dy * half * k;
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, name === 'CURVED' ? r * 3 : r);
      grad.addColorStop(0, b);
      grad.addColorStop(1, a);
      return grad;
    }
    const grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    if (name === 'CYLINDER') {
      grad.addColorStop(0, a);
      grad.addColorStop(Math.max(0, Math.min(1, 0.5 + shift / 2)), b);
      grad.addColorStop(1, a);
    } else {
      grad.addColorStop(0, a);
      grad.addColorStop(1, b);
    }
    return grad;
  }

  private drawPattern(f: Frame, h: HatchItem, base: Affine2, color: string, path: Path2D): void {
    const { ctx } = f;
    const s = affScale(base);
    // visible region in hatch-local coordinates
    const inv = affineInvert(base);
    if (!inv) return;
    const screen = [
      [0, 0],
      [f.W, 0],
      [0, f.H],
      [f.W, f.H],
    ].map(([x, y]) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]);
    const vr = {
      minX: Math.max(h.local.minX, Math.min(...screen.map((p) => p[0]))),
      maxX: Math.min(h.local.maxX, Math.max(...screen.map((p) => p[0]))),
      minY: Math.max(h.local.minY, Math.min(...screen.map((p) => p[1]))),
      maxY: Math.min(h.local.maxY, Math.max(...screen.map((p) => p[1]))),
    };
    if (vr.minX > vr.maxX || vr.minY > vr.maxY) return;
    const corners = [
      [vr.minX, vr.minY],
      [vr.maxX, vr.minY],
      [vr.minX, vr.maxY],
      [vr.maxX, vr.maxY],
    ];
    const dense =
      !h.lines.length ||
      h.lines.some((l) => {
        const a = (l.angle * Math.PI) / 180;
        const spacing = Math.abs(-Math.sin(a) * l.offsetX + Math.cos(a) * l.offsetY);
        return spacing * s < 2;
      });
    if (dense) {
      // pattern finer than ~2 px: show a light tint instead of a moiré
      ctx.globalAlpha = h.style.alpha * 0.35;
      ctx.fillStyle = color;
      ctx.fill(path, h.fillRule);
      ctx.globalAlpha = h.style.alpha;
      return;
    }
    ctx.save();
    ctx.clip(path, h.fillRule);
    ctx.strokeStyle = color;
    ctx.lineWidth = f.dpr / s;
    ctx.lineCap = 'butt';
    for (const l of h.lines) {
      const a = (l.angle * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const nx = -dy;
      const ny = dx;
      const on = l.offsetX * nx + l.offsetY * ny;
      if (Math.abs(on) < 1e-12) continue;
      const ks = corners.map(([x, y]) => ((x - l.baseX) * nx + (y - l.baseY) * ny) / on);
      const k0 = Math.floor(Math.min(...ks));
      const k1 = Math.ceil(Math.max(...ks));
      if (k1 - k0 > 6000) continue;
      const total = l.dashes.reduce((acc, v) => acc + Math.abs(v), 0);
      const useDash = l.dashes.length > 0 && total * s >= 3;
      let dashArr: number[] = [];
      if (useDash) {
        const dot = 1 / s;
        if (l.dashes[0] < 0) dashArr.push(0);
        for (const v of l.dashes) dashArr.push(v === 0 ? dot : Math.abs(v));
        if (dashArr.length % 2 === 1) dashArr.push(0);
      }
      ctx.setLineDash(useDash ? dashArr : []);
      if (!useDash) ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const qx = l.baseX + k * l.offsetX;
        const qy = l.baseY + k * l.offsetY;
        const ts = corners.map(([x, y]) => (x - qx) * dx + (y - qy) * dy);
        const tmin = Math.min(...ts);
        const tmax = Math.max(...ts);
        if (useDash) {
          // keep the dash phase anchored at the line's base point
          ctx.lineDashOffset = ((tmin % total) + total) % total;
          ctx.beginPath();
          ctx.moveTo(qx + dx * tmin, qy + dy * tmin);
          ctx.lineTo(qx + dx * tmax, qy + dy * tmax);
          ctx.stroke();
        } else {
          ctx.moveTo(qx + dx * tmin, qy + dy * tmin);
          ctx.lineTo(qx + dx * tmax, qy + dy * tmax);
        }
      }
      if (!useDash) ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.restore();
  }

  // ---------- strokes ----------
  private drawStrokes(f: Frame, t: Tile): void {
    const { ctx } = f;
    let set = false;
    for (const batch of t.batchList) {
      if (!this.visible(f, batch.style)) continue;
      const st = batch.style;
      if (!set) {
        const m = this.tileTransform(f, t);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        set = true;
      }
      const color = this.colorOf(f, st);
      ctx.globalAlpha = st.alpha;
      if (!f.opts.fills && batch.fills.length) {
        ctx.strokeStyle = color;
        ctx.lineWidth = f.dpr / f.scaleDev;
        ctx.setLineDash([]);
        for (const p of batch.fills) ctx.stroke(p as Path2D);
      }
      if (!batch.stroke) continue;
      f.stats.batches++;
      ctx.strokeStyle = color;
      ctx.lineWidth = this.lineWidthPx(f, st) / f.scaleDev;
      const dash = f.opts.linetypes ? this.dash(st, f.scaleDev) : null;
      ctx.setLineDash(dash ?? []);
      ctx.stroke(batch.stroke as Path2D);
    }
    ctx.setLineDash([]);
  }

  // ---------- images, wipeouts, frames ----------
  private drawImages(f: Frame, t: Tile): void {
    if (!t.images.length) return;
    const m = this.tileTransform(f, t);
    for (const im of t.images) {
      if (!this.visible(f, im.style) || !intersects(im.bbox, f.vb)) continue;
      this.drawImage(f, im, m);
    }
  }

  private drawImage(f: Frame, im: ImageItem, m: Affine2): void {
    const { ctx } = f;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const poly = (pts: number[]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
    };
    ctx.globalAlpha = im.style.alpha;
    if (im.wipeout) {
      poly(im.clip ?? im.corners);
      ctx.fillStyle = css(f.opts.background);
      ctx.fill();
      return;
    }
    const color = this.colorOf(f, im.style);
    ctx.strokeStyle = color;
    ctx.lineWidth = f.dpr / f.scaleDev;
    ctx.setLineDash([]);
    poly(im.clip ?? im.corners);
    ctx.stroke();
    // placeholder cross + file name (raster data is not embedded in DXF)
    const c = im.corners;
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    ctx.lineTo(c[4], c[5]);
    ctx.moveTo(c[2], c[3]);
    ctx.lineTo(c[6], c[7]);
    ctx.globalAlpha = im.style.alpha * 0.35;
    ctx.stroke();
    ctx.globalAlpha = im.style.alpha;
    if (im.label) {
      const x = m[0] * c[6] + m[2] * c[7] + m[4];
      const y = m[1] * c[6] + m[3] * c[7] + m[5];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `${12 * f.dpr}px sans-serif`;
      f.font = '';
      ctx.fillStyle = color;
      ctx.fillText(im.label, x + 4 * f.dpr, y + 14 * f.dpr);
    }
  }

  // ---------- infinite lines ----------
  private drawInfinite(f: Frame): void {
    const items = this.scene.infinite;
    if (!items.length) return;
    const { ctx, vb } = f;
    const [a, b, c, d] = f.lin;
    const toDev = (x: number, y: number): [number, number] => {
      const dx = x - f.view.cx;
      const dy = y - f.view.cy;
      return [f.ox + (a * dx + c * dy) * f.dpr, f.oy + (b * dx + d * dy) * f.dpr];
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    for (const it of items) {
      if (!this.visible(f, it.style)) continue;
      // clip the parametric line to the view box (Liang–Barsky)
      let t0 = it.ray ? 0 : -Infinity;
      let t1 = Infinity;
      const clip = (p: number, q: number) => {
        if (Math.abs(p) < 1e-15) return q >= 0;
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
        return true;
      };
      if (!clip(-it.dx, it.x - vb.minX) || !clip(it.dx, vb.maxX - it.x) || !clip(-it.dy, it.y - vb.minY) || !clip(it.dy, vb.maxY - it.y)) continue;
      if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 > t1) continue;
      const p0 = toDev(it.x + it.dx * t0, it.y + it.dy * t0);
      const p1 = toDev(it.x + it.dx * t1, it.y + it.dy * t1);
      ctx.globalAlpha = it.style.alpha;
      ctx.strokeStyle = this.colorOf(f, it.style);
      ctx.lineWidth = this.lineWidthPx(f, it.style);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
  }

  // ---------- points ----------
  private drawPoints(f: Frame, t: Tile): void {
    if (!t.points.length) return;
    const { ctx, opts } = f;
    const mode = opts.pdmode | 0;
    const base = mode & 7;
    if (base === 1 && !(mode & 96)) return;
    let sizeDev: number;
    if (opts.pdsize > 0) sizeDev = opts.pdsize * f.scaleDev;
    else if (opts.pdsize < 0) sizeDev = (-opts.pdsize / 100) * f.H;
    else sizeDev = 0.05 * f.H;
    sizeDev = Math.max(2, Math.min(sizeDev, 200));
    const m = this.tileTransform(f, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    for (const p of t.points) {
      if (!this.visible(f, p.style)) continue;
      const x = m[0] * p.x + m[2] * p.y + m[4];
      const y = m[1] * p.x + m[3] * p.y + m[5];
      ctx.globalAlpha = p.style.alpha;
      ctx.strokeStyle = ctx.fillStyle = this.colorOf(f, p.style);
      ctx.lineWidth = f.dpr;
      const r = sizeDev / 2;
      ctx.beginPath();
      if (base === 0) ctx.fillRect(Math.round(x) - f.dpr, Math.round(y) - f.dpr, 2 * f.dpr, 2 * f.dpr);
      else if (base === 2) {
        ctx.moveTo(x - r, y);
        ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y + r);
      } else if (base === 3) {
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.moveTo(x - r, y + r);
        ctx.lineTo(x + r, y - r);
      } else if (base === 4) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - r);
      }
      if (mode & 32) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      if (mode & 64) ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.stroke();
    }
  }

  // ---------- text ----------
  private drawTexts(f: Frame, t: Tile): void {
    if (!t.texts.length) return;
    const tm = this.tileTransform(f, t);
    for (const item of t.texts) {
      if (!this.visible(f, item.style) || !intersects(item.bbox, f.vb)) continue;
      const px = item.layout.height * item.scale * f.scaleDev;
      if (px < f.opts.minTextPx * f.dpr) continue;
      f.stats.texts++;
      this.drawText(f, item, tm);
    }
  }

  private drawText(f: Frame, item: TextItem, tm: Affine2): void {
    const { ctx } = f;
    const L = item.layout;
    const base = affineMultiply(tm, item.m);
    const color = this.colorOf(f, item.style);
    ctx.globalAlpha = item.style.alpha;
    if (L.background) {
      ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
      const bg = L.background;
      ctx.fillStyle = bg.useBackground || (bg.rgb === undefined && bg.aci === undefined) ? css(f.opts.background) : bg.rgb !== undefined ? css(bg.rgb) : css(aciToRgb(bg.aci!));
      ctx.fillRect(bg.minX, bg.minY, bg.maxX - bg.minX, bg.maxY - bg.minY);
    }
    for (const run of L.runs) {
      if (run.mode === 'stroke') {
        const sp = strokeProvider(run.stroke ?? run.font.stroke ?? '');
        if (!sp) continue;
        const k = run.size / sp.cap;
        const m = affineMultiply(base, [k * run.scaleX, 0, -k * run.skew, -k, run.x + sp.baseline * k * run.skew, run.y + sp.baseline * k]);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.strokeStyle = f.opts.monochrome ? color : runColor(run.rgb, run.aci, color, f.fg);
        const lw = this.lwOn(f.opts) ? Math.max(1, (item.style.lw / 25) * f.opts.lineweightScale) * f.dpr : f.dpr;
        ctx.lineWidth = lw / affScale(m);
        ctx.setLineDash([]);
        ctx.stroke(strokeTextPath(run.stroke ?? run.font.stroke ?? '', run.text));
        continue;
      }
      const k = run.size / REF_PX;
      // glyph space (y down) → local (y up)
      const m = affineMultiply(base, [k * run.scaleX, 0, -k * run.skew, -k, run.x, run.y]);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      const font = cssFont(run.font, REF_PX);
      if (font !== f.font) {
        ctx.font = font;
        f.font = font;
      }
      ctx.fillStyle = f.opts.monochrome ? color : runColor(run.rgb, run.aci, color, f.fg);
      ctx.fillText(run.text, 0, 0);
    }
    if (L.lines.length) {
      ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
      ctx.strokeStyle = color;
      ctx.lineWidth = f.dpr / affScale(base);
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < L.lines.length; i += 4) {
        ctx.moveTo(L.lines[i], L.lines[i + 1]);
        ctx.lineTo(L.lines[i + 2], L.lines[i + 3]);
      }
      ctx.stroke();
    }
  }
}
