import { nameKey, type DimensionEntity, type DxfDocument, type Entity, type InsertEntity, type MTextEntity, type PointEntity, type TextEntity } from '../dxf/model';
import { affineArcToCanvas } from '../geom/ellipse';
import { applyPoint, identity, multiply, rotationZ, scaling, translation, type Affine2, type Mat34 } from '../geom/matrix';
import { ocsToWcs } from '../geom/ocs';
import { DEG } from '../geom/vec';
import { emitEntity, type EmitOptions } from './emit';
import { BBoxOut, bboxAddPoint, bboxUnion, bboxValid, emptyBBox, Projector, type BBox } from './geoOut';
import { styleKey, StyleResolver, TOP_CTX, type InheritCtx, type Style } from './style';
import { layoutMText, layoutText, type PlacedText, type TextLayout, type TextMeasurer } from './textLayout';

export interface PathLike {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw?: boolean): void;
  closePath(): void;
}

export type PathFactory = () => PathLike;

export interface Batch {
  key: string;
  style: Style;
  stroke: PathLike | null;
  fills: PathLike[];
  strokeCount: number;
}

export interface TextItem {
  layout: TextLayout;
  /** text local → tile-local 2D */
  m: Affine2;
  /** length scale local → world (for LOD) */
  scale: number;
  style: Style;
  bbox: BBox;
  entity: number;
}

export interface PointItem {
  x: number;
  y: number;
  style: Style;
  entity: number;
}

export interface Tile {
  key: string;
  level: number;
  ox: number;
  oy: number;
  bbox: BBox;
  batches: Map<string, Batch>;
  batchList: Batch[];
  texts: TextItem[];
  points: PointItem[];
}

export type RenderMethod = 'native' | 'block' | 'text' | 'frame' | 'none';

export interface CoverageRow {
  type: string;
  count: number;
  rendered: number;
  method: RenderMethod;
}

export interface SceneOptions {
  /** max primitives produced by block expansion */
  budget: number;
  maxDepth: number;
  fill: boolean;
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = { budget: 5_000_000, maxDepth: 64, fill: true };

class TileOut extends Projector {
  tile!: Tile;
  style!: Style;
  key = '';
  private target: PathLike | null = null;
  emitted = 0;

  constructor(private factory: PathFactory) {
    super();
  }

  private batch(): Batch {
    let b = this.tile.batches.get(this.key);
    if (!b) {
      b = { key: this.key, style: this.style, stroke: null, fills: [], strokeCount: 0 };
      this.tile.batches.set(this.key, b);
      this.tile.batchList.push(b);
    }
    return b;
  }

