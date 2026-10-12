import type { Vec3 } from './vec';

export interface SplineDef {
  degree: number;
  knots: number[];
  /** control points (WCS) */
  ctrl: Vec3[];
  /** weights; empty or all 1 for non-rational */
  weights?: number[];
}

export function isRational(s: SplineDef): boolean {
  return !!s.weights && s.weights.length === s.ctrl.length && s.weights.some((w) => Math.abs(w - 1) > 1e-12);
}

/** Knot vector sanity: non-decreasing and count = ctrl + degree + 1. */
export function validKnots(s: SplineDef): boolean {
  const { degree, knots, ctrl } = s;
  if (degree < 1 || ctrl.length < degree + 1) return false;
  if (knots.length !== ctrl.length + degree + 1) return false;
  for (let i = 1; i < knots.length; i++) if (knots[i] < knots[i - 1] - 1e-12) return false;
  return knots[knots.length - 1] - knots[0] > 0;
}

/** Uniform clamped knot vector for the given control point count. */
export function clampedUniformKnots(n: number, degree: number): number[] {
  const knots: number[] = [];
  const inner = n - degree - 1;
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let i = 1; i <= inner; i++) knots.push(i / (inner + 1));
  for (let i = 0; i <= degree; i++) knots.push(1);
  return knots;
}

function findSpan(degree: number, knots: number[], nCtrl: number, u: number): number {
  const n = nCtrl - 1;
  if (u >= knots[n + 1]) return n;
  if (u <= knots[degree]) return degree;
  let low = degree;
  let high = n + 1;
  let mid = (low + high) >> 1;
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid;
    else low = mid;
    mid = (low + high) >> 1;
  }
  return mid;
}

