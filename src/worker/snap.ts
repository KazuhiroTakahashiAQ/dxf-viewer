import type { DxfDocument, Entity } from '../dxf/model';
import { isDefaultExtrusion } from '../geom/ocs';
import type { SnapKind, SnapResult } from '../shared/docApi';
import { screenToWorld, type ViewState, type Viewport } from '../shared/view';
import type { Flat, Picker } from './picking';

/** Turning angle above which a flattened vertex counts as a corner (end point). */
const CORNER = (12 * Math.PI) / 180;
const PRIORITY: Record<SnapKind, number> = { endpoint: 0, intersection: 0, center: 1, node: 1, insertion: 1, midpoint: 2, quadrant: 2, nearest: 9 };

interface Candidate {
  x: number;
  y: number;
  kind: SnapKind;
  id: number;
}

function turn(pl: number[], i: number): number {
  const ax = pl[i] - pl[i - 2];
  const ay = pl[i + 1] - pl[i - 1];
  const bx = pl[i + 2] - pl[i];
  const by = pl[i + 3] - pl[i + 1];
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
}

/** Split a flattened polyline at corners into runs (straight segments or tessellated curves). */
function runs(pl: number[]): [number, number][] {
  const n = pl.length / 2;
  if (n < 2) return [];
  const cuts = [0];
  for (let k = 1; k < n - 1; k++) if (turn(pl, k * 2) > CORNER) cuts.push(k);
  cuts.push(n - 1);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) out.push([cuts[i], cuts[i + 1]]);
  return out;
}

function circumcenter(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number] | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12 * (Math.abs(ax) + Math.abs(bx) + Math.abs(cx) + 1)) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  return [(a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d];
}

function runLength(pl: number[], a: number, b: number): number {
  let len = 0;
  for (let k = a; k < b; k++) len += Math.hypot(pl[k * 2 + 2] - pl[k * 2], pl[k * 2 + 3] - pl[k * 2 + 1]);
  return len;
}

/** Point at arc-length fraction `t` of a run. */
function pointAlong(pl: number[], a: number, b: number, t: number): [number, number] {
  const target = runLength(pl, a, b) * t;
  let acc = 0;
  for (let k = a; k < b; k++) {
    const x0 = pl[k * 2];
    const y0 = pl[k * 2 + 1];
    const seg = Math.hypot(pl[k * 2 + 2] - x0, pl[k * 2 + 3] - y0);
    if (acc + seg >= target && seg > 0) {
      const u = (target - acc) / seg;
      return [x0 + (pl[k * 2 + 2] - x0) * u, y0 + (pl[k * 2 + 3] - y0) * u];
    }
    acc += seg;
  }
  return [pl[b * 2], pl[b * 2 + 1]];
}

function segIntersection(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): [number, number] | null {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-15 * (Math.abs(rx * sy) + Math.abs(ry * sx) + 1e-300)) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return [ax + t * rx, ay + t * ry];
}

/** Entity-defined points that are not visible in the flattened geometry. */
function entityPoints(e: Entity, add: (x: number, y: number, kind: SnapKind) => void): void {
  const x = e as Entity & Record<string, unknown>;
  const p = (v: unknown) => (Array.isArray(v) && typeof v[0] === 'number' ? (v as number[]) : null);
  if (!isDefaultExtrusion(e.extrusion as never)) return;
  if (e.type === 'POINT') {
    const q = p(x.location) ?? p(x.position);
    if (q) add(q[0], q[1], 'node');
  } else if (e.type === 'INSERT' || e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF') {
    const q = p(x.insert);
    if (q) add(q[0], q[1], 'insertion');
  } else if (e.type === 'ELLIPSE') {
    const q = p(x.center);
    if (q) add(q[0], q[1], 'center');
  }
}

/**
 * Object snap near a screen point. Works on flattened world geometry (so block
 * contents snap too): corners → endpoint, runs → midpoint, curved runs →
 * center/quadrants (circle through three run points), segment pairs →
 * intersection, closest point → nearest.
 */