  beginPath(kind: 'stroke' | 'fill'): void {
    const b = this.batch();
    this.emitted++;
    if (kind === 'stroke') {
      b.stroke ??= this.factory();
      b.strokeCount++;
      this.target = b.stroke;
    } else {
      this.target = this.factory();
      b.fills.push(this.target);
    }
  }
  endPath(): void {
    this.target = null;
  }
  closePath(): void {
    this.target?.closePath();
  }
  protected move2(x: number, y: number): void {
    this.target?.moveTo(x - this.tile.ox, y - this.tile.oy);
  }
  protected line2(x: number, y: number): void {
    this.target?.lineTo(x - this.tile.ox, y - this.tile.oy);
  }
  protected arc2(cx: number, cy: number, ux: number, uy: number, vx: number, vy: number, t0: number, t1: number): void {
    const e = affineArcToCanvas(cx - this.tile.ox, cy - this.tile.oy, ux, uy, vx, vy, t0, t1);
    this.target?.ellipse(e.cx, e.cy, e.rx, e.ry, e.rotation, e.start, e.end, e.anticlockwise);
  }
  protected cubic2(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const { ox, oy } = this.tile;
    this.target?.bezierCurveTo(x1 - ox, y1 - oy, x2 - ox, y2 - oy, x - ox, y - oy);
  }
  protected quad2(x1: number, y1: number, x: number, y: number): void {
    const { ox, oy } = this.tile;
    this.target?.quadraticCurveTo(x1 - ox, y1 - oy, x - ox, y - oy);
  }
}

const TEXT_TYPES = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF']);
const BLOCK_TYPES = new Set(['INSERT', 'DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']);
const NATIVE_TYPES = new Set(['LINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'SOLID', 'TRACE', '3DFACE', 'SPLINE', 'HELIX', 'POINT']);

export interface Scene {
  doc: DxfDocument;
  styles: StyleResolver;
  tiles: Map<string, Tile>;
  tileList: Tile[];
  /** top-level entity ids in drawing order */
  items: number[];
  /** per item: minX, minY, maxX, maxY (NaN if none) */
  itemBBox: Float64Array;
  extents: BBox;
  coverage: Map<string, CoverageRow>;
  /** primitives emitted so far */
  primitives: number;
  budgetExceeded: number;
  baseTileSize: number;
}

/**
 * Builds render batches for a list of top-level entities (model space or a
 * layout). Work is incremental (`step`) so the worker can render progressively
 * and keep answering messages.
 */
export class SceneBuilder {
  readonly scene: Scene;
  private out: TileOut;
  private bboxOut = new BBoxOut();
  private textCache = new Map<number, PlacedText | null>();
  private blockBBoxCache = new Map<string, BBox | null>();
  private blockCountCache = new Map<string, number>();
  private blockStack: string[] = [];
  private next = 0;
  private emitOpts: EmitOptions;
  private budgetLeft: number;
  readonly diagnostics: { code: string; message: string; handle?: string }[] = [];
  private diagSeen = new Set<string>();

  constructor(
    private doc: DxfDocument,
    items: number[],
    private measurer: TextMeasurer,
    factory: PathFactory,
    private opts: SceneOptions = DEFAULT_SCENE_OPTIONS,
  ) {
    this.out = new TileOut(factory);
    this.emitOpts = { fill: opts.fill };
    this.budgetLeft = opts.budget;
    this.scene = {
      doc,
      styles: new StyleResolver(doc),
      tiles: new Map(),
      tileList: [],
      items,
      itemBBox: new Float64Array(items.length * 4).fill(NaN),
      extents: emptyBBox(),
      coverage: new Map(),
      primitives: 0,
      budgetExceeded: 0,
      baseTileSize: 1,
    };
  }

  private diag(code: string, message: string, handle?: string): void {
    const key = `${code}:${message}`;
    if (this.diagSeen.has(key)) return;
    this.diagSeen.add(key);
    this.diagnostics.push({ code, message, handle });
  }

  private cover(type: string, method: RenderMethod, rendered: boolean): void {
    let row = this.scene.coverage.get(type);
    if (!row) {
      row = { type, count: 0, rendered: 0, method };
      this.scene.coverage.set(type, row);
    }
    row.count++;
    if (rendered) row.rendered++;
  }

  // ---------- text ----------
  private placedText(e: Entity): PlacedText | null {
    if (this.textCache.has(e.id)) return this.textCache.get(e.id)!;
    let placed: PlacedText | null = null;
    const styleOf = (n: string) => this.doc.styles.get(nameKey(n));
    try {
      if (e.type === 'MTEXT') placed = layoutMText(e as MTextEntity, styleOf, this.measurer);
      else {
        const t = e as TextEntity;
        if (t.mtext) {
          const m = { ...t.mtext, style: t.mtext.style || t.style } as MTextEntity;
          placed = layoutMText(m, styleOf, this.measurer);
        } else {
          const display = t.type === 'ATTDEF' && !t.block ? (t.tag ?? t.text) : t.text;
          placed = layoutText(t, styleOf(t.style), this.measurer, display);
        }
      }
    } catch (err) {
      this.diag('text-layout', `Text layout failed: ${(err as Error).message}`, e.handle);
    }
    this.textCache.set(e.id, placed);
    return placed;
  }

  private textVisible(e: Entity, inBlock: boolean): boolean {
    if (e.type === 'ATTRIB') return !(((e as TextEntity).attribFlags ?? 0) & 1);
    if (e.type === 'ATTDEF') {
      const f = (e as TextEntity).attribFlags ?? 0;
      if (f & 1) return false;
      // inside a block only constant attributes are drawn
      return !inBlock || (f & 2) !== 0;
    }
    return true;
  }

  private textBBox(p: PlacedText, m: Mat34, into: BBox): void {
    const full = multiply(m, p.matrix);
    const L = p.layout;
    const bg = L.background;
    const x0 = Math.min(L.minX, bg?.minX ?? Infinity);
    const x1 = Math.max(L.maxX, bg?.maxX ?? -Infinity);
    const y0 = Math.min(L.minY, bg?.minY ?? Infinity);
    const y1 = Math.max(L.maxY, bg?.maxY ?? -Infinity);
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]) {
      const q = applyPoint(full, x, y, 0);
      bboxAddPoint(into, q[0], q[1]);
    }
  }

  // ---------- block helpers ----------
  private insertMatrices(ins: InsertEntity, block: { base: [number, number, number] }): Mat34[] {
    const base = multiply(multiply(ocsToWcs(ins.extrusion), translation(ins.insert[0], ins.insert[1], ins.insert[2])), rotationZ((ins.rotation || 0) * DEG));
    const tail = multiply(scaling(ins.scale[0] || 1, ins.scale[1] || 1, ins.scale[2] || 1), translation(-block.base[0], -block.base[1], -block.base[2]));
    const rows = Math.max(1, ins.rows | 0);
    const cols = Math.max(1, ins.columns | 0);
    const out: Mat34[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const grid = r === 0 && c === 0 ? base : multiply(base, translation(c * (ins.columnSpacing || 0), r * (ins.rowSpacing || 0), 0));
        out.push(multiply(grid, tail));
      }
    }
    return out;
  }

