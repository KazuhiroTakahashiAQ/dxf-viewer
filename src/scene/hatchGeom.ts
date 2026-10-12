import type { HatchEdge, HatchEntity } from '../dxf/entities/hatch';
import { affineArcBounds, affineArcToCanvas, bulgeToArc } from '../geom/ellipse';
import { clampedUniformKnots, fitPointsToBeziers, samplePoints, toBezierSegments, validKnots, type SplineDef } from '../geom/nurbs';
import { DEG, TAU, type Vec3 } from '../geom/vec';
import { bboxAddPoint, emptyBBox, type BBox } from './geoOut';
import type { PathLike } from './scene';

type P2 = [number, number];

/** A boundary piece with known endpoints that can be emitted in either direction. */
interface Piece {
  start: P2;
  end: P2;
  emit(path: PathLike, reverse: boolean, b: BBox): void;
}

function arcPiece(cx: number, cy: number, ux: number, uy: number, vx: number, vy: number, t0: number, t1: number, ox: number, oy: number): Piece {
  const at = (t: number): P2 => [cx + ux * Math.cos(t) + vx * Math.sin(t), cy + uy * Math.cos(t) + vy * Math.sin(t)];
  return {
    start: at(t0),
    end: at(t1),
    emit(path, reverse, b) {
      const e = reverse ? affineArcToCanvas(cx - ox, cy - oy, ux, uy, -vx, -vy, -t1, -t0) : affineArcToCanvas(cx - ox, cy - oy, ux, uy, vx, vy, t0, t1);
      path.ellipse(e.cx, e.cy, e.rx, e.ry, e.rotation, e.start, e.end, e.anticlockwise);
      affineArcBounds(cx, cy, ux, uy, vx, vy, t0, t1, b);
    },
  };
}

function polyPiece(pts: P2[], ox: number, oy: number): Piece {
  return {
    start: pts[0],
    end: pts[pts.length - 1],
    emit(path, reverse, b) {
      const seq = reverse ? [...pts].reverse() : pts;
      for (const p of seq) {
        path.lineTo(p[0] - ox, p[1] - oy);
        bboxAddPoint(b, p[0], p[1]);
      }
    },
  };
}

function bezierPiece(segs: Vec3[][], ox: number, oy: number): Piece {
  const first = segs[0][0];
  const lastSeg = segs[segs.length - 1];
  const last = lastSeg[lastSeg.length - 1];
  return {
    start: [first[0], first[1]],
    end: [last[0], last[1]],
    emit(path, reverse, b) {
      const list = reverse ? [...segs].reverse().map((s) => [...s].reverse()) : segs;
      path.lineTo(list[0][0][0] - ox, list[0][0][1] - oy);
      for (const s of list) {
        for (const p of s) bboxAddPoint(b, p[0], p[1]);
        if (s.length === 4) path.bezierCurveTo(s[1][0] - ox, s[1][1] - oy, s[2][0] - ox, s[2][1] - oy, s[3][0] - ox, s[3][1] - oy);
        else if (s.length === 3) path.quadraticCurveTo(s[1][0] - ox, s[1][1] - oy, s[2][0] - ox, s[2][1] - oy);
        else path.lineTo(s[s.length - 1][0] - ox, s[s.length - 1][1] - oy);
      }
    },
  };
}

/** Convert ellipse edge angle to parameter (ezdxf angle_to_param). */
function angleToParam(ratio: number, angle: number): number {
  return Math.atan2(Math.sin(angle) / (ratio || 1), Math.cos(angle));
}

