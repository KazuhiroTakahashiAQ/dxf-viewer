import { affineArcBounds } from '../geom/ellipse';
import type { Mat34 } from '../geom/matrix';

/**
 * Geometry sink. Emitters describe entity geometry in their local 3D
 * coordinates; implementations apply a transform and project to the XY plane.
 *
 * Arcs use the affine form p(t) = c + u·cos t + v·sin t with t1 >= t0.
 */
export interface GeoOut {
  beginPath(kind: 'stroke' | 'fill'): void;
  moveTo(x: number, y: number, z: number): void;
  lineTo(x: number, y: number, z: number): void;
  arc(cx: number, cy: number, cz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, t0: number, t1: number): void;
  cubicTo(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x: number, y: number, z: number): void;
  quadTo(x1: number, y1: number, z1: number, x: number, y: number, z: number): void;
  closePath(): void;
  endPath(): void;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function bboxValid(b: BBox): boolean {
  return b.minX <= b.maxX && b.minY <= b.maxY;
}

export function bboxUnion(a: BBox, b: BBox): void {
  if (b.minX < a.minX) a.minX = b.minX;
  if (b.minY < a.minY) a.minY = b.minY;
  if (b.maxX > a.maxX) a.maxX = b.maxX;
  if (b.maxY > a.maxY) a.maxY = b.maxY;
}

export function bboxAddPoint(b: BBox, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

/** Applies a 3x4 transform and forwards projected 2D coordinates. */
export abstract class Projector implements GeoOut {
  m!: Mat34;

  setMatrix(m: Mat34): void {
    this.m = m;
  }

  protected px(x: number, y: number, z: number): number {
    const m = this.m;
    return m[0] * x + m[1] * y + m[2] * z + m[3];
  }
  protected py(x: number, y: number, z: number): number {
    const m = this.m;
    return m[4] * x + m[5] * y + m[6] * z + m[7];
  }

  abstract beginPath(kind: 'stroke' | 'fill'): void;
  abstract endPath(): void;
  abstract closePath(): void;
  protected abstract move2(x: number, y: number): void;
  protected abstract line2(x: number, y: number): void;
  protected abstract arc2(cx: number, cy: number, ux: number, uy: number, vx: number, vy: number, t0: number, t1: number): void;
  protected abstract cubic2(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  protected abstract quad2(x1: number, y1: number, x: number, y: number): void;

  moveTo(x: number, y: number, z: number): void {
    this.move2(this.px(x, y, z), this.py(x, y, z));
  }
  lineTo(x: number, y: number, z: number): void {
    this.line2(this.px(x, y, z), this.py(x, y, z));
  }
  arc(cx: number, cy: number, cz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, t0: number, t1: number): void {
    const m = this.m;
    this.arc2(
      this.px(cx, cy, cz),
      this.py(cx, cy, cz),
      m[0] * ux + m[1] * uy + m[2] * uz,
      m[4] * ux + m[5] * uy + m[6] * uz,
      m[0] * vx + m[1] * vy + m[2] * vz,
      m[4] * vx + m[5] * vy + m[6] * vz,
      t0,
      t1,
    );
  }
  cubicTo(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x: number, y: number, z: number): void {
    this.cubic2(this.px(x1, y1, z1), this.py(x1, y1, z1), this.px(x2, y2, z2), this.py(x2, y2, z2), this.px(x, y, z), this.py(x, y, z));
  }
  quadTo(x1: number, y1: number, z1: number, x: number, y: number, z: number): void {
    this.quad2(this.px(x1, y1, z1), this.py(x1, y1, z1), this.px(x, y, z), this.py(x, y, z));
  }
}

/** Accumulates the 2D bounding box of all emitted geometry. */
export class BBoxOut extends Projector {
  b: BBox = emptyBBox();
  /** number of primitives emitted (used for expansion budgets) */
  count = 0;

  reset(): void {
    this.b = emptyBBox();
    this.count = 0;
  }
  beginPath(): void {
    this.count++;
  }
  endPath(): void {}
  closePath(): void {}
  protected move2(x: number, y: number): void {
    bboxAddPoint(this.b, x, y);
  }
  protected line2(x: number, y: number): void {
    bboxAddPoint(this.b, x, y);
  }
  protected arc2(cx: number, cy: number, ux: number, uy: number, vx: number, vy: number, t0: number, t1: number): void {
    affineArcBounds(cx, cy, ux, uy, vx, vy, t0, t1, this.b);
  }
  protected cubic2(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    // control polygon hull is a conservative bound
    bboxAddPoint(this.b, x1, y1);
    bboxAddPoint(this.b, x2, y2);
    bboxAddPoint(this.b, x, y);
  }
  protected quad2(x1: number, y1: number, x: number, y: number): void {
    bboxAddPoint(this.b, x1, y1);
    bboxAddPoint(this.b, x, y);
  }
}
