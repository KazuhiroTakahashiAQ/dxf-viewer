import { newEntityBase } from './entities/common';
import type { DxfDocument, Entity } from './model';
import type { Vec3 } from '../geom/vec';
import { applyPoint, applyVector, type Mat34 } from '../geom/matrix';
import { ocsAxes } from '../geom/ocs';
import { cross3, dot3, norm3 } from '../geom/vec';

/**
 * Decoder for proxy graphics (group 310 binary chunks): the fallback
 * representation stored for custom/unknown objects. Produces virtual
 * entities (CIRCLE, ARC, ELLIPSE, POLYLINE, SOLID-like fills, TEXT).
 * Format follows ezdxf's ProxyGraphic (little endian, 4-byte aligned).
 */

class Stream {
  i = 0;
  private dv: DataView;
  constructor(private b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  get left(): number {
    return this.b.length - this.i;
  }
  private align(): void {
    const m = this.i % 4;
    if (m) this.i += 4 - m;
  }
  u32(): number {
    const v = this.dv.getUint32(this.i, true);
    this.i += 4;
    return v;
  }
  i32(): number {
    const v = this.dv.getInt32(this.i, true);
    this.i += 4;
    return v;
  }
  f64(): number {
    const v = this.dv.getFloat64(this.i, true);
    this.i += 8;
    return v;
  }
  vec(): Vec3 {
    return [this.f64(), this.f64(), this.f64()];
  }
  str(dec: TextDecoder): string {
    let end = this.i;
    while (end < this.b.length && this.b[end] !== 0) end++;
    const s = dec.decode(this.b.subarray(this.i, end));
    this.i = end + 1;
    this.align();
    return s;
  }
  ustr(): string {
    let end = this.i;
    while (end + 1 < this.b.length && !(this.b[end] === 0 && this.b[end + 1] === 0)) end += 2;
    const s = new TextDecoder('utf-16le').decode(this.b.subarray(this.i, end));
    this.i = end + 2;
    this.align();
    return s;
  }
}

export function proxyBytes(doc: DxfDocument, e: Entity): Uint8Array | null {
  const pg = e.proxyGraphics as { start: number; end: number } | undefined;
  if (!pg) return null;
  let hex = '';
  for (let i = pg.start; i < pg.end; i++) hex += doc.tags.str(i).trim();
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function circleFrom3(p1: Vec3, p2: Vec3, p3: Vec3): { c: Vec3; r: number } | null {
  const ax = p1[0], ay = p1[1];
  const bx = p2[0], by = p2[1];
  const cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-15) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { c: [ux, uy, p1[2]], r: Math.hypot(ax - ux, ay - uy) };
}

/** Decode proxy graphics into virtual entities in WCS. */
export function decodeProxyGraphics(doc: DxfDocument, owner: Entity, bytes: Uint8Array): Entity[] {
  const out: Entity[] = [];
  if (bytes.length < 8) return out;
  const layers = [...doc.layers.values()].sort((a, b) => a.tag - b.tag).map((l) => l.name);
  const linetypes = [...doc.linetypes.values()].sort((a, b) => a.tag - b.tag).map((l) => l.name);
  const ver = Number(/AC(\d{4})/.exec(doc.source.version ?? '')?.[1] ?? 0);
  const dec = new TextDecoder(ver >= 1021 ? 'utf-8' : doc.source.encoding.encoding === 'auto' ? 'windows-1252' : doc.source.encoding.encoding);
  const state = { color: 256 as number, trueColor: undefined as number | undefined, layer: owner.layer, linetype: undefined as string | undefined, lineweight: -1, fill: false };
  const matrices: Mat34[] = [];
  const make = (type: string): Entity => {
    const e = newEntityBase(type, owner.id, owner.tagStart, owner.tagEnd);
    e.handle = owner.handle;
    e.layer = state.layer;
    e.color = state.color;
    if (state.trueColor !== undefined) e.trueColor = state.trueColor;
    if (state.linetype) e.linetype = state.linetype;
    e.lineweight = state.lineweight;
    e.virtual = true;
    return e;
  };
  const xf = (p: Vec3): Vec3 => (matrices.length ? applyPoint(matrices[matrices.length - 1], p[0], p[1], p[2]) : p);
  const xv = (p: Vec3): Vec3 => (matrices.length ? applyVector(matrices[matrices.length - 1], p[0], p[1], p[2]) : p);
  const polyline = (pts: Vec3[], closed: boolean) => {
    if (pts.length < 2) return;
    if (state.fill && closed && pts.length >= 3) {
      const e = make('PROXY_FILL');
      e.points = pts.map(xf);
      out.push(e);
      return;
    }
    const e = make('POLYLINE');
    e.flags = 8 | (closed ? 1 : 0);
    e.elevation = [0, 0, 0];
    e.vertices = pts.map((p) => ({ position: xf(p), bulge: 0, startWidth: 0, endWidth: 0, flags: 32 }));
    e.defaultStartWidth = 0;
    e.defaultEndWidth = 0;
    out.push(e);
  };

  let idx = 8; // header: total size + number of chunks
  while (idx + 8 <= bytes.length) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + idx, 8);
    const size = dv.getUint32(0, true);
    const type = dv.getUint32(4, true);
    if (size < 8 || idx + size > bytes.length) break;
    const s = new Stream(bytes.subarray(idx + 8, idx + size));
    try {
      switch (type) {
        case 2: {
          // circle: center, radius, normal
          const c = s.vec();
          const r = s.f64();
          const n = s.vec();
          const e = make('ELLIPSE');
          const { x, y } = ocsAxes(norm3(xv(n)));
          e.center = xf(c);
          e.majorAxis = [x[0] * r, x[1] * r, x[2] * r];
          e.extrusion = norm3(xv(n));
          e.ratio = 1;
          e.startParam = 0;
          e.endParam = Math.PI * 2;
          void y;
          out.push(e);
          break;
        }
        case 3: {
          const c = circleFrom3(s.vec(), s.vec(), s.vec());
          if (!c) break;
          const e = make('CIRCLE');
          e.center = xf(c.c);
          e.radius = c.r;
          out.push(e);
          break;
        }
        case 4: {
          // circular arc: center, radius, normal, start vector, sweep
          const c = s.vec();
          const r = s.f64();
          const n = norm3(s.vec());
          const sv = norm3(s.vec());
          const sweep = s.f64();
          const yv = norm3(cross3(n, sv));
          const e = make('ELLIPSE');
          e.center = xf(c);
          e.extrusion = norm3(xv(n));
          e.majorAxis = xv([sv[0] * r, sv[1] * r, sv[2] * r]);
          e.ratio = 1;
          e.startParam = sweep >= 0 ? 0 : sweep;
          e.endParam = sweep >= 0 ? sweep : 0;
          void yv;
          out.push(e);
          break;
        }
        case 5: {
          const p1 = s.vec();
          const p2 = s.vec();
          const p3 = s.vec();
          const c = circleFrom3(p1, p2, p3);
          if (!c) break;
          const a1 = Math.atan2(p1[1] - c.c[1], p1[0] - c.c[0]);
          const a2 = Math.atan2(p2[1] - c.c[1], p2[0] - c.c[0]);
          const a3 = Math.atan2(p3[1] - c.c[1], p3[0] - c.c[0]);
          const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const ccw = norm(a2 - a1) < norm(a3 - a1);
          const e = make('ARC');
          e.center = xf(c.c);
          e.radius = c.r;
          e.startAngle = ((ccw ? a1 : a3) * 180) / Math.PI;
          e.endAngle = ((ccw ? a3 : a1) * 180) / Math.PI;
          out.push(e);
          break;
        }
        case 6:
        case 7:
        case 32: {
          let n = s.u32();
          if (type === 32) n += 1;
          const pts: Vec3[] = [];
          for (let k = 0; k < n && s.left >= 24; k++) pts.push(s.vec());
          if (type === 32) pts.pop();
          polyline(pts, type === 7);
          break;
        }
        case 9: {
          // shell: vertices + face list
          const nv = s.u32();
          const verts: Vec3[] = [];
          for (let k = 0; k < nv; k++) verts.push(s.vec());
          const nf = s.u32();
          let read = 0;
          while (read < nf && s.left >= 4) {
            const cnt = Math.abs(s.i32());
            read += 1 + cnt;
            const face: Vec3[] = [];
            for (let k = 0; k < cnt; k++) {
              const v = verts[s.u32()];
              if (v) face.push(v);
            }
            polyline(face, true);
          }
          break;
        }
        case 10:
        case 36:
        case 11:
        case 38: {
          const start = s.vec();
          const normal = s.vec();
          const dir = s.vec();
          let text = '';
          let height = 1;
          let wf = 1;
          let oblique = 0;
          let gen = 0;
          if (type === 10 || type === 36) {
            height = s.f64();
            wf = s.f64();
            oblique = s.f64();
            text = type === 36 ? s.ustr() : s.str(dec);
          } else {
            text = type === 38 ? s.ustr() : s.str(dec);
            s.i32();
            s.i32();
            height = s.f64();
            wf = s.f64();
            oblique = s.f64();
            s.f64();
            const back = s.u32();
            const upside = s.u32();
            gen = (back ? 2 : 0) | (upside ? 4 : 0);
          }
          const e = make('TEXT');
          const n = norm3(xv(normal));
          const d = xv(dir);
          const ocs = ocsAxes(n);
          e.insert = xf(start);
          // proxy text positions are WCS; store as OCS for the default extrusion
          e.extrusion = n;
          const p = e.insert as Vec3;
          e.insert = [dot3(p, ocs.x), dot3(p, ocs.y), dot3(p, ocs.z)];
          e.text = text;
          e.height = height;
          e.widthFactor = wf || 1;
          e.oblique = (oblique * 180) / Math.PI;
          e.rotation = (Math.atan2(dot3(d, ocs.y), dot3(d, ocs.x)) * 180) / Math.PI;
          e.style = 'STANDARD';
          e.generation = gen;
          e.halign = 0;
          e.valign = 0;
          out.push(e);
          break;
        }
        case 12:
        case 13: {
          const p1 = s.vec();
          const p2 = s.vec();
          const e = make(type === 12 ? 'XLINE' : 'RAY');
          e.base = xf(p1);
          const d = xv([p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]);
          e.direction = norm3(d);
          out.push(e);
          break;
        }
        case 14: {
          const c = s.u32();
          state.color = c > 256 ? 256 : c;
          state.trueColor = undefined;
          break;
        }
        case 16: {
          const li = s.u32();
          if (li < layers.length) state.layer = layers[li];
          break;
        }
        case 18: {
          const li = s.u32();
          state.linetype = li === 32766 ? 'BYBLOCK' : li === 32767 ? undefined : linetypes[li + 2] ?? linetypes[li];
          break;
        }
        case 20:
          state.fill = s.u32() !== 0;
          break;
        case 22: {
          const raw = s.u32();
          const kind = raw >>> 24;
          if (kind === 0xc2) {
            state.trueColor = raw & 0xffffff;
            state.color = 7;
          } else if (kind === 0xc3) {
            state.color = raw & 0xff;
            state.trueColor = undefined;
          } else if (kind === 0xc0) {
            state.color = 256;
            state.trueColor = undefined;
          } else if (kind === 0xc1) {
            state.color = 0;
            state.trueColor = undefined;
          }
          break;
        }
        case 23: {
          const lw = s.u32();
          state.lineweight = lw > 211 ? -1 : lw;
          break;
        }
        case 29:
        case 30: {
          const v: number[] = [];
          for (let k = 0; k < 16; k++) v.push(s.f64());
          // row-major matrix for column vectors (ezdxf transposes it for row vectors);
          // like ezdxf, only the most recently pushed matrix applies
          matrices.push(new Float64Array([v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11]]));
          break;
        }
        case 31:
          matrices.pop();
          break;
        case 44: {
          const c = s.vec();
          const n = s.vec();
          const major = s.f64();
          const minor = s.f64();
          const sp = s.f64();
          const ep = s.f64();
          const ang = s.f64();
          const ocs = ocsAxes(norm3(n));
          const ma: Vec3 = [
            (ocs.x[0] * Math.cos(ang) + ocs.y[0] * Math.sin(ang)) * major,
            (ocs.x[1] * Math.cos(ang) + ocs.y[1] * Math.sin(ang)) * major,
            (ocs.x[2] * Math.cos(ang) + ocs.y[2] * Math.sin(ang)) * major,
          ];
          const e = make('ELLIPSE');
          e.center = xf(c);
          e.extrusion = norm3(xv(n));
          e.majorAxis = xv(ma);
          e.ratio = major ? minor / major : 1;
          e.startParam = sp;
          e.endParam = ep;
          out.push(e);
          break;
        }
        default:
          break;
      }
    } catch {
      // malformed chunk: skip it
    }
    idx += size;
  }
  return out;
}
