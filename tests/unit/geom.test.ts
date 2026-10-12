import { describe, expect, it } from 'vitest';

import { affineArcBounds, affineArcToCanvas, bulgeToArc } from '../../src/geom/ellipse';
import { evaluate, toBezierSegments, type SplineDef } from '../../src/geom/nurbs';
import { ocsAxes, ocsToWcs } from '../../src/geom/ocs';
import { applyPoint, invert, multiply, rotationZ, translation } from '../../src/geom/matrix';
import type { Vec3 } from '../../src/geom/vec';

function canvasPoint(e: ReturnType<typeof affineArcToCanvas>, theta: number): [number, number] {
  const x = e.rx * Math.cos(theta);
  const y = e.ry * Math.sin(theta);
  const c = Math.cos(e.rotation);
  const s = Math.sin(e.rotation);
  return [e.cx + c * x - s * y, e.cy + s * x + c * y];
}

describe('affineArcToCanvas', () => {
  const cases: [string, number, number, number, number][] = [
    ['circle', 2, 0, 0, 2],
    ['rotated ellipse', 3, 1, -0.5, 1.5],
    ['mirrored (det<0)', 2, 0, 0, -1],
    ['sheared', 1, 0.5, 0.8, 1.2],
  ];
  for (const [name, ux, uy, vx, vy] of cases) {
    it(`matches the affine parametrization: ${name}`, () => {
      const t0 = 0.3;
      const t1 = 2.4;
      const e = affineArcToCanvas(10, 20, ux, uy, vx, vy, t0, t1);
      for (const k of [0, 0.25, 0.5, 1]) {
        const t = t0 + (t1 - t0) * k;
        const expected = [10 + ux * Math.cos(t) + vx * Math.sin(t), 20 + uy * Math.cos(t) + vy * Math.sin(t)];
        const theta = e.start + (e.end - e.start) * k;
        const got = canvasPoint(e, theta);
        expect(got[0]).toBeCloseTo(expected[0], 9);
        expect(got[1]).toBeCloseTo(expected[1], 9);
      }
      // Canvas draws clockwise (decreasing θ) when anticlockwise=true: sweep sign must match.
      if (e.anticlockwise) expect(e.end).toBeLessThan(e.start);
      else expect(e.end).toBeGreaterThan(e.start);
    });
  }
});

describe('affineArcBounds', () => {
  it('quarter circle', () => {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    affineArcBounds(0, 0, 1, 0, 0, 1, 0, Math.PI / 2, b);
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeCloseTo(1);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(1);
  });
  it('arc crossing the left extreme', () => {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    affineArcBounds(0, 0, 1, 0, 0, 1, Math.PI / 2, (3 * Math.PI) / 2, b);
    expect(b.minX).toBeCloseTo(-1);
    expect(b.maxX).toBeCloseTo(0);
  });
});

describe('bulgeToArc', () => {
  it('semicircle with bulge 1 goes counter-clockwise below the chord', () => {
    // from (0,0) to (2,0), bulge 1 → CCW semicircle, center (1,0), passes (1,-1)
    const a = bulgeToArc(0, 0, 2, 0, 1);
    expect(a.cx).toBeCloseTo(1);
    expect(a.cy).toBeCloseTo(0);
    expect(a.r).toBeCloseTo(1);
    expect(a.ccw).toBe(true);
  });
  it('quarter arc bulge tan(22.5°)', () => {
    const b = Math.tan(Math.PI / 8);
    const a = bulgeToArc(1, 0, 0, 1, b);
    expect(a.cx).toBeCloseTo(0);
    expect(a.cy).toBeCloseTo(0);
    expect(a.r).toBeCloseTo(1);
  });
  it('bulge > 1 puts the center on the other side', () => {
    const b = Math.tan((3 * Math.PI) / 8); // 270° arc
    const a = bulgeToArc(1, 0, 0, 1, b);
    expect(a.r).toBeCloseTo(Math.SQRT2 / 2 / Math.sin(Math.PI / 4) * 1, 6);
    // center lies on the chord's perpendicular bisector, on the right side
    expect(a.cx).toBeCloseTo(a.cy, 9);
  });
});

describe('OCS arbitrary axis algorithm', () => {
  it('default extrusion is identity', () => {
    const m = ocsToWcs([0, 0, 1]);
    expect(Array.from(applyPoint(m, 1, 2, 3))).toEqual([1, 2, 3]);
  });
  it('(0,0,-1) mirrors X', () => {
    const { x, y } = ocsAxes([0, 0, -1]);
    expect(x[0]).toBeCloseTo(-1);
    expect(y[1]).toBeCloseTo(1);
  });
  it('matches the DXF reference example for (1,0,0)', () => {
    // N=(1,0,0): |Nx| >= 1/64 → Ax = Wz × N = (0,1,0); Ay = N × Ax = (0,0,1)
    const { x, y } = ocsAxes([1, 0, 0]);
    expect(x).toEqual([0, 1, 0]);
    expect(y).toEqual([0, 0, 1]);
  });
});

describe('matrix', () => {
  it('inverts', () => {
    const m = multiply(translation(5, -3, 2), rotationZ(0.7));
    const inv = invert(m)!;
    const p = applyPoint(m, 1, 2, 3);
    const q = applyPoint(inv, p[0], p[1], p[2]);
    expect(q[0]).toBeCloseTo(1);
    expect(q[1]).toBeCloseTo(2);
    expect(q[2]).toBeCloseTo(3);
  });
});

describe('B-spline Bezier decomposition', () => {
  const spline: SplineDef = {
    degree: 3,
    knots: [0, 0, 0, 0, 1, 2, 2, 2, 2],
    ctrl: [
      [0, 0, 0],
      [1, 2, 0],
      [3, 3, 0],
      [4, 0, 0],
      [6, 1, 0],
    ],
  };
  it('segments reproduce de Boor evaluation', () => {
    const segs = toBezierSegments(spline)!;
    expect(segs).toHaveLength(2);
    const bez = (s: Vec3[], t: number): Vec3 => {
      const u = 1 - t;
      const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [0, 1, 2].map((k) => s.reduce((acc, p, i) => acc + p[k] * b[i], 0)) as Vec3;
    };
    for (const [segIdx, u0] of [
      [0, 0],
      [1, 1],
    ]) {
      for (const t of [0, 0.3, 0.7, 1]) {
        const a = bez(segs[segIdx], t);
        const b = evaluate(spline, u0 + t);
        expect(a[0]).toBeCloseTo(b[0], 9);
        expect(a[1]).toBeCloseTo(b[1], 9);
      }
    }
  });
  it('rational splines are not decomposed', () => {
    expect(toBezierSegments({ ...spline, weights: [1, 2, 1, 1, 1] })).toBeNull();
  });
});
