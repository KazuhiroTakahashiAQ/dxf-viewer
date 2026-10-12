import { screenToWorld, worldToScreen, type ViewState, type Viewport } from '../../shared/view';

export interface GuideOptions {
  grid: boolean;
  axes: boolean;
  scaleBar: boolean;
  background: number;
  unit: string;
}

/** Smallest 1/2/5×10^k value ≥ v, with its mantissa. */
export function niceStep(v: number): { step: number; mantissa: 1 | 2 | 5 } {
  const k = Math.floor(Math.log10(v));
  const base = 10 ** k;
  const m = v / base;
  if (m <= 1) return { step: base, mantissa: 1 };
  if (m <= 2) return { step: 2 * base, mantissa: 2 };
  if (m <= 5) return { step: 5 * base, mantissa: 5 };
  return { step: 10 * base, mantissa: 1 };
}

function isDark(bg: number): boolean {
  return ((bg >> 16) & 0xff) * 0.299 + ((bg >> 8) & 0xff) * 0.587 + (bg & 0xff) * 0.114 < 128;
}

function fmtLen(v: number): string {
  if (v >= 1e6 || v < 1e-3) return v.toExponential(0);
  return String(Number(v.toPrecision(6)));
}

/** Grid, WCS axes, orientation icon and scale bar (screen-space overlay). */
export function drawGuides(ctx: CanvasRenderingContext2D, view: ViewState, vp: Viewport, o: GuideOptions): void {
  const dark = isDark(o.background);
  const ink = dark ? '255, 255, 255' : '0, 0, 0';
  const W = vp.width;
  const H = vp.height;
  const corners = [screenToWorld(view, vp, 0, 0), screenToWorld(view, vp, W, 0), screenToWorld(view, vp, 0, H), screenToWorld(view, vp, W, H)];
  const minX = Math.min(...corners.map((c) => c[0]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const maxY = Math.max(...corners.map((c) => c[1]));
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const a = worldToScreen(view, vp, x0, y0);
    const b = worldToScreen(view, vp, x1, y1);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  };
  ctx.save();
  ctx.setLineDash([]);
  if (o.grid) {
    const { step, mantissa } = niceStep(14 / view.scale);
    const major = step * (mantissa === 1 ? 10 : mantissa === 2 ? 5 : 2);
    const lines = (maxX - minX) / step + (maxY - minY) / step;
    for (const [s, alpha] of [
      [step, 0.06],
      [major, 0.16],
    ] as const) {
      if (s === step && lines > 600) continue;
      ctx.beginPath();
      for (let i = Math.ceil(minX / s); i <= Math.floor(maxX / s); i++) seg(i * s, minY, i * s, maxY);
      for (let i = Math.ceil(minY / s); i <= Math.floor(maxY / s); i++) seg(minX, i * s, maxX, i * s);
      ctx.strokeStyle = `rgba(${ink}, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (o.axes) {
    ctx.lineWidth = 1;
    if (minY <= 0 && maxY >= 0) {
      ctx.beginPath();
      seg(minX, 0, maxX, 0);
      ctx.strokeStyle = 'rgba(239, 83, 80, 0.7)';
      ctx.stroke();
    }
    if (minX <= 0 && maxX >= 0) {
      ctx.beginPath();
      seg(0, minY, 0, maxY);
      ctx.strokeStyle = 'rgba(102, 187, 106, 0.7)';
      ctx.stroke();
    }
  }
  // orientation icon (WCS +X / +Y as seen on screen) when axes are on or the view is rotated/mirrored
  const oriented = view.rotation !== 0 || view.mirrorX || view.mirrorY;
  let barTop = H - 16;
  if (o.scaleBar) {
    const { step } = niceStep(110 / view.scale);
    let len = step;
    if (len * view.scale > 180) len /= 2;
    const px = len * view.scale;
    const x1 = W - 16;
    const x0 = x1 - px;
    const y = H - 16;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${ink}, 0.85)`;
    ctx.beginPath();
    ctx.moveTo(x0, y - 6);
    ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.lineTo(x1, y - 6);
    ctx.moveTo((x0 + x1) / 2, y);
    ctx.lineTo((x0 + x1) / 2, y - 4);
    ctx.stroke();
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = `rgba(${ink}, 0.9)`;
    ctx.textAlign = 'center';
    ctx.fillText(`${fmtLen(len)}${o.unit ? ` ${o.unit}` : ''}`, (x0 + x1) / 2, y - 9);
    barTop = y - 26;
  }
  if (o.axes || oriented) {
    const cx = W - 40;
    const cy = barTop - 30;
    const [ox, oy] = worldToScreen(view, vp, 0, 0);
    const dir = (wx: number, wy: number): [number, number] => {
      const [px, py] = worldToScreen(view, vp, wx / view.scale, wy / view.scale);
      const dx = px - ox;
      const dy = py - oy;
      const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    ctx.lineWidth = 2;
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px system-ui, -apple-system, "Segoe UI", sans-serif';
    for (const [d, color, name] of [
      [dir(1, 0), '#ef5350', 'X'],
      [dir(0, 1), '#66bb6a', 'Y'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + d[0] * 22, cy + d[1] * 22);
      ctx.stroke();
      ctx.fillText(name, cx + d[0] * 30, cy + d[1] * 30 + 3);
    }
  }
  ctx.restore();
}
