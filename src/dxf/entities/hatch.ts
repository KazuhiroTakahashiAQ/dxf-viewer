import type { Vec3 } from '../../geom/vec';
import type { EntitySpec, TagReader } from './common';

/* eslint-disable @typescript-eslint/no-explicit-any */
type E = any;

export type HatchEdge =
  | { type: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number; ccw: boolean }
  | { type: 'ellipse'; cx: number; cy: number; mx: number; my: number; ratio: number; start: number; end: number; ccw: boolean }
  | {
      type: 'spline';
      degree: number;
      rational: boolean;
      periodic: boolean;
      knots: number[];
      ctrl: [number, number][];
      weights: number[];
      fit: [number, number][];
      startTangent?: [number, number];
      endTangent?: [number, number];
    };

export interface HatchPath {
  flags: number;
  /** polyline path */
  polyline?: { closed: boolean; points: number[]; bulges: number[] };
  edges?: HatchEdge[];
  sources: string[];
}

export interface PatternLine {
  angle: number;
  baseX: number;
  baseY: number;
  offsetX: number;
  offsetY: number;
  dashes: number[];
}

export interface HatchEntity {
  type: 'HATCH' | 'MPOLYGON';
  elevation: Vec3;
  pattern: string;
  solid: boolean;
  associative: boolean;
  paths: HatchPath[];
  style: number;
  patternType: number;
  patternAngle: number;
  patternScale: number;
  patternDouble: boolean;
  patternLines: PatternLine[];
  pixelSize: number;
  seeds: [number, number][];
  gradient?: {
    name: string;
    angle: number;
    shift: number;
    singleColor: boolean;
    tint: number;
    colors: { aci?: number; rgb?: number }[];
  };
  /** MPOLYGON fill color */
  fillColor?: number;
}

/** Parse the boundary path block starting after the "91 count" tag. Returns tags consumed. */
function parsePaths(e: E, i: number, r: TagReader): number {
  const { tags, end } = r;
  const count = Math.max(0, Math.trunc(r.n(i)));
  let j = i + 1;
  const code = (k: number) => (k < end ? tags.code(k) : -1);
  for (let p = 0; p < count && j < end; p++) {
    if (code(j) !== 92) break;
    const flags = Math.trunc(r.n(j));
    j++;
    const path: HatchPath = { flags, sources: [] };
    if (flags & 2) {
      let hasBulge = false;
      let closed = true;
      let n = 0;
      while (j < end && (code(j) === 72 || code(j) === 73 || code(j) === 93)) {
        if (code(j) === 72) hasBulge = r.n(j) !== 0;
        else if (code(j) === 73) closed = r.n(j) !== 0;
        else n = Math.trunc(r.n(j));
        j++;
      }
      const points: number[] = [];
      const bulges: number[] = [];
      for (let v = 0; v < n && j < end && code(j) === 10; v++) {
        points.push(r.n(j), code(j + 1) === 20 ? r.n(j + 1) : 0);
        j += code(j + 1) === 20 ? 2 : 1;
        if (code(j) === 30) j++;
        let b = 0;
        if (hasBulge && code(j) === 42) {
          b = r.n(j);
          j++;
        }
        bulges.push(b);
      }
      path.polyline = { closed, points, bulges };
    } else {
      const edges: HatchEdge[] = [];
      let n = 0;
      if (code(j) === 93) {
        n = Math.trunc(r.n(j));
        j++;
      }
      for (let k = 0; k < n && j < end && code(j) === 72; k++) {
        const et = Math.trunc(r.n(j));
        j++;
        const read = (c: number) => {
          if (code(j) === c) {
            const v = r.n(j);
            j++;
            return v;
          }
          return 0;
        };
        if (et === 1) {
          const x0 = read(10);
          const y0 = read(20);
          const x1 = read(11);
          const y1 = read(21);
          edges.push({ type: 'line', x0, y0, x1, y1 });
        } else if (et === 2) {
          const cx = read(10);
          const cy = read(20);
          const rad = read(40);
          const a0 = read(50);
          const a1 = read(51);
          const ccw = code(j) === 73 ? read(73) !== 0 : true;
          // clockwise arcs store complementary angles (see ezdxf ArcEdge)
          edges.push(ccw ? { type: 'arc', cx, cy, r: rad, start: a0, end: a1, ccw } : { type: 'arc', cx, cy, r: rad, start: 360 - a1, end: 360 - a0, ccw });
        } else if (et === 3) {
          const cx = read(10);
          const cy = read(20);
          const mx = read(11);
          const my = read(21);
          const ratio = read(40);
          const a0 = read(50);
          const a1 = read(51);
          const ccw = code(j) === 73 ? read(73) !== 0 : true;
          edges.push(ccw ? { type: 'ellipse', cx, cy, mx, my, ratio, start: a0, end: a1, ccw } : { type: 'ellipse', cx, cy, mx, my, ratio, start: 360 - a1, end: 360 - a0, ccw });
        } else if (et === 4) {
          const s: Extract<HatchEdge, { type: 'spline' }> = { type: 'spline', degree: 3, rational: false, periodic: false, knots: [], ctrl: [], weights: [], fit: [] };
          s.degree = Math.trunc(read(94)) || 3;
          s.rational = read(73) !== 0;
          s.periodic = read(74) !== 0;
          const nk = Math.trunc(read(95));
          const nc = Math.trunc(read(96));
          for (let q = 0; q < nk && code(j) === 40; q++) s.knots.push(read(40));
          for (let q = 0; q < nc && code(j) === 10; q++) {
            const x = read(10);
            const y = read(20);
            s.ctrl.push([x, y]);
            if (code(j) === 42) s.weights.push(read(42));
          }
          if (code(j) === 97) {
            const nf = Math.trunc(read(97));
            for (let q = 0; q < nf && code(j) === 11; q++) s.fit.push([read(11), read(21)]);
            if (code(j) === 12) s.startTangent = [read(12), read(22)];
            if (code(j) === 13) s.endTangent = [read(13), read(23)];
          }
          edges.push(s);
        } else {
          r.diagnostics.push({ level: 'warning', code: 'hatch-edge', message: `Unknown hatch edge type ${et}`, line: tags.line(j - 1) });
          break;
        }
      }
      path.edges = edges;
    }
    if (code(j) === 97) {
      const ns = Math.trunc(r.n(j));
      j++;
      for (let q = 0; q < ns && code(j) === 330; q++) {
        path.sources.push(r.raw(j).trim());
        j++;
      }
    }
    e.paths.push(path);
  }
  return j - i;
}