export function snapAt(
  doc: DxfDocument,
  picker: Picker,
  view: ViewState,
  vp: Viewport,
  sx: number,
  sy: number,
  tolPx: number,
  kinds: SnapKind[],
  visible: (id: number) => boolean,
): SnapResult | null {
  const enabled = new Set(kinds);
  if (!enabled.size) return null;
  const [wx, wy] = screenToWorld(view, vp, sx, sy);
  const tol = tolPx / view.scale;
  const cands: Candidate[] = [];
  const add = (x: number, y: number, kind: SnapKind, id: number) => {
    if (enabled.has(kind) && Math.abs(x - wx) <= tol && Math.abs(y - wy) <= tol) cands.push({ x, y, kind, id });
  };
  const nearSegs: { id: number; ax: number; ay: number; bx: number; by: number }[] = [];
  let nearest: Candidate | null = null;
  let nearestD = tol;
  const ids = picker.candidates(wx, wy, tol).slice(0, 400);
  for (const id of ids) {
    if (!visible(id)) continue;
    const f: Flat = picker.flat(id);
    entityPoints(doc.entities[id], (x, y, k) => add(x, y, k, id));
    for (const pl of f.polylines) {
      const n = pl.length / 2;
      if (n === 1) add(pl[0], pl[1], 'node', id);
      for (const [a, b] of runs(pl)) {
        add(pl[a * 2], pl[a * 2 + 1], 'endpoint', id);
        add(pl[b * 2], pl[b * 2 + 1], 'endpoint', id);
        const m = pointAlong(pl, a, b, 0.5);
        add(m[0], m[1], 'midpoint', id);
        if (b - a >= 4 && (enabled.has('center') || enabled.has('quadrant'))) {
          const k1 = a + Math.round((b - a) / 3);
          const k2 = a + Math.round((2 * (b - a)) / 3);
          const c = circumcenter(pl[a * 2], pl[a * 2 + 1], pl[k1 * 2], pl[k1 * 2 + 1], pl[k2 * 2], pl[k2 * 2 + 1]);
          if (c) {
            const r = Math.hypot(pl[a * 2] - c[0], pl[a * 2 + 1] - c[1]);
            // only a genuine arc: every vertex of the run lies on the circle
            let ok = r > 0;
            for (let k = a; k <= b && ok; k++) ok = Math.abs(Math.hypot(pl[k * 2] - c[0], pl[k * 2 + 1] - c[1]) - r) < r * 0.02;
            if (ok) {
              add(c[0], c[1], 'center', id);
              if (enabled.has('quadrant'))
                for (const [qx, qy] of [
                  [c[0] + r, c[1]],
                  [c[0], c[1] + r],
                  [c[0] - r, c[1]],
                  [c[0], c[1] - r],
                ]) {
                  // on the arc's sweep: some vertex is close to the quadrant point
                  let onArc = false;
                  for (let k = a; k <= b && !onArc; k++) onArc = Math.hypot(pl[k * 2] - qx, pl[k * 2 + 1] - qy) < r * 0.15;
                  if (onArc) add(qx, qy, 'quadrant', id);
                }
            }
          }
        }
      }
      for (let k = 0; k + 3 < pl.length; k += 2) {
        const ax = pl[k];
        const ay = pl[k + 1];
        const bx = pl[k + 2];
        const by = pl[k + 3];
        if (Math.max(ax, bx) < wx - tol || Math.min(ax, bx) > wx + tol || Math.max(ay, by) < wy - tol || Math.min(ay, by) > wy + tol) continue;
        nearSegs.push({ id, ax, ay, bx, by });
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((wx - ax) * dx + (wy - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + t * dx;
        const py = ay + t * dy;
        const d = Math.hypot(px - wx, py - wy);
        if (d <= nearestD) {
          nearestD = d;
          nearest = { x: px, y: py, kind: 'nearest', id };
        }
      }
    }
    for (const l of f.infinite) {
      const t = (wx - l.x) * l.dx + (wy - l.y) * l.dy;
      const tt = l.ray ? Math.max(0, t) : t;
      const px = l.x + l.dx * tt;
      const py = l.y + l.dy * tt;
      const big = tol * 4;
      nearSegs.push({ id, ax: px - l.dx * big, ay: py - l.dy * big, bx: px + l.dx * big, by: py + l.dy * big });
      const d = Math.hypot(px - wx, py - wy);
      if (d <= nearestD) {
        nearestD = d;
        nearest = { x: px, y: py, kind: 'nearest', id };
      }
    }
  }
  if (enabled.has('intersection') && nearSegs.length < 600) {
    for (let i = 0; i < nearSegs.length; i++)
      for (let j = i + 1; j < nearSegs.length; j++) {
        const s = nearSegs[i];
        const q = nearSegs[j];
        // adjacent segments of the same polyline share end points; skip those
        if (s.id === q.id && ((s.bx === q.ax && s.by === q.ay) || (s.ax === q.bx && s.ay === q.by))) continue;
        const hit = segIntersection(s.ax, s.ay, s.bx, s.by, q.ax, q.ay, q.bx, q.by);
        if (hit) add(hit[0], hit[1], 'intersection', s.id);
      }
  }
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.x - wx, c.y - wy);
    if (d > tol) continue;
    const score = PRIORITY[c.kind] * tol * 0.25 + d;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best && enabled.has('nearest')) best = nearest;
  return best ? { x: best.x, y: best.y, kind: best.kind, id: best.id } : null;
}