  private dimensionMatrix(d: DimensionEntity): Mat34 {
    const ocs = ocsToWcs(d.extrusion);
    const ins = applyPoint(ocs, d.cloneInsert[0], d.cloneInsert[1], d.cloneInsert[2]);
    return multiply(translation(ins[0], ins[1], ins[2]), multiply(ocs, translation(0, 0, d.textMidpoint?.[2] ?? 0)));
  }

  /** Primitive count of a block definition (memoized; cycles count as 0). */
  private blockCount(name: string): number {
    const key = nameKey(name);
    const cached = this.blockCountCache.get(key);
    if (cached !== undefined) return cached;
    const block = this.doc.blocks.get(key);
    if (!block) return 0;
    this.blockCountCache.set(key, 0); // cycle guard
    let n = 0;
    for (const id of block.entities) {
      const e = this.doc.entities[id];
      if (e.type === 'INSERT') {
        const ins = e as InsertEntity;
        n += this.blockCount(ins.name) * Math.max(1, ins.rows) * Math.max(1, ins.columns) + ins.attribs.length;
      } else if (BLOCK_TYPES.has(e.type)) n += this.blockCount((e as DimensionEntity).blockName);
      else n += 1;
      if (n > 1e15) break;
    }
    this.blockCountCache.set(key, n);
    return n;
  }

  private entityCount(e: Entity): number {
    if (e.type === 'INSERT') {
      const ins = e as InsertEntity;
      return this.blockCount(ins.name) * Math.max(1, ins.rows) * Math.max(1, ins.columns) + ins.attribs.length;
    }
    if (BLOCK_TYPES.has(e.type)) return this.blockCount((e as DimensionEntity).blockName);
    return 1;
  }

  /** Bounding box of a block definition in block coordinates. */
  private blockBBox(name: string): BBox | null {
    const key = nameKey(name);
    if (this.blockBBoxCache.has(key)) return this.blockBBoxCache.get(key)!;
    const block = this.doc.blocks.get(key);
    if (!block) return null;
    this.blockBBoxCache.set(key, null); // cycle guard
    const b = emptyBBox();
    for (const id of block.entities) {
      const e = this.doc.entities[id];
      const eb = this.entityBBox(e, identity(), true);
      if (eb) bboxUnion(b, eb);
    }
    const res = bboxValid(b) ? b : null;
    this.blockBBoxCache.set(key, res);
    return res;
  }

