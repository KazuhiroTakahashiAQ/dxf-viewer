import { bulgeToArc } from '../geom/ellipse';
import { multiply, type Mat34 } from '../geom/matrix';
import {
  clampedUniformKnots,
  fitPointsToBeziers,
  samplePoints,
  toBezierSegments,
  validKnots,
  type SplineDef,
} from '../geom/nurbs';
import { isDefaultExtrusion, ocsToWcs } from '../geom/ocs';
import { cross3, DEG, norm3, TAU, type Vec3 } from '../geom/vec';
import type {
  ArcEntity,
  CircleEntity,
  EllipseEntity,
  Entity,
  FaceEntity,
  LineEntity,
  LwPolylineEntity,
  PolylineEntity,
  SplineEntity,
  Vertex,
} from '../dxf/model';
import type { Projector } from './geoOut';

export interface EmitOptions {
  /** render solid fills (SOLID/TRACE/wide polylines) */
  fill: boolean;
}

/** Set the projector matrix to parent · OCS(extrusion). */
function useOcs(out: Projector, parent: Mat34, extrusion: Vec3 | undefined): void {
  out.setMatrix(isDefaultExtrusion(extrusion) ? parent : multiply(parent, ocsToWcs(extrusion)));
}

function emitLine(e: LineEntity, out: Projector, m: Mat34): void {
  out.setMatrix(m);
  out.beginPath('stroke');
  out.moveTo(e.start[0], e.start[1], e.start[2]);
  out.lineTo(e.end[0], e.end[1], e.end[2]);
  out.endPath();
}

function emitCircle(e: CircleEntity, out: Projector, m: Mat34): void {
  if (!(e.radius > 0)) return;
  useOcs(out, m, e.extrusion);
  const [cx, cy, cz] = e.center;
  const r = e.radius;
  out.beginPath('stroke');
  out.moveTo(cx + r, cy, cz);
  out.arc(cx, cy, cz, r, 0, 0, 0, r, 0, 0, TAU);
  out.closePath();
  out.endPath();
}

function emitArc(e: ArcEntity, out: Projector, m: Mat34): void {
  if (!(e.radius > 0)) return;
  useOcs(out, m, e.extrusion);
  const [cx, cy, cz] = e.center;
  const r = e.radius;
  const t0 = e.startAngle * DEG;
  let t1 = e.endAngle * DEG;
  while (t1 <= t0) t1 += TAU;
  out.beginPath('stroke');
  out.moveTo(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cz);
  out.arc(cx, cy, cz, r, 0, 0, 0, r, 0, t0, t1);
  out.endPath();
}

function emitEllipse(e: EllipseEntity, out: Projector, m: Mat34): void {
  out.setMatrix(m);
  const [cx, cy, cz] = e.center;
  const u = e.majorAxis;
  const n = norm3(e.extrusion ?? [0, 0, 1]);
  const v0 = cross3(n, u);
  const v: Vec3 = [v0[0] * e.ratio, v0[1] * e.ratio, v0[2] * e.ratio];
  const t0 = e.startParam;
  let t1 = e.endParam;
  if (Math.abs(t1 - t0) < 1e-12 || Math.abs(Math.abs(t1 - t0) - TAU) < 1e-9) t1 = t0 + TAU;
  while (t1 < t0) t1 += TAU;
  const full = t1 - t0 >= TAU - 1e-9;
  out.beginPath('stroke');
  out.moveTo(cx + u[0] * Math.cos(t0) + v[0] * Math.sin(t0), cy + u[1] * Math.cos(t0) + v[1] * Math.sin(t0), cz + u[2] * Math.cos(t0) + v[2] * Math.sin(t0));
  out.arc(cx, cy, cz, u[0], u[1], u[2], v[0], v[1], v[2], t0, t1);
  if (full) out.closePath();
  out.endPath();
}

