/**
 * Elliptical arcs in "affine form": p(t) = c + u·cos(t) + v·sin(t), t ∈ [t0, t1]
 * with t1 >= t0. Any circle/arc/ellipse under any affine transform (OCS,
 * block insert with non-uniform scale, mirroring, XY projection) stays in this
 * form, so curves are exact at every zoom level.
 */

export interface CanvasEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  start: number;
  end: number;
  anticlockwise: boolean;
}

/**
 * Closed-form SVD of the 2x2 matrix [u v] (columns) → parameters for
 * CanvasRenderingContext2D.ellipse(). Handles mirrored (det < 0) mappings by
 * reversing the sweep direction.
 */
export function affineArcToCanvas(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  t0: number,
  t1: number,
): CanvasEllipse {
  let anticlockwise = false;
  // Make det([u v]) >= 0: p(t) = c + u cos t + v sin t = c + u cos(-t) + (-v) sin(-t)
  if (ux * vy - uy * vx < 0) {
    vx = -vx;
    vy = -vy;
    t0 = -t0;
    t1 = -t1;
    anticlockwise = true;
  }
  // M = [[ux, vx], [uy, vy]] = R(phi) · diag(sx, sy) · R(theta)
  const E = (ux + vy) / 2;
  const F = (ux - vy) / 2;
  const G = (uy + vx) / 2;
  const H = (uy - vx) / 2;
  const Q = Math.hypot(E, H);
  const R = Math.hypot(F, G);
  const sx = Q + R;
  let sy = Q - R;
  const a1 = Math.atan2(G, F);
  const a2 = Math.atan2(H, E);
  const theta = (a2 - a1) / 2;
  const phi = (a2 + a1) / 2;
  if (sy < 0) sy = 0;
  return {
    cx,
    cy,
    rx: sx,
    ry: sy,
    rotation: phi,
    start: t0 + theta,
    end: t1 + theta,
    anticlockwise,
  };
}

/** Bounding box of an affine arc (2D components only). */
export function affineArcBounds(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  t0: number,
  t1: number,
  out: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const include = (t: number) => {
    const x = cx + ux * Math.cos(t) + vx * Math.sin(t);
    const y = cy + uy * Math.cos(t) + vy * Math.sin(t);
    if (x < out.minX) out.minX = x;
    if (y < out.minY) out.minY = y;
    if (x > out.maxX) out.maxX = x;
    if (y > out.maxY) out.maxY = y;
  };
  include(t0);
  include(t1);
  if (t1 - t0 >= Math.PI * 2 - 1e-12) {
    // full ellipse: extremes analytically
    const hx = Math.hypot(ux, vx);
    const hy = Math.hypot(uy, vy);
    if (cx - hx < out.minX) out.minX = cx - hx;
    if (cx + hx > out.maxX) out.maxX = cx + hx;
    if (cy - hy < out.minY) out.minY = cy - hy;
    if (cy + hy > out.maxY) out.maxY = cy + hy;
    return;
  }
  // x'(t) = -ux sin t + vx cos t = 0 → t = atan2(vx, ux) (+kπ)
  const tx = Math.atan2(vx, ux);
  const ty = Math.atan2(vy, uy);
  for (const base of [tx, ty]) {
    for (let k = -3; k <= 3; k++) {
      const t = base + k * Math.PI;
      if (t > t0 && t < t1) include(t);
    }
  }
}

/** Number of polyline segments needed so the chord error stays below `tol`. */
export function arcSegments(radius: number, sweep: number, tol: number): number {
  if (radius <= 0 || tol <= 0) return 1;
  const r = Math.max(radius, tol);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
  const n = Math.ceil(Math.abs(sweep) / Math.max(step, 1e-6));
  return Math.min(Math.max(n, 1), 4096);
}

/** Bulge (tan(θ/4)) arc between two 2D points → center, radius, angles (CCW from a0 to a1). */
export function bulgeToArc(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bulge: number,
): { cx: number; cy: number; r: number; a0: number; a1: number; ccw: boolean } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  const theta = 4 * Math.atan(bulge); // included angle, signed
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  // distance from chord midpoint to center
  const h = r * Math.cos(Math.abs(theta) / 2);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  // unit normal to chord (left side)
  const nx = -dy / chord;
  const ny = dx / chord;
  const side = bulge > 0 ? 1 : -1;
  // for |θ| < π the center lies on the left for positive bulge
  const cx = mx + nx * h * side;
  const cy = my + ny * h * side;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  return { cx, cy, r, a0, a1, ccw: bulge > 0 };
}
