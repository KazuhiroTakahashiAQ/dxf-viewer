import { distToSegmentSq } from '../geom/vec';
import { Projector } from './geoOut';

/** Number of samples for a curve piece of the given angular sweep. */
function samplesFor(sweep: number): number {
  return Math.min(256, Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 64))));
}

/**
 * Flattens emitted geometry into polylines (world XY). Used for picking
 * distances, lengths and areas. Arcs and curves are sampled finely.
 */
export class FlattenOut extends Projector {
  /** list of polylines: flat [x0,y0,x1,y1,...] */
  polylines: number[][] = [];
  /** which polylines are fills / closed */
  closed: boolean[] = [];
  fills: boolean[] = [];
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
    this.cur = null;
  }
  beginPath(kind: 'stroke' | 'fill'): void {
    this.kind = kind;
    this.cur = null;
  }
  endPath(): void {
    this.cur = null;
  }
  closePath(): void {
    if (this.cur) {
      this.cur.push(this.sx, this.sy);
      this.closed[this.closed.length - 1] = true;
    }
  }
  private start(x: number, y: number): void {
    this.cur = [x, y];
    this.polylines.push(this.cur);
    this.closed.push(false);
    this.fills.push(this.kind === 'fill');
    this.sx = x;
    this.sy = y;
    this.cx = x;
    this.cy = y;
  }
  private add(x: number, y: number): void {
    if (!this.cur) this.start(this.cx, this.cy);
    this.cur!.push(x, y);
    this.cx = x;
    this.cy = y;
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
    for (let k = 1; k <= n; k++) {
      const t = t0 + ((t1 - t0) * k) / n;
      this.add(cx + ux * Math.cos(t) + vx * Math.sin(t), cy + uy * Math.cos(t) + vy * Math.sin(t));
    }
  }
  protected cubic2(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const x0 = this.cx;
    const y0 = this.cy;
    for (let k = 1; k <= 24; k++) {
      const t = k / 24;
      const u = 1 - t;
      this.add(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
    }
  }
  protected quad2(x1: number, y1: number, x: number, y: number): void {
    const x0 = this.cx;
    const y0 = this.cy;
    for (let k = 1; k <= 16; k++) {
      const t = k / 16;
      const u = 1 - t;
      this.add(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
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

  length(): number {
    let len = 0;
    for (const pl of this.polylines) for (let i = 0; i + 3 < pl.length; i += 2) len += Math.hypot(pl[i + 2] - pl[i], pl[i + 3] - pl[i + 1]);
    return len;
  }

  /** Signed shoelace area of closed polylines (absolute value summed). */
  area(): number | undefined {
    let a = 0;
    let any = false;
    this.polylines.forEach((pl, idx) => {
      if (!this.closed[idx] && !this.fills[idx]) return;
      any = true;
      let s = 0;
      for (let i = 0; i + 3 < pl.length; i += 2) s += pl[i] * pl[i + 3] - pl[i + 2] * pl[i + 1];
      a += Math.abs(s) / 2;
    });
    return any ? a : undefined;
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