/** Arc between two 2D points with a bulge, in the current plane at height z. */
function bulgeArc(out: Projector, x0: number, y0: number, x1: number, y1: number, bulge: number, z: number): void {
  const a = bulgeToArc(x0, y0, x1, y1, bulge);
  if (!Number.isFinite(a.r) || a.r <= 0) {
    out.lineTo(x1, y1, z);
    return;
  }
  if (a.ccw) {
    let a1 = a.a1;
    while (a1 <= a.a0) a1 += TAU;
    out.arc(a.cx, a.cy, z, a.r, 0, 0, 0, a.r, 0, a.a0, a1);
  } else {
    // clockwise: mirror the v axis so the parameter still increases
    let t1 = -a.a1;
    const t0 = -a.a0;
    while (t1 <= t0) t1 += TAU;
    out.arc(a.cx, a.cy, z, a.r, 0, 0, 0, -a.r, 0, t0, t1);
  }
}

interface Pt2 {
  x: number;
  y: number;
  bulge: number;
  w0: number;
  w1: number;
}

/** Emit a 2D (OCS) polyline with bulges; wide segments become fills. */
function emitPolyline2D(pts: Pt2[], closed: boolean, z: number, out: Projector, opts: EmitOptions, plinegen: boolean): void {
  const n = pts.length;
  if (n === 0) return;
  const segCount = closed ? n : n - 1;
  const wide = pts.some((p, i) => i < segCount && (p.w0 > 0 || p.w1 > 0));
  if (!wide || !opts.fill) {
    out.beginPath('stroke');
    out.moveTo(pts[0].x, pts[0].y, z);
    if (n === 1) {
      out.lineTo(pts[0].x, pts[0].y, z);
    }
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (Math.abs(a.bulge) > 1e-12) bulgeArc(out, a.x, a.y, b.x, b.y, a.bulge, z);
      else out.lineTo(b.x, b.y, z);
    }
    if (closed) out.closePath();
    out.endPath();
    void plinegen;
    return;
  }
  // Wide polyline: one filled shape per segment (round-off at joints is drawn by the stroke of the centerline)
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const w0 = Math.max(0, a.w0);
    const w1 = Math.max(0, a.w1);
    if (w0 === 0 && w1 === 0) {
      out.beginPath('stroke');
      out.moveTo(a.x, a.y, z);
      if (Math.abs(a.bulge) > 1e-12) bulgeArc(out, a.x, a.y, b.x, b.y, a.bulge, z);
      else out.lineTo(b.x, b.y, z);
      out.endPath();
      continue;
    }
    out.beginPath('fill');
    if (Math.abs(a.bulge) <= 1e-12) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      out.moveTo(a.x + (nx * w0) / 2, a.y + (ny * w0) / 2, z);
      out.lineTo(b.x + (nx * w1) / 2, b.y + (ny * w1) / 2, z);
      out.lineTo(b.x - (nx * w1) / 2, b.y - (ny * w1) / 2, z);
      out.lineTo(a.x - (nx * w0) / 2, a.y - (ny * w0) / 2, z);
      out.closePath();
    } else {
      const arc = bulgeToArc(a.x, a.y, b.x, b.y, a.bulge);
      let sweep = arc.a1 - arc.a0;
      if (arc.ccw) while (sweep <= 0) sweep += TAU;
      else while (sweep >= 0) sweep -= TAU;
      const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
      const outer: [number, number][] = [];
      const inner: [number, number][] = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const ang = arc.a0 + sweep * t;
        const w = w0 + (w1 - w0) * t;
        const ro = arc.r + w / 2;
        const ri = Math.max(0, arc.r - w / 2);
        outer.push([arc.cx + ro * Math.cos(ang), arc.cy + ro * Math.sin(ang)]);
        inner.push([arc.cx + ri * Math.cos(ang), arc.cy + ri * Math.sin(ang)]);
      }
      out.moveTo(outer[0][0], outer[0][1], z);
      for (let k = 1; k < outer.length; k++) out.lineTo(outer[k][0], outer[k][1], z);
      for (let k = inner.length - 1; k >= 0; k--) out.lineTo(inner[k][0], inner[k][1], z);
      out.closePath();
    }
    out.endPath();
  }
}