/** Evaluate the (rational) B-spline at parameter u via de Boor's algorithm. */
export function evaluate(s: SplineDef, u: number): Vec3 {
  const p = s.degree;
  const k = findSpan(p, s.knots, s.ctrl.length, u);
  const rational = isRational(s);
  const d: number[][] = [];
  for (let j = 0; j <= p; j++) {
    const idx = k - p + j;
    const c = s.ctrl[Math.max(0, Math.min(s.ctrl.length - 1, idx))];
    const w = rational ? s.weights![Math.max(0, Math.min(s.ctrl.length - 1, idx))] : 1;
    d.push([c[0] * w, c[1] * w, c[2] * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const denom = s.knots[i + p - r + 1] - s.knots[i];
      const alpha = denom === 0 ? 0 : (u - s.knots[i]) / denom;
      const a = d[j - 1];
      const b = d[j];
      d[j] = [
        (1 - alpha) * a[0] + alpha * b[0],
        (1 - alpha) * a[1] + alpha * b[1],
        (1 - alpha) * a[2] + alpha * b[2],
        (1 - alpha) * a[3] + alpha * b[3],
      ];
    }
  }
  const r = d[p];
  const w = r[3] || 1;
  return [r[0] / w, r[1] / w, r[2] / w];
}

function isClamped(s: SplineDef): boolean {
  const { degree: p, knots } = s;
  const first = knots[0];
  const last = knots[knots.length - 1];
  for (let i = 1; i <= p; i++) {
    if (Math.abs(knots[i] - first) > 1e-12) return false;
    if (Math.abs(knots[knots.length - 1 - i] - last) > 1e-12) return false;
  }
  return true;
}

/**
 * Decompose a clamped, non-rational B-spline into Bezier segments
 * (Piegl & Tiller, algorithm A5.6). Returns null when not applicable.
 * Each segment has degree+1 control points.
 */
export function toBezierSegments(s: SplineDef): Vec3[][] | null {
  if (!validKnots(s) || isRational(s) || !isClamped(s)) return null;
  const p = s.degree;
  const U = s.knots;
  const P = s.ctrl;
  const n = P.length - 1;
  const m = n + p + 1;
  let a = p;
  let b = p + 1;
  const segments: Vec3[][] = [];
  let Q: Vec3[] = [];
  for (let i = 0; i <= p; i++) Q.push([...P[i]] as Vec3);
  const alphas: number[] = new Array(p).fill(0);
  let next: Vec3[] = new Array(p + 1);
  while (b < m) {
    const i = b;
    while (b < m && U[b + 1] === U[b]) b++;
    const mult = b - i + 1;
    if (mult < p) {
      const numer = U[b] - U[a];
      for (let j = p; j > mult; j--) alphas[j - mult - 1] = numer / (U[a + j] - U[a]);
      const r = p - mult;
      for (let j = 1; j <= r; j++) {
        const save = r - j;
        const sIdx = mult + j;
        for (let k = p; k >= sIdx; k--) {
          const alpha = alphas[k - sIdx];
          const q = Q[k];
          const q1 = Q[k - 1];
          Q[k] = [
            alpha * q[0] + (1 - alpha) * q1[0],
            alpha * q[1] + (1 - alpha) * q1[1],
            alpha * q[2] + (1 - alpha) * q1[2],
          ];
        }
        if (b < m) next[save] = [...Q[p]] as Vec3;
      }
    }
    segments.push(Q);
    if (b < m) {
      for (let k = p - mult; k <= p; k++) next[k] = [...P[b - p + k]] as Vec3;
      Q = next;
      next = new Array(p + 1);
      a = b;
      b = b + 1;
    }
  }
  // Drop degenerate zero-length segments created by duplicate knots
  return segments.filter((seg) => seg.every((pt) => pt !== undefined));
}

/**
 * Sample a spline into a polyline with relative tolerance. Used for rational,
 * unclamped or high-degree splines.
 */
export function samplePoints(s: SplineDef, segmentsPerSpan = 24): Vec3[] {
  const p = s.degree;
  const U = s.knots;
  const u0 = U[p];
  const u1 = U[U.length - 1 - p];
  const pts: Vec3[] = [];
  const spans: number[] = [];
  for (let i = p; i < U.length - 1 - p; i++) if (U[i + 1] > U[i]) spans.push(i);
  if (spans.length === 0) return [evaluate(s, u0), evaluate(s, u1)];
  const per = Math.max(4, Math.min(256, segmentsPerSpan * p));
  pts.push(evaluate(s, u0));
  for (const i of spans) {
    for (let k = 1; k <= per; k++) {
      pts.push(evaluate(s, U[i] + ((U[i + 1] - U[i]) * k) / per));
    }
  }
  return pts;
}

/**
 * Smooth curve through fit points (centripetal Catmull-Rom → cubic Beziers).
 * Used when a SPLINE only stores fit points.
 */
export function fitPointsToBeziers(fit: Vec3[], startTangent?: Vec3, endTangent?: Vec3): Vec3[][] {
  const n = fit.length;
  if (n < 2) return [];
  const segs: Vec3[][] = [];
  const get = (i: number): Vec3 => {
    if (i < 0) {
      if (startTangent) return [fit[0][0] - startTangent[0], fit[0][1] - startTangent[1], fit[0][2] - startTangent[2]];
      return [2 * fit[0][0] - fit[1][0], 2 * fit[0][1] - fit[1][1], 2 * fit[0][2] - fit[1][2]];
    }
    if (i >= n) {
      if (endTangent) return [fit[n - 1][0] + endTangent[0], fit[n - 1][1] + endTangent[1], fit[n - 1][2] + endTangent[2]];
      return [2 * fit[n - 1][0] - fit[n - 2][0], 2 * fit[n - 1][1] - fit[n - 2][1], 2 * fit[n - 1][2] - fit[n - 2][2]];
    }
    return fit[i];
  };
  const dist = (a: Vec3, b: Vec3) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) || 1e-9;
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const d1 = dist(p0, p1);
    const d2 = dist(p1, p2);
    const d3 = dist(p2, p3);
    const c1: Vec3 = [0, 0, 0];
    const c2: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const m1 = (p2[k] - p1[k]) / d2 + (p1[k] - p0[k]) / d1 - (p2[k] - p0[k]) / (d1 + d2);
      const m2 = (p2[k] - p1[k]) / d2 + (p3[k] - p2[k]) / d3 - (p3[k] - p1[k]) / (d2 + d3);
      c1[k] = p1[k] + (m1 * d2) / 3;
      c2[k] = p2[k] - (m2 * d2) / 3;
    }
    segs.push([p1, c1, c2, p2]);
  }
  return segs;
}
