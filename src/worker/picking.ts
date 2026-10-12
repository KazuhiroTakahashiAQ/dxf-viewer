import RBush from 'rbush';

import type { DxfDocument } from '../dxf/model';
import { identity } from '../geom/matrix';
import { FlattenHost } from '../scene/flatten';
import { pointInPolygon } from '../scene/measure';
import type { Scene } from '../scene/scene';
import type { StyleResolver } from '../scene/style';
import type { TextMeasurer } from '../scene/textLayout';
import { screenToWorld, worldToScreen, type ViewState, type Viewport } from '../shared/view';

interface Item {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: number;
}

export interface Flat {
  polylines: number[][];
  fills: boolean[];
  infinite: { x: number; y: number; dx: number; dy: number; ray: boolean }[];
}

/** Spatial index and exact hit testing for the top-level entities of a scene. */
export class Picker {
  private tree = new RBush<Item>();
  private unbounded: number[] = [];
  private cache = new Map<number, Flat>();
  private host: FlattenHost;
  private area = new Map<number, number>();

  constructor(
    private doc: DxfDocument,
    scene: Scene,
    styles: StyleResolver,
    measurer: TextMeasurer,
  ) {
    this.host = new FlattenHost({ doc, measurer, styles });
    const items: Item[] = [];
    const ib = scene.itemBBox;
    scene.items.forEach((id, k) => {
      const e = doc.entities[id];
      if (Number.isNaN(ib[k * 4])) {
        if (e.type === 'XLINE' || e.type === 'RAY') this.unbounded.push(id);
        return;
      }
      items.push({ minX: ib[k * 4], minY: ib[k * 4 + 1], maxX: ib[k * 4 + 2], maxY: ib[k * 4 + 3], id });
      this.area.set(id, (ib[k * 4 + 2] - ib[k * 4]) * (ib[k * 4 + 3] - ib[k * 4 + 1]));
    });
    this.tree.load(items);
  }

  /** Flattened geometry of an entity (cached, bounded). */
  flat(id: number): Flat {
    let f = this.cache.get(id);
    if (f) return f;
    this.host.reset();
    try {
      this.host.visit(this.doc.entities[id], identity());
    } catch {
      /* ignore broken geometry */
    }
    f = { polylines: this.host.out.polylines, fills: this.host.out.fills, infinite: this.host.infiniteLines };
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(id, f);
    return f;
  }

  private distance(f: Flat, px: number, py: number): number {
    let best = Infinity;
    f.polylines.forEach((pl, idx) => {
      if (pl.length === 2) best = Math.min(best, Math.hypot(pl[0] - px, pl[1] - py));
      for (let i = 0; i + 3 < pl.length; i += 2) {
        const ax = pl[i];
        const ay = pl[i + 1];
        const dx = pl[i + 2] - ax;
        const dy = pl[i + 3] - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
        if (d < best) best = d;
      }
      if (f.fills[idx] && pointInPolygon(px, py, pl)) best = 0;
    });
    for (const l of f.infinite) {
      const t = (px - l.x) * l.dx + (py - l.y) * l.dy;
      const tt = l.ray ? Math.max(0, t) : t;
      best = Math.min(best, Math.hypot(l.x + l.dx * tt - px, l.y + l.dy * tt - py));
    }
    return best;
  }

  /** Ids whose bounding box touches the world box around (wx, wy), plus unbounded lines. */
  candidates(wx: number, wy: number, tol: number): number[] {
    const ids = this.tree.search({ minX: wx - tol, minY: wy - tol, maxX: wx + tol, maxY: wy + tol }).map((i) => i.id);
    return ids.concat(this.unbounded);
  }

  /**
   * Entities under a screen point, nearest first (ties: smaller first).
   * `visible` filters by layer visibility.
   */
  pick(view: ViewState, vp: Viewport, sx: number, sy: number, tolPx: number, visible: (id: number) => boolean): number[] {
    const [wx, wy] = screenToWorld(view, vp, sx, sy);
    const tol = tolPx / view.scale;
    const cands = this.tree.search({ minX: wx - tol, minY: wy - tol, maxX: wx + tol, maxY: wy + tol }).map((i) => i.id);
    cands.push(...this.unbounded);
    const hits: { id: number; d: number; a: number }[] = [];
    for (const id of cands.slice(0, 2000)) {
      if (!visible(id)) continue;
      const d = this.distance(this.flat(id), wx, wy);
      if (d <= tol) hits.push({ id, d, a: this.area.get(id) ?? 0 });
    }
    hits.sort((p, q) => (Math.abs(p.d - q.d) > tol * 0.05 ? p.d - q.d : p.a - q.a));
    return hits.map((h) => h.id);
  }

  /** Window (fully inside) or crossing (touching) selection in screen space. */
  rect(view: ViewState, vp: Viewport, x0: number, y0: number, x1: number, y1: number, crossing: boolean, visible: (id: number) => boolean): number[] {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const corners = [screenToWorld(view, vp, minX, minY), screenToWorld(view, vp, maxX, minY), screenToWorld(view, vp, minX, maxY), screenToWorld(view, vp, maxX, maxY)];
    const wb = {
      minX: Math.min(...corners.map((c) => c[0])),
      maxX: Math.max(...corners.map((c) => c[0])),
      minY: Math.min(...corners.map((c) => c[1])),
      maxY: Math.max(...corners.map((c) => c[1])),
    };
    const inside = (x: number, y: number) => {
      const [px, py] = worldToScreen(view, vp, x, y);
      return px >= minX && px <= maxX && py >= minY && py <= maxY;
    };
    const out: number[] = [];
    for (const it of this.tree.search(wb)) {
      if (!visible(it.id)) continue;
      const allIn = inside(it.minX, it.minY) && inside(it.maxX, it.minY) && inside(it.minX, it.maxY) && inside(it.maxX, it.maxY);
      if (allIn) {
        out.push(it.id);
        continue;
      }
      if (!crossing) continue;
      // exact test: any flattened vertex inside or any segment crossing the rectangle
      const f = this.flat(it.id);
      let hit = false;
      for (const pl of f.polylines) {
        for (let i = 0; i < pl.length && !hit; i += 2) {
          if (inside(pl[i], pl[i + 1])) hit = true;
          else if (i + 3 < pl.length) {
            const a = worldToScreen(view, vp, pl[i], pl[i + 1]);
            const b = worldToScreen(view, vp, pl[i + 2], pl[i + 3]);
            hit = segmentHitsRect(a[0], a[1], b[0], b[1], minX, minY, maxX, maxY);
          }
        }
        if (hit) break;
      }
      if (hit) out.push(it.id);
    }
    return out;
  }
}

function segmentHitsRect(x0: number, y0: number, x1: number, y1: number, minX: number, minY: number, maxX: number, maxY: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, x0 - minX) && clip(dx, maxX - x0) && clip(-dy, y0 - minY) && clip(dy, maxY - y0);
}
