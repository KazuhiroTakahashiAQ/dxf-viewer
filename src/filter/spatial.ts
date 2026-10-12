import { pointInPolygon } from '../scene/measure';
import type { SpatialSpec } from '../shared/filterSpec';

/** Flattened geometry of an entity in world coordinates. */
export interface FlatGeometry {
  polylines: number[][];
  fills: boolean[];
  infinite: { x: number; y: number; dx: number; dy: number; ray: boolean }[];
}

export interface Region {
  /** closed polygon, flat [x, y, …] */
  poly: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  mode: 'inside' | 'crossing';
}

export function regionOf(sp: SpatialSpec): Region {
  const poly =
    sp.kind === 'rect'
      ? [Math.min(sp.minX, sp.maxX), Math.min(sp.minY, sp.maxY), Math.max(sp.minX, sp.maxX), Math.min(sp.minY, sp.maxY), Math.max(sp.minX, sp.maxX), Math.max(sp.minY, sp.maxY), Math.min(sp.minX, sp.maxX), Math.max(sp.minY, sp.maxY)]
      : sp.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]);
    maxX = Math.max(maxX, poly[i]);
    minY = Math.min(minY, poly[i + 1]);
    maxY = Math.max(maxY, poly[i + 1]);
  }
  return { poly, minX, minY, maxX, maxY, mode: sp.mode };
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  return Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by);
}

/** Closed-segment intersection test (touching counts). */
export function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

function crossesBoundary(r: Region, ax: number, ay: number, bx: number, by: number): boolean {
  if (Math.max(ax, bx) < r.minX || Math.min(ax, bx) > r.maxX || Math.max(ay, by) < r.minY || Math.min(ay, by) > r.maxY) return false;
  const p = r.poly;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (segmentsIntersect(ax, ay, bx, by, p[j], p[j + 1], p[i], p[i + 1])) return true;
  return false;
}

const insideRegion = (r: Region, x: number, y: number) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY && pointInPolygon(x, y, r.poly);

/** Quick classification of an axis-aligned box against the region. */
export function boxRelation(r: Region, minX: number, minY: number, maxX: number, maxY: number): 'out' | 'in' | 'partial' {
  if (maxX < r.minX || minX > r.maxX || maxY < r.minY || minY > r.maxY) return 'out';
  const corners = [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
  for (let i = 0; i < 8; i += 2) if (!insideRegion(r, corners[i], corners[i + 1])) return 'partial';
  for (let i = 0; i < 8; i += 2) if (crossesBoundary(r, corners[i], corners[i + 1], corners[(i + 2) % 8], corners[(i + 3) % 8])) return 'partial';
  return 'in';
}

/**
 * Exact test of flattened geometry against the region:
 * inside = every vertex inside and no segment leaves the region;
 * crossing = anything inside or touching (incl. the region lying within a filled shape).
 */
export function geometryInRegion(g: FlatGeometry, r: Region): boolean {
  if (r.mode === 'inside') {
    if (g.infinite.length) return false;
    let any = false;
    for (const pl of g.polylines) {
      for (let i = 0; i < pl.length; i += 2) {
        any = true;
        if (!insideRegion(r, pl[i], pl[i + 1])) return false;
        if (i + 3 < pl.length && crossesBoundary(r, pl[i], pl[i + 1], pl[i + 2], pl[i + 3])) {
          // touching the boundary from inside is fine; leaving it is not
          const mx = (pl[i] + pl[i + 2]) / 2;
          const my = (pl[i + 1] + pl[i + 3]) / 2;
          if (!insideRegion(r, mx, my)) return false;
        }
      }
    }
    return any;
  }
  for (let k = 0; k < g.polylines.length; k++) {
    const pl = g.polylines[k];
    for (let i = 0; i < pl.length; i += 2) {
      if (insideRegion(r, pl[i], pl[i + 1])) return true;
      if (i + 3 < pl.length && crossesBoundary(r, pl[i], pl[i + 1], pl[i + 2], pl[i + 3])) return true;
    }
    if (g.fills[k] && pl.length >= 6 && pointInPolygon(r.poly[0], r.poly[1], pl)) return true;
  }
  for (const l of g.infinite) {
    // clip the infinite line to a segment that spans the region's box
    const span = Math.hypot(r.maxX - r.minX, r.maxY - r.minY) + Math.hypot(l.x - (r.minX + r.maxX) / 2, l.y - (r.minY + r.maxY) / 2);
    const t0 = l.ray ? 0 : -span;
    if (crossesBoundary(r, l.x + l.dx * t0, l.y + l.dy * t0, l.x + l.dx * span, l.y + l.dy * span)) return true;
    if (insideRegion(r, l.x, l.y)) return true;
  }
  return false;
}
