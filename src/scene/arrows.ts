import { nameKey, type Entity } from '../dxf/model';
import { multiply, rotationZ, scaling, translation } from '../geom/matrix';
import type { Vec3 } from '../geom/vec';
import type { EmitHost } from './host';
import type { InheritCtx } from './style';

/**
 * Draw an arrowhead whose tip is at `tip` pointing in direction `angle`
 * (radians, WCS XY). Uses the drawing's block of that name when present
 * (AutoCAD writes _ARCHTICK, _DOT… blocks), otherwise built-in shapes.
 * Arrow geometry is defined for size 1 with the tip at the origin and the
 * body extending towards −X.
 */
export function emitArrow(host: EmitHost, name: string, tip: Vec3, angle: number, size: number, owner: Entity, ctx: InheritCtx, depth: number): void {
  if (!(size > 0)) return;
  const m = multiply(multiply(translation(tip[0], tip[1], tip[2]), rotationZ(angle)), scaling(size, size, size));
  const n = name.trim();
  if (n && host.doc.blocks.has(nameKey(n)) && !/^_?closedfilled$/i.test(n)) {
    // block contents inherit from the arrow's owner (BYBLOCK = leader / dimension line color)
    host.block(n, m, owner, host.styles.childCtx(owner, ctx, size), depth);
    return;
  }
  const key = n.replace(/^_/, '').toUpperCase();
  const out = host.out;
  out.setMatrix(m);
  const poly = (pts: [number, number][], kind: 'stroke' | 'fill', close = true) => {
    out.beginPath(kind);
    out.moveTo(pts[0][0], pts[0][1], 0);
    for (const p of pts.slice(1)) out.lineTo(p[0], p[1], 0);
    if (close) out.closePath();
    out.endPath();
  };
  const circle = (cx: number, r: number, kind: 'stroke' | 'fill') => {
    out.beginPath(kind);
    out.moveTo(cx + r, 0, 0);
    out.arc(cx, 0, 0, r, 0, 0, 0, r, 0, 0, Math.PI * 2);
    out.closePath();
    out.endPath();
  };
  const tri: [number, number][] = [
    [0, 0],
    [-1, 1 / 6],
    [-1, -1 / 6],
  ];
  switch (key) {
    case 'NONE':
      return;
    case 'CLOSEDBLANK':
      poly(tri, 'stroke');
      return;
    case 'CLOSED':
      poly(tri, 'stroke');
      poly(
        [
          [-1, 0],
          [0, 0],
        ],
        'stroke',
        false,
      );
      return;
    case 'DOT':
      circle(0, 0.5, 'fill');
      return;
    case 'DOTSMALL':
      circle(0, 0.125, 'fill');
      return;
    case 'DOTBLANK':
      circle(0, 0.5, 'stroke');
      return;
    case 'SMALL':
      circle(0, 0.25, 'stroke');
      return;
    case 'ORIGIN':
    case 'ORIGIN2':
      circle(0, 0.5, 'stroke');
      if (key === 'ORIGIN2') circle(0, 0.25, 'stroke');
      return;
    case 'ARCHTICK':
    case 'OBLIQUE':
      poly(
        [
          [-0.5, -0.5],
          [0.5, 0.5],
        ],
        key === 'ARCHTICK' ? 'stroke' : 'stroke',
        false,
      );
      return;
    case 'OPEN':
      poly(
        [
          [-1, 1 / 6],
          [0, 0],
          [-1, -1 / 6],
        ],
        'stroke',
        false,
      );
      return;
    case 'OPEN90':
      poly(
        [
          [-0.5, 0.5],
          [0, 0],
          [-0.5, -0.5],
        ],
        'stroke',
        false,
      );
      return;
    case 'OPEN30':
      poly(
        [
          [-1, 0.268],
          [0, 0],
          [-1, -0.268],
        ],
        'stroke',
        false,
      );
      return;
    case 'BOXBLANK':
    case 'BOXFILLED':
      poly(
        [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ],
        key === 'BOXFILLED' ? 'fill' : 'stroke',
      );
      return;
    case 'DATUMBLANK':
    case 'DATUMFILLED':
      poly(
        [
          [0, 0.5],
          [-1, 0],
          [0, -0.5],
        ],
        key === 'DATUMFILLED' ? 'fill' : 'stroke',
      );
      return;
    case 'INTEGRAL':
      out.beginPath('stroke');
      out.moveTo(-0.45, -0.45, 0);
      out.arc(-0.225, -0.45, 0, 0.225, 0, 0, 0, 0.225, 0, Math.PI, Math.PI * 2);
      out.moveTo(0.45, 0.45, 0);
      out.arc(0.225, 0.45, 0, 0.225, 0, 0, 0, 0.225, 0, 0, Math.PI);
      out.endPath();
      return;
    default:
      // closed filled (AutoCAD default)
      poly(tri, host.fill ? 'fill' : 'stroke');
  }
}