  private transformBBox(b: BBox, m: Mat34, into: BBox): void {
    for (const [x, y] of [
      [b.minX, b.minY],
      [b.maxX, b.minY],
      [b.minX, b.maxY],
      [b.maxX, b.maxY],
    ]) {
      const p = applyPoint(m, x, y, 0);
      bboxAddPoint(into, p[0], p[1]);
    }
  }

  /** Bounding box of an entity under matrix m (null = no geometry). */
  private entityBBox(e: Entity, m: Mat34, inBlock: boolean): BBox | null {
    if (e.invisible) return null;
    const b = emptyBBox();
    if (e.type === 'INSERT') {
      const ins = e as InsertEntity;
      const block = this.doc.blocks.get(nameKey(ins.name));
      if (block) {
        const bb = this.blockBBox(ins.name);
        if (bb) {
          const mats = this.insertMatrices(ins, block);
          const corners = mats.length > 4 ? [mats[0], mats[ins.columns - 1], mats[mats.length - ins.columns], mats[mats.length - 1]] : mats;
          for (const cm of corners) this.transformBBox(bb, multiply(m, cm), b);
        }
      }
      for (const a of ins.attribs) {
        const ab = this.entityBBox(a, m, inBlock);
        if (ab) bboxUnion(b, ab);
      }
    } else if (BLOCK_TYPES.has(e.type)) {
      const d = e as DimensionEntity;
      const bb = this.blockBBox(d.blockName);
      if (bb) this.transformBBox(bb, multiply(m, this.dimensionMatrix(d)), b);
    } else if (TEXT_TYPES.has(e.type)) {
      if (!this.textVisible(e, inBlock)) return null;
      const p = this.placedText(e);
      if (p) this.textBBox(p, m, b);
    } else if (e.type === 'POINT') {
      const p = applyPoint(m, ...(e as PointEntity).position);
      bboxAddPoint(b, p[0], p[1]);
    } else {
      this.bboxOut.reset();
      if (!emitEntity(e, this.bboxOut, m, this.emitOpts)) return null;
      return bboxValid(this.bboxOut.b) ? { ...this.bboxOut.b } : null;
    }
    return bboxValid(b) ? b : null;
  }

  // ---------- tiles ----------
  private tileFor(b: BBox): Tile {
    const s0 = this.scene.baseTileSize;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    let level = 0;
    let s = s0;
    while (size > s && level < 40) {
      s *= 4;
      level++;
    }
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const ix = Math.floor(cx / s);
    const iy = Math.floor(cy / s);
    const key = `${level}:${ix}:${iy}`;
    let t = this.scene.tiles.get(key);
    if (!t) {
      t = { key, level, ox: (ix + 0.5) * s, oy: (iy + 0.5) * s, bbox: emptyBBox(), batches: new Map(), batchList: [], texts: [], points: [] };
      this.scene.tiles.set(key, t);
      this.scene.tileList.push(t);
    }
    return t;
  }

