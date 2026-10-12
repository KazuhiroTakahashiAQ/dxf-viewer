import type { HatchEntity } from '../dxf/entities/hatch';
import { nameKey, type DimensionEntity, type DxfDocument, type Entity, type InsertEntity, type MTextEntity, type PointEntity, type TextEntity } from '../dxf/model';
import { applyPoint, identity, multiply, rotationZ, scaling, translation, type Mat34 } from '../geom/matrix';
import { ocsToWcs } from '../geom/ocs';
import { DEG, type Vec3 } from '../geom/vec';
import { COMPLEX_TYPES, emitComplex, emitDimensionFallback, emitProxy } from './complex';
import { emitEntity } from './emit';
import { buildHatchPath } from './hatchGeom';
import type { EmitHost, ImageBuild } from './host';
import { FlattenOut } from './measure';
import type { PathLike } from './scene';
import { TOP_CTX, type InheritCtx, type Style, type StyleResolver } from './style';
import { layoutMText, layoutText, type PlacedText, type TextMeasurer } from './textLayout';

/** Adapts canvas-style path calls (2D, hatch-local) to a projector. */
class PathAdapter implements PathLike {
  constructor(
    private out: FlattenOut,
    private ox: number,
    private oy: number,
  ) {}
  moveTo(x: number, y: number): void {
    this.out.moveTo(x + this.ox, y + this.oy, 0);
  }
  lineTo(x: number, y: number): void {
    this.out.lineTo(x + this.ox, y + this.oy, 0);
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.out.cubicTo(x1 + this.ox, y1 + this.oy, 0, x2 + this.ox, y2 + this.oy, 0, x + this.ox, y + this.oy, 0);
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    this.out.quadTo(x1 + this.ox, y1 + this.oy, 0, x + this.ox, y + this.oy, 0);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, start: number, end: number, ccw?: boolean): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const u: Vec3 = [rx * c, rx * s, 0];
    let v: Vec3 = [-ry * s, ry * c, 0];
    let t0 = start;
    let t1 = end;
    if (ccw) {
      // canvas anticlockwise: decreasing angle → mirror v and negate params
      v = [-v[0], -v[1], 0];
      t0 = -start;
      t1 = -end;
    }
    while (t1 < t0) t1 += Math.PI * 2;
    this.out.arc(cx + this.ox, cy + this.oy, 0, u[0], u[1], 0, v[0], v[1], 0, t0, t1);
  }
  closePath(): void {
    this.out.closePath();
  }
}

/** Thrown when flattening one entity needs more than FLATTEN_BUDGET entity visits. */
export class FlattenBudgetError extends Error {
  constructor() {
    super('flatten budget exceeded');
  }
}

/**
 * Entity visits allowed per flattened entity: nested MINSERT arrays can expand
 * to billions of entities, which would exhaust the worker's memory.
 */
export const FLATTEN_BUDGET = 200_000;

export interface FlattenContext {
  doc: DxfDocument;
  measurer: TextMeasurer;
  styles: StyleResolver;
}

/**
 * EmitHost that flattens everything into polylines (world XY) — used for
 * picking distances, selection highlights, lengths and areas.
 */
export class FlattenHost implements EmitHost {
  readonly out = new FlattenOut();
  readonly fill = true;
  infiniteLines: { x: number; y: number; dx: number; dy: number; ray: boolean }[] = [];
  private stack: string[] = [];
  private visits = 0;

  constructor(private c: FlattenContext) {}

  get doc() {
    return this.c.doc;
  }
  get measurer() {
    return this.c.measurer;
  }
  get styles() {
    return this.c.styles;
  }

  reset(): void {
    this.out.reset();
    this.infiniteLines = [];
    this.stack = [];
    this.visits = 0;
  }

  use(e: Entity, ctx: InheritCtx): Style {
    return this.c.styles.resolve(e, ctx);
  }
  useStyle(): void {}

  text(p: PlacedText, m: Mat34): void {
    const full = multiply(m, p.matrix);
    const L = p.layout;
    const bg = L.background;
    const x0 = Math.min(L.minX, bg?.minX ?? Infinity);
    const x1 = Math.max(L.maxX, bg?.maxX ?? -Infinity);
    const y0 = Math.min(L.minY, bg?.minY ?? Infinity);
    const y1 = Math.max(L.maxY, bg?.maxY ?? -Infinity);
    this.out.setMatrix(full);
    this.out.beginPath('fill');
    this.out.moveTo(x0, y0, 0);
    this.out.lineTo(x1, y0, 0);
    this.out.lineTo(x1, y1, 0);
    this.out.lineTo(x0, y1, 0);
    this.out.closePath();
    this.out.endPath();
  }

  hatch(h: HatchEntity, m: Mat34): void {
    this.out.setMatrix(m);
    this.out.beginPath('fill');
    buildHatchPath(h, new PathAdapter(this.out, 0, 0), 0, 0, h.style === 2);
    this.out.endPath();
  }

  image(item: ImageBuild): void {
    const pts = item.clip ?? item.corners;
    this.out.setMatrix(identity());
    this.out.beginPath(item.wipeout ? 'fill' : 'stroke');
    pts.forEach((p, i) => (i === 0 ? this.out.moveTo(p[0], p[1], 0) : this.out.lineTo(p[0], p[1], 0)));
    this.out.closePath();
    this.out.endPath();
  }