function emitLwPolyline(e: LwPolylineEntity, out: Projector, m: Mat34, opts: EmitOptions): void {
  useOcs(out, m, e.extrusion);
  const pts: Pt2[] = [];
  const cw = e.constantWidth || 0;
  for (let i = 0; i < e.points.length / 2; i++) {
    const sw = e.startWidths[i];
    const ew = e.endWidths[i];
    pts.push({
      x: e.points[i * 2],
      y: e.points[i * 2 + 1],
      bulge: e.bulges[i] || 0,
      w0: sw >= 0 ? sw : cw,
      w1: ew >= 0 ? ew : cw,
    });
  }
  emitPolyline2D(pts, e.closed, e.elevation || 0, out, opts, (e.flags & 128) !== 0);
}

function emitPolyline(e: PolylineEntity, out: Projector, m: Mat34, opts: EmitOptions): void {
  const f = e.flags;
  const verts = e.vertices;
  if (f & 64) {
    // polyface mesh: vertices with flag 64|128 are positions, 128 only are faces
    out.setMatrix(m);
    const positions: Vec3[] = [];
    const faces: number[][] = [];
    // position vertices carry flag 64 (with 128); face records only 128 + indices 71..74
    for (const v of verts) {
      if (v.flags & 64) positions.push(v.position);
      else if (v.face) faces.push(v.face);
    }
    for (const face of faces) {
      const idx = face.filter((k) => k !== 0);
      for (let k = 0; k < idx.length; k++) {
        const a = idx[k];
        const b = idx[(k + 1) % idx.length];
        if (a < 0) continue; // invisible edge
        const pa = positions[Math.abs(a) - 1];
        const pb = positions[Math.abs(b) - 1];
        if (!pa || !pb) continue;
        out.beginPath('stroke');
        out.moveTo(pa[0], pa[1], pa[2]);
        out.lineTo(pb[0], pb[1], pb[2]);
        out.endPath();
      }
    }
    return;
  }
  if (f & 16) {
    // polygon mesh M x N
    out.setMatrix(m);
    const M = e.meshM;
    const N = e.meshN;
    const closedM = (f & 1) !== 0;
    const closedN = (f & 32) !== 0;
    const at = (i: number, j: number) => verts[i * N + j]?.position;
    for (let i = 0; i < M; i++) {
      out.beginPath('stroke');
      for (let j = 0; j < N; j++) {
        const p = at(i, j);
        if (!p) continue;
        if (j === 0) out.moveTo(p[0], p[1], p[2]);
        else out.lineTo(p[0], p[1], p[2]);
      }
      if (closedN) out.closePath();
      out.endPath();
    }
    for (let j = 0; j < N; j++) {
      out.beginPath('stroke');
      for (let i = 0; i < M; i++) {
        const p = at(i, j);
        if (!p) continue;
        if (i === 0) out.moveTo(p[0], p[1], p[2]);
        else out.lineTo(p[0], p[1], p[2]);
      }
      if (closedM) out.closePath();
      out.endPath();
    }
    return;
  }
  const closed = (f & 1) !== 0;
  // spline-fit polylines: skip the frame control points (flag 16)
  const visible: Vertex[] = verts.filter((v) => !(v.flags & 16));
  if (f & 8) {
    out.setMatrix(m);
    out.beginPath('stroke');
    visible.forEach((v, i) => (i === 0 ? out.moveTo(v.position[0], v.position[1], v.position[2]) : out.lineTo(v.position[0], v.position[1], v.position[2])));
    if (closed) out.closePath();
    out.endPath();
    return;
  }
  useOcs(out, m, e.extrusion);
  const pts: Pt2[] = visible.map((v) => ({
    x: v.position[0],
    y: v.position[1],
    bulge: v.bulge || 0,
    w0: v.startWidth >= 0 ? v.startWidth : e.defaultStartWidth,
    w1: v.endWidth >= 0 ? v.endWidth : e.defaultEndWidth,
  }));
  emitPolyline2D(pts, closed, e.elevation[2] || 0, out, opts, (f & 128) !== 0);
}