  /** Pass 1: bounding boxes, extents and the base tile size. */
  prepare(): void {
    const { items, itemBBox } = this.scene;
    const centersX: number[] = [];
    const centersY: number[] = [];
    const ext = this.scene.extents;
    items.forEach((id, k) => {
      const e = this.doc.entities[id];
      const b = this.entityBBox(e, identity(), false);
      if (!b) return;
      itemBBox[k * 4] = b.minX;
      itemBBox[k * 4 + 1] = b.minY;
      itemBBox[k * 4 + 2] = b.maxX;
      itemBBox[k * 4 + 3] = b.maxY;
      bboxUnion(ext, b);
      centersX.push((b.minX + b.maxX) / 2);
      centersY.push((b.minY + b.maxY) / 2);
    });
    // robust extent (2nd–98th percentile) so stray far-away entities do not inflate tiles
    const robust = (arr: number[]) => {
      if (!arr.length) return 1;
      const s = [...arr].sort((a, b) => a - b);
      const lo = s[Math.floor(s.length * 0.02)];
      const hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.98))];
      return hi - lo;
    };
    const span = Math.max(robust(centersX), robust(centersY));
    const n = Math.max(1, items.length);
    const divisions = Math.max(4, Math.min(64, Math.round(Math.sqrt(n / 64))));
    this.scene.baseTileSize = span > 0 ? span / divisions : 1;
  }

  get done(): boolean {
    return this.next >= this.scene.items.length;
  }

  get progress(): number {
    return this.scene.items.length ? this.next / this.scene.items.length : 1;
  }

  /** Pass 2: emit geometry until `deadline` (performance.now()). Returns true when finished. */
  step(deadline: number, now: () => number): boolean {
    const { items, itemBBox } = this.scene;
    while (this.next < items.length) {
      const k = this.next++;
      if (Number.isNaN(itemBBox[k * 4])) {
        const e = this.doc.entities[items[k]];
        this.cover(e.type, NATIVE_TYPES.has(e.type) ? 'native' : TEXT_TYPES.has(e.type) ? 'text' : BLOCK_TYPES.has(e.type) ? 'block' : 'none', false);
        if (!NATIVE_TYPES.has(e.type) && !TEXT_TYPES.has(e.type) && !BLOCK_TYPES.has(e.type)) {
          this.diag('not-rendered', `${e.type} entities are not rendered yet`);
        }
        continue;
      }
      const b: BBox = { minX: itemBBox[k * 4], minY: itemBBox[k * 4 + 1], maxX: itemBBox[k * 4 + 2], maxY: itemBBox[k * 4 + 3] };
      const tile = this.tileFor(b);
      bboxUnion(tile.bbox, b);
      this.out.tile = tile;
      this.emitTop(this.doc.entities[items[k]], tile);
      if ((k & 63) === 0 && now() > deadline) break;
    }
    return this.done;
  }

  private emitTop(e: Entity, tile: Tile): void {
    if (e.type === 'INSERT' || BLOCK_TYPES.has(e.type)) {
      const cost = this.entityCount(e);
      if (cost > this.budgetLeft) {
        this.scene.budgetExceeded++;
        this.diag('budget', `Block reference expansion exceeds the budget; drawing bounding frames instead`, e.handle);
        this.emitFrame(e, tile);
        this.cover(e.type, 'frame', true);
        return;
      }
      this.budgetLeft -= cost;
    }
    this.emitAny(e, identity(), TOP_CTX, 0, false, tile);
  }

  private emitFrame(e: Entity, tile: Tile): void {
    const k = this.scene.items.indexOf(e.id);
    const ib = this.scene.itemBBox;
    const st = this.scene.styles.resolve(e, TOP_CTX);
    this.out.style = st;
    this.out.key = styleKey(st);
    this.out.setMatrix(identity());
    this.out.beginPath('stroke');
    const [x0, y0, x1, y1] = [ib[k * 4], ib[k * 4 + 1], ib[k * 4 + 2], ib[k * 4 + 3]];
    this.out.moveTo(x0, y0, 0);
    this.out.lineTo(x1, y0, 0);
    this.out.lineTo(x1, y1, 0);
    this.out.lineTo(x0, y1, 0);
    this.out.closePath();
    // diagonal marks the frame as a placeholder
    this.out.moveTo(x0, y0, 0);
    this.out.lineTo(x1, y1, 0);
    this.out.endPath();
    void tile;
  }

  private emitAny(e: Entity, m: Mat34, ctx: InheritCtx, depth: number, inBlock: boolean, tile: Tile): void {
    if (e.invisible) return;
    const styles = this.scene.styles;
    if (e.type === 'INSERT') {
      const ins = e as InsertEntity;
      const block = this.doc.blocks.get(nameKey(ins.name));
      const st = styles.resolve(e, ctx);
      styles.layers[st.layer].count++;
      if (!block) {
        this.diag('missing-block', `Block "${ins.name}" is not defined`, e.handle);
        if (depth === 0) this.cover(e.type, 'block', false);
      } else if (depth >= this.opts.maxDepth || this.blockStack.includes(nameKey(ins.name))) {
        this.diag('block-recursion', `Block "${ins.name}" is nested too deeply or references itself`, e.handle);
      } else {
        const sx = Math.abs(ins.scale[0] || 1);
        const sy = Math.abs(ins.scale[1] || 1);
        const child = styles.childCtx(e, ctx, Math.sqrt(sx * sy));
        this.blockStack.push(nameKey(ins.name));
        for (const bm of this.insertMatrices(ins, block)) {
          const mm = multiply(m, bm);
          for (const id of block.entities) this.emitAny(this.doc.entities[id], mm, child, depth + 1, true, tile);
        }
        this.blockStack.pop();
        if (depth === 0) this.cover(e.type, 'block', true);
      }
      // attributes are positioned in their own coordinates (not block space)
      const attrCtx = block ? styles.childCtx(e, ctx, 1) : ctx;
      for (const a of ins.attribs) this.emitAny(a, m, { ...attrCtx, layer: ctx.layer }, depth + 1, false, tile);
      return;
    }
    if (BLOCK_TYPES.has(e.type)) {
      const d = e as DimensionEntity;
      const block = this.doc.blocks.get(nameKey(d.blockName));
      const st = styles.resolve(e, ctx);
      styles.layers[st.layer].count++;
      if (!block) {
        if (depth === 0) this.cover(e.type, 'block', false);
        this.diag('dimension-block', `${e.type} without geometry block (not rendered yet)`, e.handle);
        return;
      }
      if (depth >= this.opts.maxDepth || this.blockStack.includes(nameKey(d.blockName))) return;
      const child = styles.childCtx(e, ctx, 1);
      const mm = multiply(m, this.dimensionMatrix(d));
      this.blockStack.push(nameKey(d.blockName));
      for (const id of block.entities) this.emitAny(this.doc.entities[id], mm, child, depth + 1, true, tile);
      this.blockStack.pop();
      if (depth === 0) this.cover(e.type, 'block', true);
      return;
    }
    const st = styles.resolve(e, ctx);
    styles.layers[st.layer].count++;
    this.out.style = st;
    this.out.key = styleKey(st);
    if (TEXT_TYPES.has(e.type)) {
      if (!this.textVisible(e, inBlock)) return;
      const p = this.placedText(e);
      if (p) {
        const full = multiply(m, p.matrix);
        const scale = Math.sqrt(Math.abs(full[0] * full[5] - full[1] * full[4])) || 1;
        const bbox = emptyBBox();
        this.textBBox(p, m, bbox);
        tile.texts.push({
          layout: p.layout,
          m: [full[0], full[4], full[1], full[5], full[3] - tile.ox, full[7] - tile.oy],
          scale,
          style: st,
          bbox,
          entity: e.id,
        });
        this.scene.primitives++;
      }
      if (depth === 0) this.cover(e.type, 'text', !!p);
      return;
    }
    if (e.type === 'POINT') {
      const p = applyPoint(m, ...(e as PointEntity).position);
      tile.points.push({ x: p[0] - tile.ox, y: p[1] - tile.oy, style: st, entity: e.id });
      this.scene.primitives++;
      if (depth === 0) this.cover(e.type, 'native', true);
      return;
    }
    const before = this.out.emitted;
    const ok = emitEntity(e, this.out, m, this.emitOpts);
    this.scene.primitives += this.out.emitted - before;
    if (depth === 0) this.cover(e.type, ok ? 'native' : 'none', ok);
    if (!ok) this.diag('not-rendered', `${e.type} entities are not rendered yet`);
  }
}