function parsePatternLines(e: E, i: number, r: TagReader): number {
  const { tags, end } = r;
  const n = Math.max(0, Math.trunc(r.n(i)));
  let j = i + 1;
  const code = (k: number) => (k < end ? tags.code(k) : -1);
  for (let p = 0; p < n && j < end && code(j) === 53; p++) {
    const line: PatternLine = { angle: r.n(j), baseX: 0, baseY: 0, offsetX: 0, offsetY: 0, dashes: [] };
    j++;
    if (code(j) === 43) line.baseX = r.n(j++);
    if (code(j) === 44) line.baseY = r.n(j++);
    if (code(j) === 45) line.offsetX = r.n(j++);
    if (code(j) === 46) line.offsetY = r.n(j++);
    if (code(j) === 79) {
      const nd = Math.trunc(r.n(j++));
      for (let q = 0; q < nd && code(j) === 49; q++) line.dashes.push(r.n(j++));
    }
    e.patternLines.push(line);
  }
  return j - i;
}

export const HATCH: EntitySpec = {
  init(e: E) {
    e.elevation = [0, 0, 0];
    e.pattern = '';
    e.solid = false;
    e.associative = false;
    e.paths = [];
    e.style = 0;
    e.patternType = 1;
    e.patternAngle = 0;
    e.patternScale = 1;
    e.patternDouble = false;
    e.patternLines = [];
    e.pixelSize = 0;
    e.seeds = [];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: {
        if (e._afterSeeds) return 0;
        const { p, used } = r.point(i);
        e.elevation = p;
        return used;
      }
      case 210: {
        const { p, used } = r.point(i);
        e.extrusion = p;
        return used;
      }
      case 2:
        e.pattern = r.s(i).trim();
        return 1;
      case 70:
        e.solid = r.n(i) !== 0;
        return 1;
      case 71:
        e.associative = r.n(i) !== 0;
        return 1;
      case 91:
        return parsePaths(e, i, r);
      case 75:
        e.style = r.n(i);
        return 1;
      case 76:
        e.patternType = r.n(i);
        return 1;
      case 52:
        e.patternAngle = r.n(i);
        return 1;
      case 41:
        e.patternScale = r.n(i);
        return 1;
      case 77:
        e.patternDouble = r.n(i) !== 0;
        return 1;
      case 78:
        return parsePatternLines(e, i, r);
      case 47:
        e.pixelSize = r.n(i);
        return 1;
      case 98: {
        const n = Math.trunc(r.n(i));
        let j = i + 1;
        for (let q = 0; q < n && j < r.end && r.tags.code(j) === 10; q++) {
          e.seeds.push([r.n(j), r.tags.code(j + 1) === 20 ? r.n(j + 1) : 0]);
          j += r.tags.code(j + 1) === 20 ? 2 : 1;
        }
        e._afterSeeds = true;
        return j - i;
      }
      case 450:
        if (r.n(i) !== 0) e.gradient = { name: 'LINEAR', angle: 0, shift: 0, singleColor: false, tint: 0, colors: [] };
        return 1;
      case 452:
        if (e.gradient) e.gradient.singleColor = r.n(i) !== 0;
        return 1;
      case 460:
        if (e.gradient) e.gradient.angle = r.n(i);
        return 1;
      case 461:
        if (e.gradient) e.gradient.shift = r.n(i);
        return 1;
      case 462:
        if (e.gradient) e.gradient.tint = r.n(i);
        return 1;
      case 463:
        if (e.gradient) e.gradient.colors.push({});
        return 1;
      case 63:
        if (e.gradient && e.gradient.colors.length) e.gradient.colors[e.gradient.colors.length - 1].aci = r.n(i);
        else e.fillColor = r.n(i);
        return 1;
      case 421:
        if (e.gradient && e.gradient.colors.length) e.gradient.colors[e.gradient.colors.length - 1].rgb = r.n(i) & 0xffffff;
        return 1;
      case 470:
        if (e.gradient) e.gradient.name = r.s(i).trim().toUpperCase();
        return 1;
      default:
        return 0;
    }
  },
  finish(e: E) {
    delete e._afterSeeds;
  },
};

/** MPOLYGON shares the HATCH boundary/pattern structure (paths are polylines). */
export const MPOLYGON: EntitySpec = {
  init: HATCH.init,
  tag(e: E, code, i, r) {
    if (code === 91) {
      // MPOLYGON paths: 92 flags, 72 bulge flag, 73 closed, 93 count, vertices
      return parsePaths(e, i, r);
    }
    if (code === 11) return 1; // offset vector
    if (code === 99) return 1;
    // MPOLYGON: 70 = version, 71 = solid fill flag
    if (code === 70) {
      e.version = r.n(i);
      return 1;
    }
    if (code === 71) {
      e.solid = r.n(i) !== 0;
      return 1;
    }
    return HATCH.tag(e, code, i, r);
  },
  finish: HATCH.finish,
};