function emitFace(e: FaceEntity, out: Projector, m: Mat34, opts: EmitOptions): void {
  const c = e.corners;
  if (e.type === '3DFACE') {
    out.setMatrix(m);
    const flags = e.edgeFlags;
    const pts = c[2][0] === c[3][0] && c[2][1] === c[3][1] && c[2][2] === c[3][2] ? [c[0], c[1], c[2]] : c;
    for (let k = 0; k < pts.length; k++) {
      if (flags & (1 << k)) continue;
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      out.beginPath('stroke');
      out.moveTo(a[0], a[1], a[2]);
      out.lineTo(b[0], b[1], b[2]);
      out.endPath();
    }
    return;
  }
  // SOLID / TRACE: vertex order 1-2-4-3
  useOcs(out, m, e.extrusion);
  const order = [c[0], c[1], c[3], c[2]];
  out.beginPath(opts.fill ? 'fill' : 'stroke');
  out.moveTo(order[0][0], order[0][1], order[0][2]);
  for (let k = 1; k < 4; k++) out.lineTo(order[k][0], order[k][1], order[k][2]);
  out.closePath();
  out.endPath();
}

export function splineDef(e: SplineEntity): SplineDef | null {
  if (e.ctrl.length >= 2) {
    const def: SplineDef = { degree: Math.max(1, e.degree || 1), knots: e.knots, ctrl: e.ctrl, weights: e.weights };
    if (!validKnots(def)) {
      if (def.ctrl.length > def.degree) {
        return { ...def, knots: clampedUniformKnots(def.ctrl.length, def.degree), invalidKnots: true } as SplineDef;
      }
      return { degree: 1, knots: clampedUniformKnots(def.ctrl.length, 1), ctrl: def.ctrl, invalidKnots: true } as SplineDef;
    }
    return def;
  }
  return null;
}

function emitSpline(e: SplineEntity, out: Projector, m: Mat34): void {
  out.setMatrix(m);
  const def = splineDef(e);
  out.beginPath('stroke');
  if (def) {
    const segs = def.degree <= 3 ? toBezierSegments(def) : null;
    if (segs && segs.length) {
      const p0 = segs[0][0];
      out.moveTo(p0[0], p0[1], p0[2]);
      for (const s of segs) {
        if (def.degree === 1) out.lineTo(s[1][0], s[1][1], s[1][2]);
        else if (def.degree === 2) out.quadTo(s[1][0], s[1][1], s[1][2], s[2][0], s[2][1], s[2][2]);
        else out.cubicTo(s[1][0], s[1][1], s[1][2], s[2][0], s[2][1], s[2][2], s[3][0], s[3][1], s[3][2]);
      }
    } else {
      const pts = samplePoints(def);
      pts.forEach((p, i) => (i === 0 ? out.moveTo(p[0], p[1], p[2]) : out.lineTo(p[0], p[1], p[2])));
    }
  } else if (e.fit.length >= 2) {
    const segs = fitPointsToBeziers(e.fit, e.startTangent, e.endTangent);
    const p0 = segs[0][0];
    out.moveTo(p0[0], p0[1], p0[2]);
    for (const s of segs) out.cubicTo(s[1][0], s[1][1], s[1][2], s[2][0], s[2][1], s[2][2], s[3][0], s[3][1], s[3][2]);
  }
  if (e.flags & 1 && def && def.degree === 1) out.closePath();
  out.endPath();
}

/**
 * Emit the geometry of a primitive entity. Returns false if the type has no
 * native geometry here (text, inserts and others are handled elsewhere).
 */
export function emitEntity(e: Entity, out: Projector, m: Mat34, opts: EmitOptions): boolean {
  switch (e.type) {
    case 'LINE':
      emitLine(e as LineEntity, out, m);
      return true;
    case 'CIRCLE':
      emitCircle(e as CircleEntity, out, m);
      return true;
    case 'ARC':
      emitArc(e as ArcEntity, out, m);
      return true;
    case 'ELLIPSE':
      emitEllipse(e as EllipseEntity, out, m);
      return true;
    case 'LWPOLYLINE':
      emitLwPolyline(e as LwPolylineEntity, out, m, opts);
      return true;
    case 'POLYLINE':
      emitPolyline(e as PolylineEntity, out, m, opts);
      return true;
    case 'SOLID':
    case 'TRACE':
    case '3DFACE':
      emitFace(e as FaceEntity, out, m, opts);
      return true;
    case 'SPLINE':
    case 'HELIX':
      emitSpline(e as SplineEntity, out, m);
      return true;
    default:
      return false;
  }
}
