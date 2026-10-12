import { distToSegmentSq } from '../geom/vec';
import { Projector } from './geoOut';

/** Number of samples for a curve piece of the given angular sweep. */
function samplesFor(sweep: number): number {
  return Math.min(256, Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 64))));
}

/** 8-point Gauss–Legendre nodes/weights on [-1, 1]. */
const GL_X = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

/** ∫ f over [a, b] with composite Gauss–Legendre (`pieces` sub-intervals). */
function integrate(f: (t: number) => number, a: number, b: number, pieces: number): number {
  let sum = 0;
  const h = (b - a) / pieces;
  for (let k = 0; k < pieces; k++) {
    const m = a + h * (k + 0.5);
    for (let i = 0; i < 8; i++) sum += GL_W[i] * f(m + (h / 2) * GL_X[i]);
  }
  return (sum * h) / 2;
}

/**
 * Flattens emitted geometry into polylines (world XY). Used for picking
 * distances, lengths and areas. Arcs and curves are sampled finely for
 * hit-testing, while length and area are accumulated exactly from the
 * analytic primitives (arc length / Green's theorem; Gauss–Legendre for
 * ellipse arcs and Bézier pieces).
 */
export class FlattenOut extends Projector {
  /** list of polylines: flat [x0,y0,x1,y1,...] */
  polylines: number[][] = [];
  /** which polylines are fills / closed */
  closed: boolean[] = [];
  fills: boolean[] = [];
  /** exact length and 2× signed area (∮ x dy − y dx) per polyline */
  private lens: number[] = [];
  private green: number[] = [];
  /** fill paths emitted together (even-odd region) share a group id */
  private groups: number[] = [];
  private group = 0;
  private cur: number[] | null = null;
  private kind: 'stroke' | 'fill' = 'stroke';
  private cx = 0;
  private cy = 0;
  private sx = 0;
  private sy = 0;

