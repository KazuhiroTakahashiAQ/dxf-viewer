import type { HatchEntity, PatternLine } from '../dxf/entities/hatch';
import { aciToRgb } from '../dxf/colors';
import { nameKey, type DimensionEntity, type DxfDocument, type Entity, type InsertEntity, type MTextEntity, type PointEntity, type TextEntity } from '../dxf/model';
import { sortTable, spatialFilter } from '../dxf/objects';
import { affineArcToCanvas } from '../geom/ellipse';
import { applyPoint, identity, multiply, rotationZ, scaling, translation, type Affine2, type Mat34 } from '../geom/matrix';
import { ocsToWcs } from '../geom/ocs';
import { DEG, type Vec3 } from '../geom/vec';
import { COMPLEX_TYPES, complexMethod, emitComplex, emitDimensionFallback, emitProxy } from './complex';
import { emitEntity, type EmitOptions } from './emit';
import { BBoxOut, bboxAddPoint, bboxUnion, bboxValid, emptyBBox, Projector, type BBox } from './geoOut';
import { buildHatchPath } from './hatchGeom';
import type { EmitHost, ImageBuild } from './host';
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

/** A path that only records nothing (for bounds-only passes). */
const NULL_PATH: PathLike = {
  moveTo() {},
  lineTo() {},
  bezierCurveTo() {},
  quadraticCurveTo() {},
  ellipse() {},
  closePath() {},
};

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

export interface HatchItem {
  path: PathLike;
  /** hatch-local → tile-local */
  m: Affine2;
  style: Style;
  bbox: BBox;
  /** bounds in hatch-local coordinates */
  local: BBox;
  solid: boolean;
  solidColor?: number;
  fillRule: 'evenodd' | 'nonzero';
  gradient?: { name: string; angle: number; shift: number; c1: number; c2: number };
  lines: PatternLine[];
  outline: boolean;
  entity: number;
}

export interface ImageItem {
  /** corners in tile-local coordinates: x0,y0,…,x3,y3 */
  corners: number[];
  clip?: number[];
  label: string;
  fileName?: string;
  wipeout: boolean;
  width: number;
  height: number;
  style: Style;
  bbox: BBox;
  entity: number;
}

export interface InfiniteItem {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ray: boolean;
  style: Style;
  entity: number;
}

export type RunKind = 'geom' | 'text' | 'hatch' | 'image' | 'point' | 'clip';

/** A paper space viewport showing model space. */
export interface ViewportItem {
  entity: number;
  /** paper coordinates */
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** model view */
  viewCx: number;
  viewCy: number;
  viewHeight: number;
  /** radians */
  twist: number;
  target: Vec3;
  frozenLayers: string[];
  /** non-rectangular clip boundary (paper coordinates, absolute) */
  clip?: PathLike;
  /** plan view (direction = +Z); other views are approximated */
  plan: boolean;
  style: Style;
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
  hatches: HatchItem[];
  images: ImageItem[];
  /** XCLIP region in tile-local coordinates */
  clip?: PathLike;
  /** strict mode: what this run holds */
  run?: RunKind;
  runKey?: string;
  count: number;
}

export type RenderMethod = 'native' | 'block' | 'text' | 'frame' | 'proxy' | 'none';

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
  /** draw order: strict follows the file (needed for wipeouts/masks) */
  drawOrder: 'auto' | 'fast' | 'strict';
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = { budget: 5_000_000, maxDepth: 64, fill: true, drawOrder: 'auto' };

/** Filter hooks applied while building (see src/filter). */
export interface SceneFilter {
  /** leaf predicate (entities that are not block references) */
  leaf?: (e: Entity, ctx: InheritCtx, path: string[]) => boolean;
  /** what to do with non-matching leaves */
  leafMode?: 'skip' | 'dim';
  /** top-level entities drawn dimmed (highlight mode) */
  dimTop?: Set<number>;
}

const DIM_ALPHA = 0.15;

class TileOut extends Projector {
  tile!: Tile;
  style!: Style;
  key = '';
  private target: PathLike | null = null;
  emitted = 0;
  /** resolves the tile for a style key (strict mode runs) */
  resolve: (key: string) => Tile = () => this.tile;

  constructor(private factory: PathFactory) {
    super();
  }

