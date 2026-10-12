/** Pure measurement math on world points (flat [x0, y0, x1, y1, …]). */

import { t } from '../i18n';

export type MeasureMode = 'distance' | 'path' | 'area' | 'angle' | 'entity' | 'point';

export interface MeasureValues {
  /** distance / path length / perimeter */
  length?: number;
  dx?: number;
  dy?: number;
  /** direction of a distance, degrees counter-clockwise from +X */
  direction?: number;
  area?: number;
  /** included angle in degrees (0…180) */
  angle?: number;
  segments?: number;
}

/** Number of points that completes a measurement (Infinity: finished explicitly). */
export const POINTS_NEEDED: Record<MeasureMode, number> = { distance: 2, path: Infinity, area: Infinity, angle: 3, entity: 0, point: 1 };

export function pathLength(pts: number[], closed = false): number {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  if (closed && pts.length >= 6) len += Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]);
  return len;
}

/** Shoelace area (absolute), computed relative to the first point for precision with large coordinates. */
export function polygonArea(pts: number[]): number {
  if (pts.length < 6) return 0;
  const ox = pts[0];
  const oy = pts[1];
  let a = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length;
    a += (pts[i] - ox) * (pts[j + 1] - oy) - (pts[j] - ox) * (pts[i + 1] - oy);
  }
  return Math.abs(a) / 2;
}

/** Angle at vertex (x0, y0) between the rays to (x1, y1) and (x2, y2), degrees in [0, 180]. */
export function includedAngle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const ax = x1 - x0;
  const ay = y1 - y0;
  const bx = x2 - x0;
  const by = y2 - y0;
  return (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180) / Math.PI;
}

export function measureValues(mode: MeasureMode, pts: number[]): MeasureValues {
  const n = pts.length / 2;
  switch (mode) {
    case 'distance':
      if (n < 2) return {};
      return {
        length: Math.hypot(pts[2] - pts[0], pts[3] - pts[1]),
        dx: pts[2] - pts[0],
        dy: pts[3] - pts[1],
        direction: (((Math.atan2(pts[3] - pts[1], pts[2] - pts[0]) * 180) / Math.PI) + 360) % 360,
      };
    case 'path':
      return { length: pathLength(pts), segments: Math.max(0, n - 1) };
    case 'area':
      return { area: polygonArea(pts), length: pathLength(pts, true), segments: n };
    case 'angle':
      return n >= 3 ? { angle: includedAngle(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]) } : {};
    default:
      return {};
  }
}

export interface MeasureFormat {
  len: (v: number) => string;
  area: (v: number) => string;
  coord: (v: number) => string;
}

/** One-line summary used for labels, history and copying. */
export function measureText(mode: MeasureMode, pts: number[], f: MeasureFormat, entity?: { type: string; handle: string; length?: number; area?: number; radius?: number }): string {
  const v = measureValues(mode, pts);
  switch (mode) {
    case 'distance':
      return v.length === undefined ? '' : `${f.len(v.length)}  (ΔX ${f.coord(v.dx!)}, ΔY ${f.coord(v.dy!)}, ${v.direction!.toFixed(2)}°)`;
    case 'path':
      return `${f.len(v.length ?? 0)}  (${t('measure.text.segments', { count: v.segments ?? 0 })})`;
    case 'area':
      return `${f.area(v.area ?? 0)}  (${t('measure.text.perimeter', { value: f.len(v.length ?? 0) })})`;
    case 'angle':
      return v.angle === undefined ? '' : `${v.angle.toFixed(4)}°`;
    case 'point':
      return pts.length >= 2 ? `X ${f.coord(pts[0])}, Y ${f.coord(pts[1])}` : '';
    case 'entity': {
      if (!entity) return '';
      const parts = [`${entity.type} ${entity.handle}`];
      if (entity.radius !== undefined) parts.push(`R ${f.len(entity.radius)}`, `⌀ ${f.len(entity.radius * 2)}`);
      if (entity.length !== undefined) parts.push(`L ${f.len(entity.length)}`);
      if (entity.area !== undefined && entity.area > 0) parts.push(`A ${f.area(entity.area)}`);
      return parts.join('  ');
    }
  }
}