  reset(): void {
    this.polylines = [];
    this.closed = [];
    this.fills = [];
    this.lens = [];
    this.green = [];
    this.groups = [];
    this.cur = null;
  }
  beginPath(kind: 'stroke' | 'fill'): void {
    this.kind = kind;
    this.cur = null;
    this.group++;
  }
  endPath(): void {
    this.cur = null;
  }
  closePath(): void {
    if (this.cur) {
      this.account(this.cx, this.cy, this.sx, this.sy);
      this.cur.push(this.sx, this.sy);
      this.cx = this.sx;
      this.cy = this.sy;
      this.closed[this.closed.length - 1] = true;
    }
  }
  private start(x: number, y: number): void {
    this.cur = [x, y];
    this.polylines.push(this.cur);
    this.closed.push(false);
    this.fills.push(this.kind === 'fill');
    this.lens.push(0);
    this.green.push(0);
    this.groups.push(this.group);
    this.sx = x;
    this.sy = y;
    this.cx = x;
    this.cy = y;
  }
  /** straight piece from (x0, y0) to (x1, y1) of the current polyline */
  private account(x0: number, y0: number, x1: number, y1: number): void {
    const k = this.lens.length - 1;
    this.lens[k] += Math.hypot(x1 - x0, y1 - y0);
    // relative to the start point keeps precision with large coordinates
    this.green[k] += (x0 - this.sx) * (y1 - this.sy) - (x1 - this.sx) * (y0 - this.sy);
  }
  private push(x: number, y: number): void {
    this.cur!.push(x, y);
    this.cx = x;
    this.cy = y;
  }
  private add(x: number, y: number): void {
    if (!this.cur) this.start(this.cx, this.cy);
    this.account(this.cx, this.cy, x, y);
    this.push(x, y);
  }
  protected move2(x: number, y: number): void {
    this.start(x, y);
  }
  protected line2(x: number, y: number): void {
    this.add(x, y);
  }
  protected arc2(cx: number, cy: number, ux: number, uy: number, vx: number, vy: number, t0: number, t1: number): void {
    const n = samplesFor(t1 - t0);
    const sx = cx + ux * Math.cos(t0) + vx * Math.sin(t0);
    const sy = cy + uy * Math.cos(t0) + vy * Math.sin(t0);
    if (!this.cur) this.start(sx, sy);
    else this.add(sx, sy);
    const k = this.lens.length - 1;
    // exact length: circle r·|Δt|, ellipse by quadrature of |p'(t)|
    const uu = ux * ux + uy * uy;
    const vv = vx * vx + vy * vy;
    const uv = ux * vx + uy * vy;
    if (Math.abs(uu - vv) <= 1e-12 * uu && Math.abs(uv) <= 1e-12 * uu) this.lens[k] += Math.sqrt(uu) * Math.abs(t1 - t0);
    else
      this.lens[k] += Math.abs(
        integrate(
          (t) => {
            const s = Math.sin(t);
            const c = Math.cos(t);
            return Math.hypot(-ux * s + vx * c, -uy * s + vy * c);
          },
          t0,
          t1,
          Math.max(4, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 8))),
        ),
      );
    // Green: ∫ cross(p − s, p') dt = cross(c − s, u(cos t1 − cos t0) + v(sin t1 − sin t0)) + cross(u, v)(t1 − t0)
    const dcx = cx - this.sx;
    const dcy = cy - this.sy;
    const wx = ux * (Math.cos(t1) - Math.cos(t0)) + vx * (Math.sin(t1) - Math.sin(t0));
    const wy = uy * (Math.cos(t1) - Math.cos(t0)) + vy * (Math.sin(t1) - Math.sin(t0));
    this.green[k] += dcx * wy - dcy * wx + (ux * vy - uy * vx) * (t1 - t0);
    for (let i = 1; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      this.push(cx + ux * Math.cos(t) + vx * Math.sin(t), cy + uy * Math.cos(t) + vy * Math.sin(t));
    }
    // land exactly on the analytic end point
    this.cx = cx + ux * Math.cos(t1) + vx * Math.sin(t1);
    this.cy = cy + uy * Math.cos(t1) + vy * Math.sin(t1);
  }
  /** exact accounting of a polynomial piece p(t), t ∈ [0, 1] */
  private accountCurve(px: (t: number) => number, py: (t: number) => number, dx: (t: number) => number, dy: (t: number) => number): void {
    const k = this.lens.length - 1;
    this.lens[k] += integrate((t) => Math.hypot(dx(t), dy(t)), 0, 1, 8);
    this.green[k] += integrate((t) => (px(t) - this.sx) * dy(t) - (py(t) - this.sy) * dx(t), 0, 1, 1);
  }
  protected cubic2(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!this.cur) this.start(this.cx, this.cy);
    const x0 = this.cx;
    const y0 = this.cy;
    const b = (a0: number, a1: number, a2: number, a3: number) => (t: number) => {
      const u = 1 - t;
      return u * u * u * a0 + 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t * a3;
    };
    const d = (a0: number, a1: number, a2: number, a3: number) => (t: number) => {
      const u = 1 - t;
      return 3 * (u * u * (a1 - a0) + 2 * u * t * (a2 - a1) + t * t * (a3 - a2));
    };
    this.accountCurve(b(x0, x1, x2, x), b(y0, y1, y2, y), d(x0, x1, x2, x), d(y0, y1, y2, y));
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      this.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
    }
  }
  protected quad2(x1: number, y1: number, x: number, y: number): void {
    if (!this.cur) this.start(this.cx, this.cy);
    const x0 = this.cx;
    const y0 = this.cy;
    this.accountCurve(
      (t) => (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x,
      (t) => (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y,
      (t) => 2 * ((1 - t) * (x1 - x0) + t * (x - x1)),
      (t) => 2 * ((1 - t) * (y1 - y0) + t * (y - y1)),
    );
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const u = 1 - t;
      this.push(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
    }
  }

  /** Minimum distance from (px, py) to the flattened geometry; 0 inside fills. */
  distance(px: number, py: number): number {
    let best = Infinity;
    this.polylines.forEach((pl, idx) => {
      if (pl.length === 2) {
        best = Math.min(best, Math.hypot(pl[0] - px, pl[1] - py));
        return;
      }
      for (let i = 0; i + 3 < pl.length; i += 2) {
        const d = distToSegmentSq(px, py, pl[i], pl[i + 1], pl[i + 2], pl[i + 3]);
        if (d < best * best) best = Math.sqrt(d);
      }
      if (this.fills[idx] && pointInPolygon(px, py, pl)) best = 0;
    });
    return best;
  }

  /** Exact total length of all emitted paths. */
  length(): number {
    let len = 0;
    for (const l of this.lens) len += l;
    return len;
  }

  /**
   * Area enclosed by closed paths. Loops of one fill (e.g. a hatch with islands)
   * form an even-odd region: nested loops alternate between adding and subtracting.
   */
  area(): number | undefined {
    let total = 0;
    let any = false;
    const byGroup = new Map<number, number[]>();
    this.polylines.forEach((_, idx) => {
      if (!this.closed[idx] && !this.fills[idx]) return;
      any = true;
      if (!this.fills[idx]) {
        total += Math.abs(this.loopArea(idx));
        return;
      }
      const g = this.groups[idx];
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(idx);
    });
    for (const loops of byGroup.values()) {
      for (const i of loops) {
        const a = Math.abs(this.loopArea(i));
        const pl = this.polylines[i];
        // nesting depth: how many other loops of the region contain this loop
        let depth = 0;
        for (const j of loops) if (j !== i && pl.length >= 2 && pointInPolygon(pl[0], pl[1], this.polylines[j])) depth++;
        total += depth % 2 === 0 ? a : -a;
      }
    }
    return any ? total : undefined;
  }

  /** Signed area of one loop (implicitly closed). */
  private loopArea(idx: number): number {
    const pl = this.polylines[idx];
    let g = this.green[idx];
    if (!this.closed[idx] && pl.length >= 4) {
      // implicit closing segment (fills that were not explicitly closed)
      const n = pl.length;
      const sx = pl[0];
      const sy = pl[1];
      g += (pl[n - 2] - sx) * (pl[1] - sy) - (pl[0] - sx) * (pl[n - 1] - sy);
    }
    return g / 2;
  }
}

export function pointInPolygon(px: number, py: number, pl: number[]): boolean {
  let inside = false;
  for (let i = 0, j = pl.length - 2; i < pl.length; j = i, i += 2) {
    const xi = pl[i];
    const yi = pl[i + 1];
    const xj = pl[j];
    const yj = pl[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
