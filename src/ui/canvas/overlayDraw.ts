import type { SnapResult } from '../../shared/docApi';
import { worldToScreen, type ViewState, type Viewport } from '../../shared/view';
import type { MeasureState } from '../../state/store';
import { includedAngle, measureValues } from '../measure';
import { t, type MessageKey } from '../../i18n';

const MEASURE = '#ffd54f';
const SNAP = '#00e676';

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  if (!text) return;
  ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width;
  const W = ctx.canvas.width / (ctx.getTransform().a || 1);
  // keep the label inside the canvas
  const lx = x + 18 + w > W ? x - w - 18 : x + 8;
  const ly = y - 20 < 0 ? y + 22 : y;
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(20, 22, 26, 0.85)';
  ctx.fillRect(lx, ly - 20, w + 10, 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, lx + 5, ly - 7);
}

/** Measurement graphics (points in world coordinates re-projected every frame). */
export function drawMeasure(ctx: CanvasRenderingContext2D, m: MeasureState, hover: [number, number] | null, view: ViewState, vp: Viewport, text: string): void {
  const pts = !m.done && hover && m.mode !== 'point' && m.mode !== 'entity' ? [...m.points, ...hover] : m.points;
  if (!pts.length) return;
  const sp: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 2) sp.push(worldToScreen(view, vp, pts[i], pts[i + 1]));
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = MEASURE;
  ctx.setLineDash([]);
  if (m.mode === 'area' && sp.length >= 3) {
    ctx.beginPath();
    sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 213, 79, 0.15)';
    ctx.fill();
    ctx.stroke();
  } else if (m.mode === 'angle') {
    ctx.beginPath();
    if (sp.length >= 2) {
      ctx.moveTo(sp[1][0], sp[1][1]);
      ctx.lineTo(sp[0][0], sp[0][1]);
    }
    if (sp.length >= 3) ctx.lineTo(sp[2][0], sp[2][1]);
    ctx.stroke();
    if (sp.length >= 3) {
      // arc on screen between the two rays
      const a1 = Math.atan2(sp[1][1] - sp[0][1], sp[1][0] - sp[0][0]);
      const a2 = Math.atan2(sp[2][1] - sp[0][1], sp[2][0] - sp[0][0]);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(sp[0][0], sp[0][1], 28, a1, a1 + d, d < 0);
      ctx.stroke();
    }
  } else if (m.mode !== 'point') {
    ctx.beginPath();
    sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  for (const [x, y] of sp) {
    ctx.fillStyle = MEASURE;
    ctx.fillRect(x - 3, y - 3, 6, 6);
  }
  // live label next to the last point
  const live = m.done ? text.split('  ')[0] : liveText(m, pts);
  const [lx, ly] = m.mode === 'angle' && sp.length ? sp[0] : sp[sp.length - 1];
  label(ctx, live, lx, ly);
}

function liveText(m: MeasureState, pts: number[]): string {
  const v = measureValues(m.mode, pts);
  if (m.mode === 'angle' && pts.length >= 6) return `${includedAngle(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]).toFixed(2)}°`;
  if (v.area !== undefined) return v.area.toPrecision(8);
  if (v.length !== undefined) return v.length.toPrecision(8);
  return '';
}

const snapLabel = (kind: string): string => {
  const key = `snap.${kind}` as MessageKey;
  const text = t(key);
  return text === key ? kind : text;
};

/** AutoCAD-like snap glyphs. */
export function drawSnap(ctx: CanvasRenderingContext2D, s: SnapResult, view: ViewState, vp: Viewport): void {
  const [x, y] = worldToScreen(view, vp, s.x, s.y);
  const r = 6;
  ctx.save();
  ctx.strokeStyle = SNAP;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  switch (s.kind) {
    case 'endpoint':
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case 'midpoint':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      break;
    case 'center':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'quadrant':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
    case 'insertion':
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      break;
    case 'node':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
    default:
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.closePath();
  }
  ctx.stroke();
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = SNAP;
  ctx.fillText(snapLabel(s.kind), x + r + 4, y + r + 10);
  ctx.restore();
}
