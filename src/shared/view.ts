/**
 * View state shared by the UI (owner) and the document worker (renderer).
 * All math is double precision; world coordinates may be very large.
 */
export interface ViewState {
  /** world point at the viewport center */
  cx: number;
  cy: number;
  /** CSS pixels per world unit */
  scale: number;
  /** view rotation in radians (counter-clockwise) */
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
}

export interface Viewport {
  /** CSS pixels */
  width: number;
  height: number;
  dpr: number;
}

export interface BBox2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const DEFAULT_VIEW: ViewState = { cx: 0, cy: 0, scale: 1, rotation: 0, mirrorX: false, mirrorY: false };

/**
 * Linear part of world → screen (CSS px, y down):
 *   X = W/2 + a·dx + c·dy,  Y = H/2 + b·dx + d·dy   with d = (x - cx, y - cy)
 */
export function viewLinear(v: ViewState): [number, number, number, number] {
  const s = v.scale;
  const cos = Math.cos(v.rotation);
  const sin = Math.sin(v.rotation);
  const mx = v.mirrorX ? -1 : 1;
  const my = v.mirrorY ? -1 : 1;
  return [s * cos * mx, -s * sin * mx, -s * sin * my, -s * cos * my];
}

export function worldToScreen(v: ViewState, vp: Viewport, x: number, y: number): [number, number] {
  const [a, b, c, d] = viewLinear(v);
  const dx = x - v.cx;
  const dy = y - v.cy;
  return [vp.width / 2 + a * dx + c * dy, vp.height / 2 + b * dx + d * dy];
}

export function screenToWorld(v: ViewState, vp: Viewport, sx: number, sy: number): [number, number] {
  const [a, b, c, d] = viewLinear(v);
  const det = a * d - b * c;
  const X = sx - vp.width / 2;
  const Y = sy - vp.height / 2;
  return [v.cx + (d * X - c * Y) / det, v.cy + (-b * X + a * Y) / det];
}

/** Axis-aligned world bbox of the visible screen area. */
export function visibleWorldBBox(v: ViewState, vp: Viewport): BBox2 {
  const pts = [
    screenToWorld(v, vp, 0, 0),
    screenToWorld(v, vp, vp.width, 0),
    screenToWorld(v, vp, 0, vp.height),
    screenToWorld(v, vp, vp.width, vp.height),
  ];
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxY: Math.max(...pts.map((p) => p[1])),
  };
}

/** View that fits `b` into the viewport (keeps rotation/mirroring). */
export function fitView(b: BBox2, vp: Viewport, base: ViewState = DEFAULT_VIEW, margin = 0.05): ViewState {
  const w = Math.max(b.maxX - b.minX, 1e-9);
  const h = Math.max(b.maxY - b.minY, 1e-9);
  // size of the bbox as seen through the rotated view
  const cos = Math.abs(Math.cos(base.rotation));
  const sin = Math.abs(Math.sin(base.rotation));
  const sw = w * cos + h * sin;
  const sh = w * sin + h * cos;
  const availW = Math.max(1, vp.width * (1 - 2 * margin));
  const availH = Math.max(1, vp.height * (1 - 2 * margin));
  let scale = Math.min(availW / sw, availH / sh);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  return { ...base, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale };
}

/** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(v: ViewState, vp: Viewport, sx: number, sy: number, factor: number): ViewState {
  const [wx, wy] = screenToWorld(v, vp, sx, sy);
  const scale = Math.min(1e12, Math.max(1e-12, v.scale * factor));
  const next = { ...v, scale };
  const [nx, ny] = screenToWorld(next, vp, sx, sy);
  return { ...next, cx: v.cx + (wx - nx), cy: v.cy + (wy - ny) };
}

/** Pan by a screen-space delta (CSS px). */
export function panBy(v: ViewState, vp: Viewport, dx: number, dy: number): ViewState {
  const [x0, y0] = screenToWorld(v, vp, 0, 0);
  const [x1, y1] = screenToWorld(v, vp, dx, dy);
  return { ...v, cx: v.cx - (x1 - x0), cy: v.cy - (y1 - y0) };
}

/**
 * CSS transform that maps a frame rendered with view `from` onto view `to`
 * (screen-space affine), used for instant previews while the worker renders.
 */
export function screenDelta(from: ViewState, to: ViewState, vp: Viewport): [number, number, number, number, number, number] {
  // pick two reference points to derive the similarity transform
  const p0 = screenToWorld(from, vp, 0, 0);
  const p1 = screenToWorld(from, vp, vp.width, 0);
  const p2 = screenToWorld(from, vp, 0, vp.height);
  const q0 = worldToScreen(to, vp, p0[0], p0[1]);
  const q1 = worldToScreen(to, vp, p1[0], p1[1]);
  const q2 = worldToScreen(to, vp, p2[0], p2[1]);
  const a = (q1[0] - q0[0]) / vp.width;
  const b = (q1[1] - q0[1]) / vp.width;
  const c = (q2[0] - q0[0]) / vp.height;
  const d = (q2[1] - q0[1]) / vp.height;
  return [a, b, c, d, q0[0], q0[1]];
}

/** Normalize an angle to (-π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/**
 * Rotate the view content on screen by `delta`. Increasing `rotation` turns the
 * content counter-clockwise on screen with or without mirroring (see viewLinear).
 */
export function rotateView(v: ViewState, delta: number): ViewState {
  return { ...v, rotation: normalizeAngle(v.rotation + delta) };
}

/**
 * View rotation that shows a world direction `angle` horizontally. On-screen
 * angle of a world direction θ is r + θ (no or double mirroring) or π + r − θ /
 * r − θ (single mirroring), so the solution is r = ∓θ. The result is kept within
 * (-π/2, π/2] so text stays upright.
 */
export function rotationForDirection(angle: number, mirrored = false): number {
  let r = normalizeAngle(mirrored ? angle : -angle);
  if (r > Math.PI / 2) r -= Math.PI;
  else if (r <= -Math.PI / 2) r += Math.PI;
  return r;
}

/** Views are equal up to a fraction of a pixel. */
export function sameView(a: ViewState, b: ViewState): boolean {
  const tol = 0.5 / Math.max(a.scale, 1e-300);
  return (
    Math.abs(a.cx - b.cx) <= tol &&
    Math.abs(a.cy - b.cy) <= tol &&
    Math.abs(a.scale / b.scale - 1) < 1e-6 &&
    Math.abs(normalizeAngle(a.rotation - b.rotation)) < 1e-9 &&
    a.mirrorX === b.mirrorX &&
    a.mirrorY === b.mirrorY
  );
}
