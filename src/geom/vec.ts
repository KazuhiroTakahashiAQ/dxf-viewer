export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const EPS = 1e-12;

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function len3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Squared distance from point p to segment ab (2D). */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

export function isZero3(a: Vec3 | undefined): boolean {
  return !a || (Math.abs(a[0]) < EPS && Math.abs(a[1]) < EPS && Math.abs(a[2]) < EPS);
}

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/** Normalize angle to [0, 2π). */
export function normAngle(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}
