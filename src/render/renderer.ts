import { aciToRgb, luminance } from '../dxf/colors';
import { affineMultiply, type Affine2 } from '../geom/matrix';
import { cssFont } from '../fonts/resolve';
import { strokeProvider } from '../fonts/strokeFont';
import type { Scene, Tile } from '../scene/scene';
import type { Style } from '../scene/style';
import { REF_PX } from '../scene/textLayout';
import { viewLinear, visibleWorldBBox, type ViewState, type Viewport } from '../shared/view';

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

function intersects(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export class Renderer {
  private dpr = 1;

  constructor(private scene: Scene) {}

  private fgColor(opts: RenderOptions): number {
    return luminance(opts.background) < 0.5 ? 0xffffff : 0x000000;
  }

  private colorOf(st: Style, opts: RenderOptions, fg: number): string {
    if (opts.monochrome || st.fg) return css(fg);
    return css(st.rgb);
  }

  private chainVisible(opts: RenderOptions): Uint8Array {
    const chains = this.scene.styles.chains;
    const vis = new Uint8Array(chains.length);
    for (let i = 0; i < chains.length; i++) {
      vis[i] = chains[i].every((l) => !opts.layerFrozen[l]) ? 1 : 0;
    }
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

  /** stroke-font line width in device px */
  private textStrokePx(st: Style, opts: RenderOptions): number {
    const on = opts.lineweights === 'on' || (opts.lineweights === 'file' && opts.lwdisplay);
    return on ? Math.max(1, (st.lw / 25) * opts.lineweightScale) * this.dpr : this.dpr;
  }

  private lineWidthPx(st: Style, opts: RenderOptions, dpr: number): number {
    const on = opts.lineweights === 'on' || (opts.lineweights === 'file' && opts.lwdisplay);
    if (!on) return dpr;
    // 0.25 mm ≈ 1 CSS px, like AutoCAD's model-space lineweight display
    return Math.max(1, (st.lw / 25) * opts.lineweightScale) * dpr;
  }

  render(ctx: Ctx2D, view: ViewState, vp: Viewport, opts: RenderOptions): RenderStats {
    const t0 = performance.now();
    const dpr = vp.dpr;
    this.dpr = dpr;
    const W = vp.width * dpr;
    const H = vp.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(opts.background);
    ctx.fillRect(0, 0, W, H);
    const fg = this.fgColor(opts);
    const vb = visibleWorldBBox(view, vp);
    const [a0, b0, c0, d0] = viewLinear(view);
    const a = a0 * dpr;
    const b = b0 * dpr;
    const c = c0 * dpr;
    const d = d0 * dpr;
    const scaleDev = view.scale * dpr;
    const chainVis = this.chainVisible(opts);
    const tiles = this.scene.tileList.filter((t) => intersects(t.bbox, vb));
    const stats: RenderStats = { tiles: tiles.length, batches: 0, texts: 0, ms: 0 };
    const visible = (st: Style) => opts.layerOn[st.layer] === 1 && opts.layerFrozen[st.layer] === 0 && chainVis[st.chain] === 1;
    const tileTransform = (t: Tile): Affine2 => {
      const dx = t.ox - view.cx;
      const dy = t.oy - view.cy;
      return [a, b, c, d, W / 2 + a * dx + c * dy, H / 2 + b * dx + d * dy];
    };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // pass 1: fills
    if (opts.fills) {
      for (const t of tiles) {
        const m = tileTransform(t);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        for (const batch of t.batchList) {
          if (!batch.fills.length || !visible(batch.style)) continue;
          ctx.globalAlpha = batch.style.alpha;
          ctx.fillStyle = this.colorOf(batch.style, opts, fg);
          for (const p of batch.fills) ctx.fill(p as Path2D, 'evenodd');
        }
      }
    }
    // pass 2: strokes (and unfilled outlines of fills)
    for (const t of tiles) {
      const m = tileTransform(t);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      for (const batch of t.batchList) {
        if (!visible(batch.style)) continue;
        const st = batch.style;
        const color = this.colorOf(st, opts, fg);
        ctx.globalAlpha = st.alpha;
        if (!opts.fills && batch.fills.length) {
          ctx.strokeStyle = color;
          ctx.lineWidth = dpr / scaleDev;
          ctx.setLineDash([]);
          for (const p of batch.fills) ctx.stroke(p as Path2D);
        }
        if (!batch.stroke) continue;
        stats.batches++;
        ctx.strokeStyle = color;
        ctx.lineWidth = this.lineWidthPx(st, opts, dpr) / scaleDev;
        const dash = opts.linetypes ? this.dash(st, scaleDev) : null;
        ctx.setLineDash(dash ?? []);
        ctx.stroke(batch.stroke as Path2D);
      }
    }
    ctx.setLineDash([]);
    // pass 3: points
    this.drawPoints(ctx, tiles, tileTransform, opts, fg, scaleDev, H, visible);
    // pass 4: text
    if (opts.texts) stats.texts = this.drawTexts(ctx, tiles, tileTransform, vb, opts, fg, scaleDev, visible);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    stats.ms = performance.now() - t0;
    return stats;
  }

  private drawPoints(
    ctx: Ctx2D,
    tiles: Tile[],
    tileTransform: (t: Tile) => Affine2,
    opts: RenderOptions,
    fg: number,
    scaleDev: number,
    H: number,
    visible: (s: Style) => boolean,
  ): void {
    const mode = opts.pdmode | 0;
    const base = mode & 7;
    if (base === 1 && !(mode & 96)) return;
    let sizeDev: number;
    if (opts.pdsize > 0) sizeDev = opts.pdsize * scaleDev;
    else if (opts.pdsize < 0) sizeDev = (-opts.pdsize / 100) * H;
    else sizeDev = 0.05 * H;
    sizeDev = Math.max(2, Math.min(sizeDev, 200));
    for (const t of tiles) {
      if (!t.points.length) continue;
      const m = tileTransform(t);
      for (const p of t.points) {
        if (!visible(p.style)) continue;
        const x = m[0] * p.x + m[2] * p.y + m[4];
        const y = m[1] * p.x + m[3] * p.y + m[5];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = p.style.alpha;
        ctx.strokeStyle = ctx.fillStyle = this.colorOf(p.style, opts, fg);
        ctx.lineWidth = 1;
        const r = sizeDev / 2;
        ctx.beginPath();
        if (base === 0) {
          ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        } else if (base === 2) {
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
  }

  private drawTexts(
    ctx: Ctx2D,
    tiles: Tile[],
    tileTransform: (t: Tile) => Affine2,
    vb: { minX: number; minY: number; maxX: number; maxY: number },
    opts: RenderOptions,
    fg: number,
    scaleDev: number,
    visible: (s: Style) => boolean,
  ): number {
    let drawn = 0;
    let currentFont = '';
    const bgCss = css(opts.background);
    for (const t of tiles) {
      if (!t.texts.length) continue;
      const tm = tileTransform(t);
      for (const item of t.texts) {
        if (!visible(item.style) || !intersects(item.bbox, vb)) continue;
        const L = item.layout;
        const px = L.height * item.scale * scaleDev;
        if (px < opts.minTextPx) continue;
        drawn++;
        const base = affineMultiply(tm, item.m);
        const color = this.colorOf(item.style, opts, fg);
        ctx.globalAlpha = item.style.alpha;
        if (L.background) {
          ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
          const bg = L.background;
          ctx.fillStyle = bg.useBackground ? bgCss : bg.rgb !== undefined ? css(bg.rgb) : bgCss;
          ctx.fillRect(bg.minX, bg.minY, bg.maxX - bg.minX, bg.maxY - bg.minY);
        }
        for (const run of L.runs) {
          if (run.mode === 'stroke') {
            const sp = strokeProvider(run.stroke ?? run.font.stroke ?? '');
            if (!sp) continue;
            const k = run.size / sp.cap;
            const m = affineMultiply(base, [k * run.scaleX, 0, -k * run.skew, -k, run.x + sp.baseline * k * run.skew, run.y + sp.baseline * k]);
            ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
            ctx.strokeStyle = opts.monochrome ? color : runColor(run.rgb, run.aci, color, fg);
            ctx.lineWidth = vpLine(m) * this.textStrokePx(item.style, opts);
            ctx.stroke(strokeTextPath(run.stroke ?? run.font.stroke ?? '', run.text));
            continue;
          }
          const k = run.size / REF_PX;
          // glyph space (y down) → local (y up)
          const m = affineMultiply(base, [k * run.scaleX, 0, -k * run.skew, -k, run.x, run.y]);
          ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
          const f = cssFont(run.font, REF_PX);
          if (f !== currentFont) {
            ctx.font = f;
            currentFont = f;
          }
          ctx.fillStyle = opts.monochrome ? color : runColor(run.rgb, run.aci, color, fg);
          ctx.fillText(run.text, 0, 0);
        }
        if (L.lines.length) {
          ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
          ctx.strokeStyle = color;
          ctx.lineWidth = vpLine(base);
          ctx.beginPath();
          for (let i = 0; i < L.lines.length; i += 4) {
            ctx.moveTo(L.lines[i], L.lines[i + 1]);
            ctx.lineTo(L.lines[i + 2], L.lines[i + 3]);
          }
          ctx.stroke();
        }
      }
    }
    return drawn;
  }
}

const strokePathCache = new Map<string, Path2D>();

/** Path of a whole string in a Hershey stroke font (glyph units, y down). */
function strokeTextPath(font: string, text: string): Path2D {
  const key = font + '\u0000' + text;
  let p = strokePathCache.get(key);
  if (p) return p;
  p = new Path2D();
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

/** 1 device pixel expressed in the units of affine `m`. */
function vpLine(m: Affine2): number {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  return 1 / s;
}