  private batch(): Batch {
    this.tile = this.resolve(this.key);
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
    this.tile.count++;
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

/** Projector writing all geometry into one path (absolute coordinates). */
class SinglePathOut extends Projector {
  constructor(private path: PathLike) {
    super();
  }
  beginPath(): void {}
  endPath(): void {}
  closePath(): void {
    this.path.closePath();
  }
  protected move2(x: number, y: number): void {
    this.path.moveTo(x, y);
  }
  protected line2(x: number, y: number): void {
    this.path.lineTo(x, y);
  }
  protected arc2(cx: number, cy: number, ux: number, uy: number, vx: number, vy: number, t0: number, t1: number): void {
    const e = affineArcToCanvas(cx, cy, ux, uy, vx, vy, t0, t1);
    this.path.ellipse(e.cx, e.cy, e.rx, e.ry, e.rotation, e.start, e.end, e.anticlockwise);
  }
  protected cubic2(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.path.bezierCurveTo(x1, y1, x2, y2, x, y);
  }
  protected quad2(x1: number, y1: number, x: number, y: number): void {
    this.path.quadraticCurveTo(x1, y1, x, y);
  }
}

const TEXT_TYPES = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF']);
const DIM_TYPES = new Set(['DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']);
const NATIVE_TYPES = new Set(['LINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'SOLID', 'TRACE', '3DFACE', 'SPLINE', 'HELIX', 'POINT']);
/** Types that occlude what is drawn before them (need file draw order). */
const OCCLUDERS = new Set(['WIPEOUT', 'IMAGE']);

export interface Scene {
  doc: DxfDocument;
  styles: StyleResolver;
  tiles: Map<string, Tile>;
  /** fast mode: spatial tiles; strict mode: runs in drawing order */
  tileList: Tile[];
  strict: boolean;
  infinite: InfiniteItem[];
  viewports: ViewportItem[];
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

/** Bounds-only implementation of EmitHost. */
class BBoxHost implements EmitHost {
  readonly out = new BBoxOut();
  b: BBox = emptyBBox();
  constructor(private builder: SceneBuilder) {}
  get doc() {
    return this.builder.doc;
  }
  get measurer() {
    return this.builder.measurer;
  }
  get styles() {
    return this.builder.scene.styles;
  }
  get fill() {
    return this.builder.fill;
  }
  start(): void {
    this.b = emptyBBox();
    this.out.reset();
  }
  finish(): BBox | null {
    bboxUnion(this.b, this.out.b);
    return bboxValid(this.b) ? this.b : null;
  }
  use(e: Entity, ctx: InheritCtx): Style {
    return this.styles.resolve(e, ctx);
  }
  useStyle(): void {}
  text(p: PlacedText, m: Mat34): void {
    textBBox(p, m, this.b);
  }
  hatch(h: HatchEntity, m: Mat34): void {
    const { bbox } = buildHatchPath(h, NULL_PATH, 0, 0, h.style === 2);
    if (bboxValid(bbox)) transformBBox(bbox, m, this.b);
  }
  image(item: ImageBuild): void {
    for (const p of item.clip ?? item.corners) bboxAddPoint(this.b, p[0], p[1]);
  }
  infinite(): void {
    /* excluded from extents */
  }
  point(p: Vec3): void {
    bboxAddPoint(this.b, p[0], p[1]);
  }
  block(name: string, m: Mat34): boolean {
    const bb = this.builder.blockBBox(name);
    if (bb) transformBBox(bb, m, this.b);
    return !!bb;
  }
  child(e: Entity, m: Mat34): void {
    const eb = this.builder.entityBBox(e, m, true);
    if (eb) bboxUnion(this.b, eb);
  }
  diag(): void {}
}

function transformBBox(b: BBox, m: Mat34, into: BBox): void {
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

function textBBox(p: PlacedText, m: Mat34, into: BBox): void {
  const full = multiply(m, p.matrix);
  const L = p.layout;
  const bg = L.background;
  const x0 = Math.min(L.minX, bg?.minX ?? Infinity);
  const x1 = Math.max(L.maxX, bg?.maxX ?? -Infinity);
  const y0 = Math.min(L.minY, bg?.minY ?? Infinity);
  const y1 = Math.max(L.maxY, bg?.maxY ?? -Infinity);
  transformBBox({ minX: x0, minY: y0, maxX: x1, maxY: y1 }, full, into);
}

/**
 * Builds render data for a list of top-level entities (model space or a
 * layout). Work is incremental (`step`) so the worker can render
 * progressively and keep answering messages.
 */
export class SceneBuilder implements EmitHost {
  readonly scene: Scene;
  readonly out: TileOut;
  private bboxHost: BBoxHost;
  private bboxHosts: BBoxHost[] = [];
  private bboxDepth = 0;
  private textCache = new Map<number, PlacedText | null>();
  private blockBBoxCache = new Map<string, BBox | null>();
  private blockCountCache = new Map<string, number>();
  private blockOrderCache = new Map<string, number[]>();
  private blockStack: string[] = [];
  private next = 0;
  private emitOpts: EmitOptions;
  private budgetLeft: number;
  readonly diagnostics: { code: string; message: string; handle?: string }[] = [];
  private diagSeen = new Set<string>();
  private itemIndex = new Map<number, number>();
  readonly fill: boolean;
  /** fast mode: tile of the current top-level entity */
  private topTile: Tile | null = null;
  private topBBox: BBox | null = null;
  private clipTile: Tile | null = null;
  private runSeq = 0;
  private alphaFactor = 1;
  private blockNames: string[] = [];
  filter: SceneFilter | null = null;

  constructor(
    readonly doc: DxfDocument,
    items: number[],
    readonly measurer: TextMeasurer,
    private factory: PathFactory,
    private opts: SceneOptions = DEFAULT_SCENE_OPTIONS,
    sharedStyles?: StyleResolver,
  ) {
    items.forEach((id, k) => this.itemIndex.set(id, k));
    this.out = new TileOut(factory);
    this.out.resolve = (key) => this.target('geom', key);
    this.fill = opts.fill;
    this.emitOpts = { fill: opts.fill };
    this.budgetLeft = opts.budget;
    this.bboxHost = new BBoxHost(this);
    this.bboxHosts.push(this.bboxHost);
    const strict = opts.drawOrder === 'strict' || (opts.drawOrder === 'auto' && hasOccluders(doc));
    this.scene = {
      doc,
      styles: sharedStyles ?? new StyleResolver(doc),
      tiles: new Map(),
      tileList: [],
      strict,
      infinite: [],
      viewports: [],
      items,
      itemBBox: new Float64Array(items.length * 4).fill(NaN),
      extents: emptyBBox(),
      coverage: new Map(),
      primitives: 0,
      budgetExceeded: 0,
      baseTileSize: 1,
    };
  }

  get styles(): StyleResolver {
    return this.scene.styles;
  }

  diag(code: string, message: string, handle?: string): void {
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
    if (rendered && row.method === 'none') row.method = method;
  }

  // ---------- EmitHost ----------
  use(e: Entity, ctx: InheritCtx): Style {
    let st = this.scene.styles.resolve(e, ctx);
    if (this.alphaFactor !== 1) st = { ...st, alpha: st.alpha * this.alphaFactor };
    this.useStyle(st);
    return st;
  }

  useStyle(st: Style): void {
    this.out.style = st;
    this.out.key = styleKey(st);
  }

  text(p: PlacedText, m: Mat34, st: Style, entity: number): void {
    const tile = this.target('text');
    const full = multiply(m, p.matrix);
    const scale = Math.sqrt(Math.abs(full[0] * full[5] - full[1] * full[4])) || 1;
    const bbox = emptyBBox();
    textBBox(p, m, bbox);
    tile.texts.push({ layout: p.layout, m: [full[0], full[4], full[1], full[5], full[3] - tile.ox, full[7] - tile.oy], scale, style: st, bbox, entity });
    bboxUnion(tile.bbox, bbox);
    tile.count++;
    this.scene.primitives++;
  }

  hatch(h: HatchEntity, m: Mat34, st: Style, entity: number, o: { solidColor?: number; outline?: boolean }): void {
    const onlyExternal = h.style === 2;
    const probe = buildHatchPath(h, NULL_PATH, 0, 0, onlyExternal);
    if (!bboxValid(probe.bbox) || !probe.loops) {
      this.diag('hatch-empty', 'HATCH without usable boundary paths', this.doc.entities[entity]?.handle);
      return;
    }
    const b = probe.bbox;
    const ox = (b.minX + b.maxX) / 2;
    const oy = (b.minY + b.maxY) / 2;
    const tile = this.target('hatch');
    const path = this.factory();
    buildHatchPath(h, path, ox, oy, onlyExternal);
    const lm = multiply(m, translation(ox, oy, 0));
    const bbox = emptyBBox();
    transformBBox(b, m, bbox);
    const g = h.gradient;
    const colorOf = (c: { aci?: number; rgb?: number } | undefined, fallback: number) => (c?.rgb !== undefined ? c.rgb : c?.aci !== undefined && c.aci > 0 && c.aci < 256 ? aciToRgb(c.aci) : fallback);
    let gradient: HatchItem['gradient'];
    if (g) {
      const c1 = colorOf(g.colors[0], st.fg ? 0x808080 : st.rgb);
      let c2 = colorOf(g.colors[1], 0xffffff);
      if (g.singleColor || g.colors.length < 2) c2 = tint(c1, g.tint);
      gradient = { name: g.name || 'LINEAR', angle: g.angle, shift: g.shift, c1, c2 };
    }
    tile.hatches.push({
      path,
      m: [lm[0], lm[4], lm[1], lm[5], lm[3] - tile.ox, lm[7] - tile.oy],
      style: st,
      bbox,
      local: { minX: b.minX - ox, minY: b.minY - oy, maxX: b.maxX - ox, maxY: b.maxY - oy },
      solid: (h.solid || o.solidColor !== undefined) && !g,
      solidColor: o.solidColor,
      fillRule: onlyExternal ? 'nonzero' : 'evenodd',
      gradient,
      lines: h.solid ? [] : h.patternLines.map((l) => ({ ...l, baseX: l.baseX - ox, baseY: l.baseY - oy })),
      outline: !!o.outline,
      entity,
    });
    bboxUnion(tile.bbox, bbox);
    tile.count++;
    this.scene.primitives++;
  }

  image(item: ImageBuild, st: Style, entity: number): void {
    const tile = this.target('image');
    const flat = (pts: Vec3[]) => pts.flatMap((p) => [p[0] - tile.ox, p[1] - tile.oy]);
    const bbox = emptyBBox();
    for (const p of item.clip ?? item.corners) bboxAddPoint(bbox, p[0], p[1]);
    tile.images.push({
      corners: flat(item.corners),
      clip: item.clip ? flat(item.clip) : undefined,
      label: item.label,
      fileName: item.fileName,
      wipeout: item.wipeout,
      width: item.width,
      height: item.height,
      style: st,
      bbox,
      entity,
    });
    bboxUnion(tile.bbox, bbox);
    tile.count++;
    this.scene.primitives++;
  }

  infinite(base: Vec3, dir: Vec3, ray: boolean, st: Style, entity: number): void {
    const len = Math.hypot(dir[0], dir[1]);
    if (!(len > 1e-12)) return;
    this.scene.infinite.push({ x: base[0], y: base[1], dx: dir[0] / len, dy: dir[1] / len, ray, style: st, entity });
    this.scene.primitives++;
  }

  point(p: Vec3, st: Style, entity: number): void {
    const tile = this.target('point');
    tile.points.push({ x: p[0] - tile.ox, y: p[1] - tile.oy, style: st, entity });
    bboxAddPoint(tile.bbox, p[0], p[1]);
    tile.count++;
    this.scene.primitives++;
  }

  block(name: string, m: Mat34, owner: Entity, ctx: InheritCtx, depth: number): boolean {
    const key = nameKey(name);
    const block = this.doc.blocks.get(key);
    if (!block) return false;
    if (depth >= this.opts.maxDepth || this.blockStack.includes(key)) return false;
    void owner;
    this.blockStack.push(key);
    this.blockNames.push(block.name);
    for (const id of this.blockOrder(key)) this.emitAny(this.doc.entities[id], m, ctx, depth + 1, true);
    this.blockNames.pop();
    this.blockStack.pop();
    return true;
  }

  child(e: Entity, m: Mat34, ctx: InheritCtx, depth: number): void {
    this.emitAny(e, m, ctx, depth, true);
  }

  // ---------- targets (tiles / runs) ----------
  private newTile(kind: RunKind | undefined, center: [number, number], runKey?: string): Tile {
    const key = `run:${this.runSeq++}`;
    const t: Tile = {
      key,
      level: -1,
      ox: center[0],
      oy: center[1],
      bbox: emptyBBox(),
      batches: new Map(),
      batchList: [],
      texts: [],
      points: [],
      hatches: [],
      images: [],
      run: kind,
      runKey,
      count: 0,
    };
    this.scene.tiles.set(key, t);
    this.scene.tileList.push(t);
    return t;
  }

  private target(kind: RunKind, key = ''): Tile {
    if (this.clipTile) return this.clipTile;
    if (!this.scene.strict) return this.topTile!;
    const list = this.scene.tileList;
    const last = list[list.length - 1];
    const b = this.topBBox;
    const cx = b ? (b.minX + b.maxX) / 2 : 0;
    const cy = b ? (b.minY + b.maxY) / 2 : 0;
    const limit = this.scene.baseTileSize * 16;
    const run =
      last && last.run === kind && (kind !== 'geom' || last.runKey === key) && last.count < 20000 && Math.abs(cx - last.ox) < limit && Math.abs(cy - last.oy) < limit
        ? last
        : this.newTile(kind, [cx, cy], key);
    if (b) bboxUnion(run.bbox, b);
    return run;
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
    if (!e.virtual) this.textCache.set(e.id, placed);
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

  /** Entity ids of a block in draw order (SORTENTSTABLE in strict mode). */
  private blockOrder(key: string): number[] {
    const cached = this.blockOrderCache.get(key);
    if (cached) return cached;
    const block = this.doc.blocks.get(key)!;
    let ids = block.entities;
    if (this.scene.strict) ids = this.sorted(ids, block.recordHandle);
    this.blockOrderCache.set(key, ids);
    return ids;
  }

  private sorted(ids: number[], recordHandle: string | undefined): number[] {
    const table = sortTable(this.doc, recordHandle);
    if (!table) return ids;
    const sortKey = (id: number) => {
      const h = this.doc.entities[id].handle.toUpperCase();
      const s = table.get(h) ?? h;
      return /^[0-9A-F]+$/.test(s) ? BigInt('0x' + s) : 0n;
    };
    return ids
      .map((id, i) => ({ id, i, k: sortKey(id) }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
      .map((x) => x.id);
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
      n += this.entityCount(this.doc.entities[id]);
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
    if (DIM_TYPES.has(e.type)) return this.blockCount((e as DimensionEntity).blockName) || 1;
    if (e.type === 'ACAD_TABLE') return this.blockCount(String(e.name ?? '')) || 1;
    return 1;
  }

  /** Bounding box of a block definition in block coordinates. */
  blockBBox(name: string): BBox | null {
    const key = nameKey(name);
    if (this.blockBBoxCache.has(key)) return this.blockBBoxCache.get(key)!;
    const block = this.doc.blocks.get(key);
    if (!block) return null;
    this.blockBBoxCache.set(key, null); // cycle guard
    const b = emptyBBox();
    for (const id of block.entities) {
      const eb = this.entityBBox(this.doc.entities[id], identity(), true);
      if (eb) bboxUnion(b, eb);
    }
    const res = bboxValid(b) ? b : null;
    this.blockBBoxCache.set(key, res);
    return res;
  }

  private clipPolygon(ins: InsertEntity, m: Mat34): Vec3[] | null {
    const sf = spatialFilter(this.doc, ins);
    if (!sf) return null;
    const block = this.doc.blocks.get(nameKey(ins.name));
    if (!block) return null;
    const bm = multiply(m, this.insertMatrices({ ...ins, rows: 1, columns: 1 }, block)[0]);
    return sf.points.map(([x, y]) => applyPoint(bm, x, y, 0));
  }

  /** Bounding box of an entity under matrix m (null = no geometry). */
  entityBBox(e: Entity, m: Mat34, inBlock: boolean): BBox | null {
    if (e.invisible) return null;
    // bounding-box hosts are per nesting level: computing a block's bounds for the
    // first time recurses into entityBBox while the outer entity is still collecting
    const level = this.bboxDepth++;
    try {
      this.bboxHost = this.bboxHosts[level] ??= new BBoxHost(this);
      return this.entityBBoxAt(e, m, inBlock);
    } finally {
      this.bboxDepth--;
      this.bboxHost = this.bboxHosts[Math.max(0, this.bboxDepth - 1)] ?? this.bboxHosts[0];
    }
  }

  private entityBBoxAt(e: Entity, m: Mat34, inBlock: boolean): BBox | null {
    const b = emptyBBox();
    if (e.type === 'INSERT') {
      const ins = e as InsertEntity;
      const block = this.doc.blocks.get(nameKey(ins.name));
      if (block) {
        const clip = this.clipPolygon(ins, m);
        if (clip) for (const p of clip) bboxAddPoint(b, p[0], p[1]);
        else {
          const bb = this.blockBBox(ins.name);
          if (bb) {
            const mats = this.insertMatrices(ins, block);
            const corners = mats.length > 4 ? [mats[0], mats[ins.columns - 1], mats[mats.length - ins.columns], mats[mats.length - 1]] : mats;
            for (const cm of corners) transformBBox(bb, multiply(m, cm), b);
          }
        }
      }
      for (const a of ins.attribs) {
        const ab = this.entityBBox(a, m, inBlock);
        if (ab) bboxUnion(b, ab);
      }
    } else if (DIM_TYPES.has(e.type)) {
      const d = e as DimensionEntity;
      const bb = this.blockBBox(d.blockName);
      if (bb) transformBBox(bb, multiply(m, this.dimensionMatrix(d)), b);
      else {
        const host = this.bboxHost;
        host.start();
        emitDimensionFallback(host, d, m, TOP_CTX, 0);
        return host.finish();
      }
    } else if (TEXT_TYPES.has(e.type)) {
      if (!this.textVisible(e, inBlock)) return null;
      const p = this.placedText(e);
      if (p) textBBox(p, m, b);
    } else if (e.type === 'POINT') {
      const p = applyPoint(m, ...(e as PointEntity).position);
      bboxAddPoint(b, p[0], p[1]);
    } else if (e.type === 'VIEWPORT') {
      const v = e as Entity & { center: Vec3; width: number; height: number; vpId: number };
      if (v.vpId === 1 || !(v.width > 0)) return null;
      const c = applyPoint(m, v.center[0], v.center[1], v.center[2]);
      bboxAddPoint(b, c[0] - v.width / 2, c[1] - v.height / 2);
      bboxAddPoint(b, c[0] + v.width / 2, c[1] + v.height / 2);
    } else if (NATIVE_TYPES.has(e.type)) {
      const out = this.bboxHost.out;
      out.reset();
      if (!emitEntity(e, out, m, this.emitOpts)) return null;
      return bboxValid(out.b) ? { ...out.b } : null;
    } else {
      const host = this.bboxHost;
      host.start();
      const ok = COMPLEX_TYPES.has(e.type) ? emitComplex(host, e, m, TOP_CTX, 0) : emitProxy(host, e, m, TOP_CTX, 0);
      return ok ? host.finish() : null;
    }
    return bboxValid(b) ? b : null;
  }

  // ---------- spatial tiles (fast mode) ----------
  private tileFor(b: BBox): Tile {
    const s0 = this.scene.baseTileSize;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    let level = 0;
    let s = s0;
    while (size > s && level < 40) {
      s *= 4;
      level++;
    }
    const ix = Math.floor((b.minX + b.maxX) / 2 / s);
    const iy = Math.floor((b.minY + b.maxY) / 2 / s);
    const key = `${level}:${ix}:${iy}`;
    let t = this.scene.tiles.get(key);
    if (!t) {
      t = {
        key,
        level,
        ox: (ix + 0.5) * s,
        oy: (iy + 0.5) * s,
        bbox: emptyBBox(),
        batches: new Map(),
        batchList: [],
        texts: [],
        points: [],
        hatches: [],
        images: [],
        count: 0,
      };
      this.scene.tiles.set(key, t);
      this.scene.tileList.push(t);
    }
    return t;
  }

  /** Pass 1: bounding boxes, extents and the base tile size. */
  prepare(): void {
    const ms = this.doc.tableRecords.find((r) => r.table === 'BLOCK_RECORD' && /^\*model_space$/i.test(r.name));
    if (this.scene.items === this.doc.modelSpace && ms?.handle) {
      const ordered = this.sorted(this.scene.items, ms.handle);
      if (ordered !== this.scene.items) {
        this.scene.items = ordered;
        this.itemIndex.clear();
        ordered.forEach((id, k) => this.itemIndex.set(id, k));
      }
    }
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
    const robust = (arr: number[]) => {
      if (!arr.length) return 1;
      const s = [...arr].sort((a, b) => a - b);
      const lo = s[Math.floor(s.length * 0.02)];
      const hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.98))];
      return hi - lo;
    };
    const span = Math.max(robust(centersX), robust(centersY));
    const divisions = Math.max(4, Math.min(64, Math.round(Math.sqrt(Math.max(1, items.length) / 64))));
    this.scene.baseTileSize = span > 0 ? span / divisions : 1;
  }

  /** World bounds of an entity (top-level items, attributes); null if unknown. */
  boundsOf(id: number): BBox | null {
    const k = this.itemIndex.get(id);
    const ib = this.scene.itemBBox;
    if (k !== undefined) {
      if (Number.isNaN(ib[k * 4])) return null;
      return { minX: ib[k * 4], minY: ib[k * 4 + 1], maxX: ib[k * 4 + 2], maxY: ib[k * 4 + 3] };
    }
    const e = this.doc.entities[id];
    if (e && typeof e.parentInsert === 'number') return this.entityBBox(e, identity(), false);
    return null;
  }

  get done(): boolean {
    return this.next >= this.scene.items.length;
  }

  get progress(): number {
    return this.scene.items.length ? this.next / this.scene.items.length : 1;
  }

  /** Pass 2: emit geometry until `deadline`. Returns true when finished. */
  step(deadline: number, now: () => number): boolean {
    const { items, itemBBox } = this.scene;
    while (this.next < items.length) {
      const k = this.next++;
      const e = this.doc.entities[items[k]];
      const infinite = e.type === 'XLINE' || e.type === 'RAY';
      if (Number.isNaN(itemBBox[k * 4]) && !infinite) {
        this.cover(e.type, 'none', false);
        if (!NATIVE_TYPES.has(e.type) && !TEXT_TYPES.has(e.type) && !DIM_TYPES.has(e.type) && e.type !== 'INSERT' && !e.invisible) {
          this.diag('not-rendered', `${e.type} entities are not rendered`);
        }
        continue;
      }
      const b: BBox = infinite ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX: itemBBox[k * 4], minY: itemBBox[k * 4 + 1], maxX: itemBBox[k * 4 + 2], maxY: itemBBox[k * 4 + 3] };
      this.topBBox = b;
      if (!this.scene.strict) {
        this.topTile = this.tileFor(b);
        bboxUnion(this.topTile.bbox, b);
      }
      this.emitTop(e);
      if ((k & 63) === 0 && now() > deadline) break;
    }
    return this.done;
  }

  private emitTop(e: Entity): void {
    if (e.type === 'INSERT' || DIM_TYPES.has(e.type) || e.type === 'ACAD_TABLE') {
      const cost = this.entityCount(e);
      if (cost > this.budgetLeft) {
        this.scene.budgetExceeded++;
        this.diag('budget', `Block reference expansion exceeds the budget; drawing bounding frames instead`, e.handle);
        this.emitFrame(e);
        this.cover(e.type, 'frame', true);
        return;
      }
      this.budgetLeft -= cost;
    }
    this.alphaFactor = this.filter?.dimTop?.has(e.id) ? DIM_ALPHA : 1;
    this.emitAny(e, identity(), TOP_CTX, 0, false);
    this.alphaFactor = 1;
  }

  private emitFrame(e: Entity): void {
    const k = this.itemIndex.get(e.id)!;
    const ib = this.scene.itemBBox;
    this.use(e, TOP_CTX);
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
  }

  private emitAny(e: Entity, m: Mat34, ctx: InheritCtx, depth: number, inBlock: boolean): void {
    if (e.invisible) return;
    const styles = this.scene.styles;
    if (depth > 0 || !e.virtual) styles.layers[styles.layerIdx(styles.effectiveLayer(e, ctx))].count++;
    if (e.type === 'INSERT') {
      this.emitInsert(e as InsertEntity, m, ctx, depth);
      return;
    }
    if (e.type === 'VIEWPORT') {
      this.emitViewport(e, m, ctx);
      if (depth === 0) this.cover(e.type, 'native', true);
      return;
    }
    if (DIM_TYPES.has(e.type)) {
      const d = e as DimensionEntity;
      const block = this.doc.blocks.get(nameKey(d.blockName));
      if (!block || !block.entities.length) {
        emitDimensionFallback(this, d, m, ctx, depth);
        if (depth === 0) this.cover(e.type, 'native', true);
        if (!block) this.diag('dimension-block', `${e.type} without geometry block: drawn from definition points`, e.handle);
        return;
      }
      const child = styles.childCtx(e, ctx, 1);
      this.block(d.blockName, multiply(m, this.dimensionMatrix(d)), e, child, depth);
      if (depth === 0) this.cover(e.type, 'block', true);
      return;
    }
    if (this.filter?.leaf && e.type !== 'ACAD_TABLE') {
      const match = this.filter.leaf(e, ctx, this.blockNames);
      if (!match) {
        if (this.filter.leafMode !== 'dim') return;
        const prev = this.alphaFactor;
        this.alphaFactor = DIM_ALPHA;
        this.emitLeaf(e, m, ctx, depth, inBlock);
        this.alphaFactor = prev;
        return;
      }
    }
    this.emitLeaf(e, m, ctx, depth, inBlock);
  }

  private emitLeaf(e: Entity, m: Mat34, ctx: InheritCtx, depth: number, inBlock: boolean): void {
    if (TEXT_TYPES.has(e.type)) {
      if (!this.textVisible(e, inBlock)) return;
      const st = this.use(e, ctx);
      const p = this.placedText(e);
      if (p) this.text(p, m, st, e.id);
      if (depth === 0) this.cover(e.type, 'text', !!p);
      return;
    }
    if (e.type === 'POINT') {
      const st = this.use(e, ctx);
      this.point(applyPoint(m, ...(e as PointEntity).position), st, e.id);
      if (depth === 0) this.cover(e.type, 'native', true);
      return;
    }
    if (NATIVE_TYPES.has(e.type)) {
      this.use(e, ctx);
      const before = this.out.emitted;
      const ok = emitEntity(e, this.out, m, this.emitOpts);
      this.scene.primitives += this.out.emitted - before;
      if (depth === 0) this.cover(e.type, 'native', ok);
      return;
    }
    const before = this.out.emitted;
    const ok = COMPLEX_TYPES.has(e.type) ? emitComplex(this, e, m, ctx, depth) : emitProxy(this, e, m, ctx, depth);
    this.scene.primitives += this.out.emitted - before;
    if (depth === 0) this.cover(e.type, COMPLEX_TYPES.has(e.type) ? complexMethod(e.type) : 'proxy', ok);
    if (!ok) this.diag('not-rendered', `${e.type} entities are not rendered`);
  }

  private emitViewport(e: Entity, m: Mat34, ctx: InheritCtx): void {
    const v = e as Entity & {
      center: Vec3;
      width: number;
      height: number;
      status: number;
      vpId: number;
      viewCenter: Vec3;
      viewHeight: number;
      twist: number;
      viewTarget?: Vec3;
      viewDirection?: Vec3;
      frozenLayers: string[];
      clipBoundary?: string;
      statusFlags?: number;
    };
    // id 1 is the paper space "overall" viewport; status 0 = off
    if (v.vpId === 1 || v.status === 0 || !(v.width > 0) || !(v.height > 0)) return;
    const st = this.use(e, ctx);
    const layerNames: string[] = [];
    for (const h of v.frozenLayers) {
      const hu = h.toUpperCase();
      for (const l of this.doc.layers.values()) if (l.handle?.toUpperCase() === hu) layerNames.push(l.name);
    }
    let clip: PathLike | undefined;
    const clipEntity = v.clipBoundary && (v.statusFlags ?? 0) & 0x10000 ? this.doc.handles.get(v.clipBoundary.toUpperCase()) : undefined;
    if (clipEntity?.kind === 'entity') {
      const path = this.factory();
      const po = new SinglePathOut(path);
      emitEntity(this.doc.entities[clipEntity.index], po, m, { fill: false });
      clip = path;
    }
    const c = applyPoint(m, v.center[0], v.center[1], v.center[2]);
    const dir = v.viewDirection ?? [0, 0, 1];
    this.scene.viewports.push({
      entity: e.id,
      cx: c[0],
      cy: c[1],
      width: v.width,
      height: v.height,
      viewCx: v.viewCenter[0],
      viewCy: v.viewCenter[1],
      viewHeight: v.viewHeight || v.height,
      twist: (v.twist || 0) * DEG,
      target: v.viewTarget ?? [0, 0, 0],
      frozenLayers: layerNames,
      clip,
      plan: Math.abs(dir[0]) < 1e-9 && Math.abs(dir[1]) < 1e-9,
      style: st,
    });
    if (!clip) {
      // viewport border (the clip entity draws itself when present)
      this.out.setMatrix(identity());
      this.out.beginPath('stroke');
      const hw = v.width / 2;
      const hh = v.height / 2;
      this.out.moveTo(c[0] - hw, c[1] - hh, 0);
      this.out.lineTo(c[0] + hw, c[1] - hh, 0);
      this.out.lineTo(c[0] + hw, c[1] + hh, 0);
      this.out.lineTo(c[0] - hw, c[1] + hh, 0);
      this.out.closePath();
      this.out.endPath();
    }
    if (!(Math.abs(dir[0]) < 1e-9 && Math.abs(dir[1]) < 1e-9)) this.diag('viewport-3d', 'Viewport with a non-plan view direction is shown as plan view', e.handle);
  }

  private emitInsert(ins: InsertEntity, m: Mat34, ctx: InheritCtx, depth: number): void {
    const styles = this.scene.styles;
    const block = this.doc.blocks.get(nameKey(ins.name));
    if (!block) {
      this.diag('missing-block', `Block "${ins.name}" is not defined`, ins.handle);
      if (depth === 0) this.cover(ins.type, 'block', false);
    } else if (depth >= this.opts.maxDepth || this.blockStack.includes(nameKey(ins.name))) {
      this.diag('block-recursion', `Block "${ins.name}" is nested too deeply or references itself`, ins.handle);
    } else {
      if (block.flags & 4) this.diag('xref', `External reference "${ins.name}" (${block.xrefPath ?? ''}) is not loaded`, ins.handle);
      const sx = Math.abs(ins.scale[0] || 1);
      const sy = Math.abs(ins.scale[1] || 1);
      const child = styles.childCtx(ins, ctx, Math.sqrt(sx * sy));
      // XCLIP: draw the block contents into a clipped group
      const clip = !this.clipTile ? this.clipPolygon(ins, m) : null;
      const prevClip = this.clipTile;
      if (clip) {
        const cb = emptyBBox();
        for (const p of clip) bboxAddPoint(cb, p[0], p[1]);
        const ct = this.newTile('clip', [(cb.minX + cb.maxX) / 2, (cb.minY + cb.maxY) / 2]);
        const path = this.factory();
        clip.forEach((p, i) => (i === 0 ? path.moveTo(p[0] - ct.ox, p[1] - ct.oy) : path.lineTo(p[0] - ct.ox, p[1] - ct.oy)));
        path.closePath();
        ct.clip = path;
        ct.bbox = cb;
        this.clipTile = ct;
      }
      for (const bm of this.insertMatrices(ins, block)) this.block(ins.name, multiply(m, bm), ins, child, depth);
      this.clipTile = prevClip;
      if (depth === 0) this.cover(ins.type, 'block', true);
    }
    // attributes are positioned in their own coordinates (not block space)
    const attrCtx = block ? styles.childCtx(ins, ctx, 1) : ctx;
    for (const a of ins.attribs) this.emitAny(a, m, { ...attrCtx, layer: ctx.layer }, depth + 1, false);
  }
}

/** Whether the drawing needs file draw order (wipeouts, images, masked MTEXT). */
function hasOccluders(doc: DxfDocument): boolean {
  for (const e of doc.entities) {
    if (OCCLUDERS.has(e.type)) return true;
    if (e.type === 'MTEXT' && ((e as MTextEntity).bgFlags & 3) !== 0) return true;
  }
  return false;
}

/** One-color gradient tint: 0 = black … 0.5 = color … 1 = white. */
function tint(rgb: number, t: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const mix = (c: number) => (t >= 0.5 ? c + (255 - c) * (t - 0.5) * 2 : c * t * 2);
  return (Math.round(mix(r)) << 16) | (Math.round(mix(g)) << 8) | Math.round(mix(b));
}