  infinite(base: Vec3, dir: Vec3, ray: boolean): void {
    const len = Math.hypot(dir[0], dir[1]);
    if (len > 1e-12) this.infiniteLines.push({ x: base[0], y: base[1], dx: dir[0] / len, dy: dir[1] / len, ray });
  }

  point(p: Vec3): void {
    this.out.setMatrix(identity());
    this.out.beginPath('stroke');
    this.out.moveTo(p[0], p[1], 0);
    this.out.endPath();
  }

  block(name: string, m: Mat34, _owner: Entity, ctx: InheritCtx, depth: number): boolean {
    const key = nameKey(name);
    const block = this.c.doc.blocks.get(key);
    if (!block || depth > 32 || this.stack.includes(key)) return false;
    this.stack.push(key);
    for (const id of block.entities) this.visit(this.c.doc.entities[id], m, ctx, depth + 1, true);
    this.stack.pop();
    return true;
  }

  child(e: Entity, m: Mat34, ctx: InheritCtx, depth: number): void {
    this.visit(e, m, ctx, depth, true);
  }

  diag(): void {}

  /** Flatten one entity (recursively for block references). */
  visit(e: Entity, m: Mat34, ctx: InheritCtx = TOP_CTX, depth = 0, inBlock = false): void {
    if (++this.visits > FLATTEN_BUDGET) throw new FlattenBudgetError();
    if (e.invisible) return;
    const styleOf = (n: string) => this.c.doc.styles.get(nameKey(n));
    switch (e.type) {
      case 'INSERT': {
        const ins = e as InsertEntity;
        const block = this.c.doc.blocks.get(nameKey(ins.name));
        if (block) {
          const base = multiply(multiply(ocsToWcs(ins.extrusion), translation(ins.insert[0], ins.insert[1], ins.insert[2])), rotationZ((ins.rotation || 0) * DEG));
          const tail = multiply(scaling(ins.scale[0] || 1, ins.scale[1] || 1, ins.scale[2] || 1), translation(-block.base[0], -block.base[1], -block.base[2]));
          const rows = Math.min(100, Math.max(1, ins.rows | 0));
          const cols = Math.min(100, Math.max(1, ins.columns | 0));
          for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
              const grid = multiply(base, translation(c * (ins.columnSpacing || 0), r * (ins.rowSpacing || 0), 0));
              this.block(ins.name, multiply(m, multiply(grid, tail)), e, ctx, depth);
            }
        }
        for (const a of ins.attribs) this.visit(a, m, ctx, depth + 1, false);
        return;
      }
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION': {
        const d = e as DimensionEntity;
        if (this.c.doc.blocks.has(nameKey(d.blockName))) {
          const ocs = ocsToWcs(d.extrusion);
          const ins = applyPoint(ocs, d.cloneInsert[0], d.cloneInsert[1], d.cloneInsert[2]);
          const dm = multiply(translation(ins[0], ins[1], ins[2]), multiply(ocs, translation(0, 0, d.textMidpoint?.[2] ?? 0)));
          this.block(d.blockName, multiply(m, dm), e, ctx, depth);
        } else emitDimensionFallback(this, d, m, ctx, depth);
        return;
      }
      case 'TEXT':
      case 'ATTRIB':
      case 'ATTDEF':
      case 'MTEXT': {
        if (e.type === 'ATTRIB' && ((e as TextEntity).attribFlags ?? 0) & 1) return;
        if (e.type === 'ATTDEF' && inBlock && !(((e as TextEntity).attribFlags ?? 0) & 2)) return;
        let p: PlacedText | null = null;
        if (e.type === 'MTEXT') p = layoutMText(e as MTextEntity, styleOf, this.c.measurer);
        else {
          const t = e as TextEntity;
          p = t.mtext ? layoutMText({ ...t.mtext, style: t.mtext.style || t.style } as MTextEntity, styleOf, this.c.measurer) : layoutText(t, styleOf(t.style), this.c.measurer, t.type === 'ATTDEF' && !t.block ? (t.tag ?? t.text) : t.text);
        }
        if (p) this.text(p, m);
        return;
      }
      case 'POINT':
        this.point(applyPoint(m, ...(e as PointEntity).position));
        return;
      case 'VIEWPORT': {
        const v = e as Entity & { center: Vec3; width: number; height: number; vpId: number };
        if (v.vpId === 1) return;
        this.out.setMatrix(m);
        this.out.beginPath('stroke');
        const [cx, cy] = v.center;
        this.out.moveTo(cx - v.width / 2, cy - v.height / 2, 0);
        this.out.lineTo(cx + v.width / 2, cy - v.height / 2, 0);
        this.out.lineTo(cx + v.width / 2, cy + v.height / 2, 0);
        this.out.lineTo(cx - v.width / 2, cy + v.height / 2, 0);
        this.out.closePath();
        this.out.endPath();
        return;
      }
      default:
        if (emitEntity(e, this.out, m, { fill: true })) return;
        if (COMPLEX_TYPES.has(e.type)) emitComplex(this, e, m, ctx, depth);
        else emitProxy(this, e, m, ctx, depth);
    }
  }

  /** Distance from a world point to the flattened geometry. */
  distance(px: number, py: number): number {
    let d = this.out.distance(px, py);
    for (const l of this.infiniteLines) {
      const t = (px - l.x) * l.dx + (py - l.y) * l.dy;
      const tt = l.ray ? Math.max(0, t) : t;
      d = Math.min(d, Math.hypot(l.x + l.dx * tt - px, l.y + l.dy * tt - py));
    }
    return d;
  }
}