function edgePiece(edge: HatchEdge, ox: number, oy: number): Piece | null {
  switch (edge.type) {
    case 'line':
      return polyPiece(
        [
          [edge.x0, edge.y0],
          [edge.x1, edge.y1],
        ],
        ox,
        oy,
      );
    case 'arc': {
      if (!(edge.r > 0)) return null;
      const t0 = edge.start * DEG;
      let t1 = edge.end * DEG;
      while (t1 <= t0) t1 += TAU;
      return arcPiece(edge.cx, edge.cy, edge.r, 0, 0, edge.r, t0, t1, ox, oy);
    }
    case 'ellipse': {
      const mx = edge.mx;
      const my = edge.my;
      if (!mx && !my) return null;
      const vx = -my * edge.ratio;
      const vy = mx * edge.ratio;
      const t0 = angleToParam(edge.ratio, edge.start * DEG);
      let t1 = angleToParam(edge.ratio, edge.end * DEG);
      if (Math.abs(edge.end - edge.start) >= 360 - 1e-9) t1 = t0 + TAU;
      while (t1 <= t0) t1 += TAU;
      return arcPiece(edge.cx, edge.cy, mx, my, vx, vy, t0, t1, ox, oy);
    }
    case 'spline': {
      const ctrl: Vec3[] = edge.ctrl.map(([x, y]) => [x, y, 0]);
      if (ctrl.length >= 2) {
        let def: SplineDef = { degree: Math.max(1, edge.degree), knots: edge.knots, ctrl, weights: edge.rational ? edge.weights : undefined };
        if (!validKnots(def)) def = { ...def, knots: clampedUniformKnots(ctrl.length, Math.min(def.degree, ctrl.length - 1)), degree: Math.min(def.degree, ctrl.length - 1) };
        const segs = def.degree <= 3 ? toBezierSegments(def) : null;
        if (segs && segs.length) return bezierPiece(segs, ox, oy);
        const pts = samplePoints(def).map((p) => [p[0], p[1]] as P2);
        return polyPiece(pts, ox, oy);
      }
      if (edge.fit.length >= 2) {
        const fit: Vec3[] = edge.fit.map(([x, y]) => [x, y, 0]);
        const t0 = edge.startTangent ? ([edge.startTangent[0], edge.startTangent[1], 0] as Vec3) : undefined;
        const t1 = edge.endTangent ? ([edge.endTangent[0], edge.endTangent[1], 0] as Vec3) : undefined;
        return bezierPiece(fitPointsToBeziers(fit, t0, t1), ox, oy);
      }
      return null;
    }
  }
}

const d2 = (a: P2, b: P2) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

export interface HatchLoop {
  external: boolean;
}

/**
 * Emit all boundary loops of a hatch (OCS 2D coordinates minus origin
 * ox/oy) into `path`. Returns the OCS bounding box and loop flags.
 * Pieces are chained by nearest endpoints so clockwise edges and reversed
 * segments still form closed loops.
 */
export function buildHatchPath(h: HatchEntity, path: PathLike, ox: number, oy: number, onlyExternal = false): { bbox: BBox; loops: number } {
  const b = emptyBBox();
  let loops = 0;
  for (const p of h.paths) {
    const external = (p.flags & 1) !== 0 || (p.flags & 16) !== 0;
    if (onlyExternal && !external) continue;
    if (p.polyline) {
      const { points, bulges } = p.polyline;
      const n = points.length / 2;
      if (n < 2) continue;
      loops++;
      path.moveTo(points[0] - ox, points[1] - oy);
      bboxAddPoint(b, points[0], points[1]);
      // hatch boundaries are always closed (the closing segment uses the last bulge)
      for (let i = 0; i < n; i++) {
        const x0 = points[i * 2];
        const y0 = points[i * 2 + 1];
        const j = (i + 1) % n;
        const x1 = points[j * 2];
        const y1 = points[j * 2 + 1];
        const bulge = bulges[i] || 0;
        if (Math.abs(bulge) > 1e-12) {
          const a = bulgeToArc(x0, y0, x1, y1, bulge);
          if (Number.isFinite(a.r) && a.r > 0) {
            let t0 = a.a0;
            let t1 = a.a1;
            if (a.ccw) {
              while (t1 <= t0) t1 += TAU;
              arcPiece(a.cx, a.cy, a.r, 0, 0, a.r, t0, t1, ox, oy).emit(path, false, b);
            } else {
              // clockwise: traverse the ccw arc from a1 to a0 in reverse
              t0 = a.a1;
              t1 = a.a0;
              while (t1 <= t0) t1 += TAU;
              arcPiece(a.cx, a.cy, a.r, 0, 0, a.r, t0, t1, ox, oy).emit(path, true, b);
            }
            continue;
          }
        }
        path.lineTo(x1 - ox, y1 - oy);
        bboxAddPoint(b, x1, y1);
      }
      path.closePath();
      continue;
    }
    const pieces = (p.edges ?? []).map((e) => edgePiece(e, ox, oy)).filter((x): x is Piece => !!x);
    if (!pieces.length) continue;
    loops++;
    // orient the first piece so that it connects to the second one
    let firstReverse = false;
    if (pieces.length > 1) {
      const a = pieces[0];
      const nb = pieces[1];
      const fwd = Math.min(d2(a.end, nb.start), d2(a.end, nb.end));
      const rev = Math.min(d2(a.start, nb.start), d2(a.start, nb.end));
      firstReverse = rev < fwd;
    }
    let cur = firstReverse ? pieces[0].end : pieces[0].start;
    path.moveTo(cur[0] - ox, cur[1] - oy);
    for (let k = 0; k < pieces.length; k++) {
      const pc = pieces[k];
      const reverse = k === 0 ? firstReverse : d2(cur, pc.end) < d2(cur, pc.start);
      pc.emit(path, reverse, b);
      cur = reverse ? pc.start : pc.end;
    }
    path.closePath();
  }
  return { bbox: b, loops };
}
