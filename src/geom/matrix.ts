import type { Vec3 } from './vec';

/**
 * Affine 3D transform stored row-major as a 3x4 matrix:
 *   [ m0 m1 m2  m3 ]
 *   [ m4 m5 m6  m7 ]
 *   [ m8 m9 m10 m11 ]
 * p' = M * (x, y, z, 1)
 */
export type Mat34 = Float64Array;

export function identity(): Mat34 {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
}

export function isIdentity(m: Mat34): boolean {
  return (
    m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 &&
    m[4] === 0 && m[5] === 1 && m[6] === 0 && m[7] === 0 &&
    m[8] === 0 && m[9] === 0 && m[10] === 1 && m[11] === 0
  );
}

export function translation(x: number, y: number, z: number): Mat34 {
  return new Float64Array([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]);
}

export function scaling(sx: number, sy: number, sz: number): Mat34 {
  return new Float64Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0]);
}

/** Rotation about the Z axis (radians, counter-clockwise). */
export function rotationZ(a: number): Mat34 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float64Array([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]);
}

/** Matrix whose columns are the given axes, plus origin. */
export function fromAxes(x: Vec3, y: Vec3, z: Vec3, o: Vec3 = [0, 0, 0]): Mat34 {
  return new Float64Array([x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2]]);
}

/** a * b (apply b first, then a). */
export function multiply(a: Mat34, b: Mat34): Mat34 {
  const r = new Float64Array(12);
  for (let i = 0; i < 3; i++) {
    const a0 = a[i * 4], a1 = a[i * 4 + 1], a2 = a[i * 4 + 2], a3 = a[i * 4 + 3];
    r[i * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    r[i * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    r[i * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    r[i * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3;
  }
  return r;
}

export function applyPoint(m: Mat34, x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

export function applyVector(m: Mat34, x: number, y: number, z: number): Vec3 {
  return [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];
}

export function determinant3(m: Mat34): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

/** Determinant of the XY-projected 2x2 linear part (sign tells mirroring in plan view). */
export function determinantXY(m: Mat34): number {
  return m[0] * m[5] - m[1] * m[4];
}

export function invert(m: Mat34): Mat34 | null {
  const det = determinant3(m);
  if (Math.abs(det) < 1e-300) return null;
  const inv = 1 / det;
  const r = new Float64Array(12);
  r[0] = (m[5] * m[10] - m[6] * m[9]) * inv;
  r[1] = (m[2] * m[9] - m[1] * m[10]) * inv;
  r[2] = (m[1] * m[6] - m[2] * m[5]) * inv;
  r[4] = (m[6] * m[8] - m[4] * m[10]) * inv;
  r[5] = (m[0] * m[10] - m[2] * m[8]) * inv;
  r[6] = (m[2] * m[4] - m[0] * m[6]) * inv;
  r[8] = (m[4] * m[9] - m[5] * m[8]) * inv;
  r[9] = (m[1] * m[8] - m[0] * m[9]) * inv;
  r[10] = (m[0] * m[5] - m[1] * m[4]) * inv;
  r[3] = -(r[0] * m[3] + r[1] * m[7] + r[2] * m[11]);
  r[7] = -(r[4] * m[3] + r[5] * m[7] + r[6] * m[11]);
  r[11] = -(r[8] * m[3] + r[9] * m[7] + r[10] * m[11]);
  return r;
}

/**
 * 2D affine (canvas order a,b,c,d,e,f): x' = a*x + c*y + e, y' = b*x + d*y + f.
 */
export type Affine2 = [number, number, number, number, number, number];

export function affineMultiply(m: Affine2, n: Affine2): Affine2 {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function affineInvert(m: Affine2): Affine2 | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-300) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** XY projection of a 3D affine transform restricted to its local XY plane. */
export function projectToAffine(m: Mat34): Affine2 {
  return [m[0], m[4], m[1], m[5], m[3], m[7]];
}
