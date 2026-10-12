import { describe, expect, it } from 'vitest';

import { parseDxf } from '../../src/dxf/parser';
import { PropertyReader } from '../../src/filter/evaluate';
import { StyleResolver, TOP_CTX } from '../../src/scene/style';
import type { TextMeasurer } from '../../src/scene/textLayout';
import { includedAngle, measureValues, pathLength, polygonArea } from '../../src/ui/measure';
import { dxf, enc, entitiesDoc } from './helpers';

const measurer: TextMeasurer = { width: (t) => t.length * 60, metrics: () => ({ capHeight: 0.7, ascent: 0.9, descent: 0.2 }) };

/** Length and area of the single entity of a document (computed by the viewer). */
function metrics(entity: [number, string | number][]): { length: number; area?: number } {
  const doc = parseDxf(enc(dxf(entitiesDoc(entity))), { name: 't.dxf' });
  const reader = new PropertyReader(doc, new StyleResolver(doc), measurer);
  const e = doc.entities[doc.modelSpace[0]];
  return { length: reader.get(e, 'length', TOP_CTX, []) as number, area: reader.get(e, 'area', TOP_CTX, []) as number | undefined };
}

const close = (got: number | undefined, want: number, rel = 1e-9) => {
  expect(got).toBeDefined();
  expect(Math.abs(got! - want)).toBeLessThanOrEqual(Math.abs(want) * rel + 1e-12);
};

describe('measured values (hand-calculated expectations)', () => {
  it('LINE', () => {
    close(metrics([[0, 'LINE'], [8, '0'], [10, 1], [20, 2], [30, 0], [11, 4], [21, 6], [31, 0]]).length, 5);
  });

  it('CIRCLE: 2πr and πr²', () => {
    const m = metrics([[0, 'CIRCLE'], [8, '0'], [10, 5], [20, 5], [30, 0], [40, 2]]);
    close(m.length, 4 * Math.PI);
    close(m.area, 4 * Math.PI);
  });

  it('CIRCLE far from the origin keeps precision', () => {
    const m = metrics([[0, 'CIRCLE'], [8, '0'], [10, 12345678.9], [20, -98765432.1], [30, 0], [40, 0.5]]);
    close(m.length, Math.PI, 1e-7);
    close(m.area, Math.PI / 4, 1e-6);
  });

  it('ARC: r·sweep (also with a mirrored OCS)', () => {
    close(metrics([[0, 'ARC'], [8, '0'], [10, 0], [20, 0], [30, 0], [40, 2], [50, 0], [51, 90]]).length, Math.PI);
    close(metrics([[0, 'ARC'], [8, '0'], [10, 0], [20, 0], [30, 0], [40, 3], [210, 0], [220, 0], [230, -1], [50, 30], [51, 270]]).length, 3 * ((240 * Math.PI) / 180));
  });

  it('ELLIPSE: area πab, perimeter (Ramanujan II)', () => {
    const a = 3;
    const b = 1.5;
    const m = metrics([[0, 'ELLIPSE'], [8, '0'], [10, 1], [20, 1], [30, 0], [11, a], [21, 0], [31, 0], [40, b / a], [41, 0], [42, 2 * Math.PI]]);
    const h = ((a - b) / (a + b)) ** 2;
    const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    close(m.length, perimeter, 1e-8);
    close(m.area, Math.PI * a * b);
  });

  it('LWPOLYLINE with a bulge: square plus half disc', () => {
    // closed 10×10 square; the top edge (10,10)→(0,10) bulges outward as a semicircle (bulge 1)
    const m = metrics([
      [0, 'LWPOLYLINE'],
      [8, '0'],
      [90, 4],
      [70, 1],
      [10, 0],
      [20, 0],
      [10, 10],
      [20, 0],
      [10, 10],
      [20, 10],
      [42, 1],
      [10, 0],
      [20, 10],
    ]);
    close(m.length, 30 + 5 * Math.PI);
    close(m.area, 100 + (Math.PI * 25) / 2);
  });

  it('SPLINE (clamped cubic = one Bézier) against a fine numerical integral', () => {
    const P = [
      [0, 0],
      [1, 3],
      [4, 3],
      [5, 0],
    ];
    const m = metrics([
      [0, 'SPLINE'],
      [8, '0'],
      [70, 8],
      [71, 3],
      [72, 8],
      [73, 4],
      ...[0, 0, 0, 0, 1, 1, 1, 1].map((k) => [40, k] as [number, number]),
      ...P.flatMap(([x, y]) => [[10, x], [20, y], [30, 0]] as [number, number][]),
    ]);
    let want = 0;
    const N = 200_000;
    const at = (t: number) => {
      const u = 1 - t;
      return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]);
    };
    let prev = at(0);
    for (let i = 1; i <= N; i++) {
      const p = at(i / N);
      want += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    }
    close(m.length, want, 1e-8);
  });

  it('HATCH: islands are subtracted', () => {
    const loop = (pts: number[][], flags: number): [number, string | number][] => [
      [92, flags],
      [72, 0],
      [73, 1],
      [93, pts.length],
      ...pts.flatMap(([x, y]) => [[10, x], [20, y]] as [number, number][]),
      [97, 0],
    ];
    const m = metrics([
      [0, 'HATCH'],
      [8, '0'],
      [10, 0],
      [20, 0],
      [30, 0],
      [210, 0],
      [220, 0],
      [230, 1],
      [2, 'SOLID'],
      [70, 1],
      [71, 0],
      [91, 2],
      ...loop(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        2 | 1,
      ),
      ...loop(
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
        2 | 16,
      ),
      [75, 0],
      [76, 1],
      [98, 0],
    ]);
    close(m.area, 100 - 16);
  });
});

describe('measure tool math', () => {
  it('distance, path, polygon area and angle', () => {
    const d = measureValues('distance', [1, 1, 4, 5]);
    expect(d.length).toBe(5);
    expect(d.direction).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI, 12);
    expect(pathLength([0, 0, 3, 4, 3, 10])).toBe(11);
    expect(polygonArea([0, 0, 4, 0, 4, 3, 0, 3])).toBe(12);
    // large coordinates: area computed relative to the first point
    expect(polygonArea([1e8, 1e8, 1e8 + 4, 1e8, 1e8 + 4, 1e8 + 3, 1e8, 1e8 + 3])).toBe(12);
    expect(includedAngle(0, 0, 1, 0, 0, 1)).toBeCloseTo(90, 12);
    expect(includedAngle(0, 0, 1, 0, -1, -1e-12)).toBeCloseTo(180, 6);
  });
});
