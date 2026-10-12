import { aciToRgb } from '../dxf/colors';
import { dimVars } from '../dxf/dimstyle';
import { decodeSat } from '../dxf/entities/complexSpecs';
import type { HatchEntity } from '../dxf/entities/hatch';
import { newEntityBase } from '../dxf/entities/common';
import { nameKey, type DimensionEntity, type Entity, type MTextEntity } from '../dxf/model';
import { blockNameByRecord, imageDef, mlineStyle, styleNameByHandle, underlayDef } from '../dxf/objects';
import { decodeProxyGraphics, proxyBytes } from '../dxf/proxyGraphics';
import { applyPoint, applyVector, multiply, rotationZ, scaling, translation, type Mat34 } from '../geom/matrix';
import { fitPointsToBeziers } from '../geom/nurbs';
import { ocsToWcs } from '../geom/ocs';
import { DEG, norm3, type Vec3 } from '../geom/vec';
import { emitArrow } from './arrows';
import type { EmitHost } from './host';
import type { InheritCtx } from './style';
import { layoutMText, layoutText } from './textLayout';

/* eslint-disable @typescript-eslint/no-explicit-any */
type E = any;

export const COMPLEX_TYPES = new Set([
  'XLINE',
  'RAY',
  'HATCH',
  'MPOLYGON',
  'LEADER',
  'MULTILEADER',
  'MLEADER',
  'TOLERANCE',
  'MLINE',
  'IMAGE',
  'WIPEOUT',
  'PDFUNDERLAY',
  'DWFUNDERLAY',
  'DGNUNDERLAY',
  'OLE2FRAME',
  'SHAPE',
  'MESH',
  'ACAD_TABLE',
  '3DSOLID',
  'REGION',
  'BODY',
  'SURFACE',
  'EXTRUDEDSURFACE',
  'LOFTEDSURFACE',
  'REVOLVEDSURFACE',
  'SWEPTSURFACE',
  'PLANESURFACE',
  'NURBSURFACE',
]);

/** How each complex type is drawn (for the coverage report). */
export function complexMethod(type: string): 'native' | 'block' | 'frame' {
  if (type === 'ACAD_TABLE') return 'block';
  if (/UNDERLAY|OLE2FRAME|SHAPE|SOLID|REGION|BODY|SURFACE/.test(type) && type !== 'HATCH') return 'frame';
  return 'native';
}

/** Decode a raw color value (0xC2RRGGBB true color, 0xC3 ACI, 0xC0 BYLAYER, 0xC1 BYBLOCK). */
function rawColor(v: number | undefined): { color?: number; trueColor?: number } {
  if (v === undefined) return {};
  const kind = v >>> 24;
  if (kind === 0xc2) return { trueColor: v & 0xffffff, color: 7 };
  if (kind === 0xc3) return { color: v & 0xff };
  if (kind === 0xc1) return { color: 0 };
  if (kind === 0xc0) return { color: 256 };
  return {};
}

function polyline(host: EmitHost, pts: Vec3[], closed = false): void {
  if (pts.length < 2) return;
  const out = host.out;
  out.beginPath('stroke');
  out.moveTo(pts[0][0], pts[0][1], pts[0][2]);
  for (let i = 1; i < pts.length; i++) out.lineTo(pts[i][0], pts[i][1], pts[i][2]);
  if (closed) out.closePath();
  out.endPath();
}

function label(host: EmitHost, text: string, at: Vec3, height: number, m: Mat34, owner: Entity, ctx: InheritCtx): void {
  if (!text || !(height > 0)) return;
  const t = newEntityBase('TEXT', owner.id, owner.tagStart, owner.tagEnd);
  Object.assign(t, { text, insert: at, height, rotation: 0, widthFactor: 1, oblique: 0, style: 'STANDARD', generation: 0, halign: 0, valign: 0, layer: owner.layer, color: owner.color });
  const p = layoutText(t as never, host.doc.styles.get('STANDARD'), host.measurer);
  if (p) host.text(p, m, host.use(owner, ctx), owner.id);
}

// ---------- individual entity types ----------

function emitLeader(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx, depth: number): void {
  const verts: Vec3[] = e.vertices;
  if (verts.length < 2) return;
  const dv = dimVars(host.doc, e.dimStyle, e);
  const asz = dv.asz * (dv.scale || 1);
  host.use(e, ctx);
  host.out.setMatrix(m);
  if (e.pathType === 1 && verts.length > 2) {
    const segs = fitPointsToBeziers(verts);
    const out = host.out;
    out.beginPath('stroke');
    out.moveTo(verts[0][0], verts[0][1], verts[0][2]);
    for (const s of segs) out.cubicTo(s[1][0], s[1][1], s[1][2], s[2][0], s[2][1], s[2][2], s[3][0], s[3][1], s[3][2]);
    out.endPath();
  } else {
    polyline(host, verts);
  }
  if (e.hookline && e.horizontalDirection && verts.length >= 2) {
    const last = verts[verts.length - 1];
    const prev = verts[verts.length - 2];
    const hd = norm3(e.horizontalDirection);
    const sign = (last[0] - prev[0]) * hd[0] + (last[1] - prev[1]) * hd[1] >= 0 ? 1 : -1;
    host.out.setMatrix(m);
    polyline(host, [last, [last[0] + hd[0] * asz * sign, last[1] + hd[1] * asz * sign, last[2]]]);
  }
  if (e.arrow) {
    const p0 = applyPoint(m, ...(verts[0] as [number, number, number]));
    const p1 = applyPoint(m, ...(verts[1] as [number, number, number]));
    emitArrow(host, dv.ldrblk, p0, Math.atan2(p0[1] - p1[1], p0[0] - p1[0]), asz, e, ctx, depth + 1);
  }
}

function mleaderAttachment(v: number | undefined): number {
  return v !== undefined && v >= 1 && v <= 9 ? v : 1;
}

function emitMLeader(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx, depth: number): void {
  const c = e.ctx ?? {};
  const st = host.use(e, ctx);
  // leader line color/linetype overrides
  const lineEntity = { ...e, ...rawColor(e.lineColor) };
  const lineStyle = host.use(lineEntity, ctx);
  const arrowSize = c.arrowSize || (e.arrowSize ?? 0) * (c.scale || 1) || 2.5;
  const arrowName = blockNameByRecord(host.doc, e.arrowBlock) ?? '';
  if (e.lineType !== 0) {
    for (const leader of e.leaders ?? []) {
      for (const line of leader.lines as Vec3[][]) {
        const pts = [...line];
        if (leader.lastPoint) pts.push(leader.lastPoint);
        if (pts.length < 2) continue;
        host.useStyle(lineStyle);
        host.out.setMatrix(m);
        if (e.lineType === 2 && pts.length > 2) {
          const segs = fitPointsToBeziers(pts);
          host.out.beginPath('stroke');
          host.out.moveTo(pts[0][0], pts[0][1], pts[0][2]);
          for (const s of segs) host.out.cubicTo(s[1][0], s[1][1], s[1][2], s[2][0], s[2][1], s[2][2], s[3][0], s[3][1], s[3][2]);
          host.out.endPath();
        } else polyline(host, pts);
        const p0 = applyPoint(m, ...(pts[0] as [number, number, number]));
        const p1 = applyPoint(m, ...(pts[1] as [number, number, number]));
        emitArrow(host, arrowName, p0, Math.atan2(p0[1] - p1[1], p0[0] - p1[0]), arrowSize, lineEntity, ctx, depth + 1);
      }
      // landing (dogleg)
      if (leader.lastPoint && leader.dogleg && e.enableDogleg !== false && leader.doglegLength > 0) {
        const lp = leader.lastPoint as Vec3;
        const dl = leader.dogleg as Vec3;
        host.useStyle(lineStyle);
        host.out.setMatrix(m);
        polyline(host, [lp, [lp[0] + dl[0] * leader.doglegLength, lp[1] + dl[1] * leader.doglegLength, lp[2] + dl[2] * leader.doglegLength]]);
      }
    }
  }
  // text content
  if (c.hasText && c.text && e.contentType !== 1) {
    const textEntity = { ...e, ...rawColor(e.textColor ?? c.textColor) };
    const mt = newEntityBase('MTEXT', e.id, e.tagStart, e.tagEnd) as unknown as MTextEntity;
    Object.assign(mt, {
      text: c.text,
      insert: c.textLocation ?? [0, 0, 0],
      height: c.textHeight || 2.5,
      refWidth: c.textWidth || 0,
      attachment: mleaderAttachment(c.textAttachment),
      direction: 1,
      style: styleNameByHandle(host.doc, c.textStyle ?? e.textStyle) ?? 'STANDARD',
      xAxis: c.textDirection,
      rotation: 0,
      lineSpacingStyle: c.lineSpacingStyle ?? 1,
      lineSpacingFactor: c.lineSpacingFactor ?? 1,
      bgFlags: c.bgFillOn ? 1 : 0,
      bgColor: c.bgColor !== undefined ? (rawColor(c.bgColor).color ?? 7) : undefined,
      bgScale: c.bgScale ?? 1.5,
      columnType: 0,
      columnCount: 0,
      columnWidth: 0,
      columnGutter: 0,
      columnHeights: [],
      extrusion: c.textNormal,
    });
    const p = layoutMText(mt, (n) => host.doc.styles.get(nameKey(n)), host.measurer);
    if (p) host.text(p, m, host.use(textEntity, ctx), e.id);
  }
  // block content
  if (c.hasBlock && c.block) {
    const name = blockNameByRecord(host.doc, c.block);
    if (name) {
      const loc: Vec3 = c.blockLocation ?? [0, 0, 0];
      const sc: Vec3 = c.blockScale ?? [1, 1, 1];
      const bm = multiply(multiply(multiply(m, translation(loc[0], loc[1], loc[2])), rotationZ(c.blockRotation ?? 0)), scaling(sc[0] || 1, sc[1] || 1, sc[2] || 1));
      const blockEntity = { ...e, ...rawColor(e.blockColor) };
      host.block(name, bm, blockEntity, ctx, depth + 1);
    }
  }
  void st;
}

const GDT: Record<string, string> = {
  a: '∠',
  b: '⟂',
  c: '⏥',
  d: '⌓',
  e: '○',
  f: '∥',
  g: '⌭',
  h: '↗',
  i: '⌯',
  j: '⌖',
  k: '⌒',
  l: 'Ⓛ',
  m: 'Ⓜ',
  n: 'Ø',
  p: 'Ⓟ',
  r: '◎',
  s: 'Ⓢ',
  t: '⌰',
  u: '⏤',
};

function emitTolerance(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  const dv = dimVars(host.doc, e.dimStyle, e);
  const h = (dv.txt || 2.5) * (dv.scale || 1);
  const st = host.use(e, ctx);
  const xAxis = norm3(e.xAxis ?? [1, 0, 0]);
  const z = norm3(e.extrusion ?? [0, 0, 1]);
  const y: Vec3 = [z[1] * xAxis[2] - z[2] * xAxis[1], z[2] * xAxis[0] - z[0] * xAxis[2], z[0] * xAxis[1] - z[1] * xAxis[0]];
  const base = multiply(m, new Float64Array([xAxis[0], y[0], z[0], e.insert[0], xAxis[1], y[1], z[1], e.insert[1], xAxis[2], y[2], z[2], e.insert[2]]));
  const lines = String(e.text).split(/\^J/);
  const rowH = h * 2;
  lines.forEach((line, row) => {
    const cells = line.split(/%%v/i);
    let x = 0;
    const top = -row * rowH;
    cells.forEach((raw, idx) => {
      const text = raw.replace(/\{\\Fgdt;([a-z])\}/gi, (_m, ch: string) => GDT[ch.toLowerCase()] ?? ch).replace(/\\F[^;]*;|[{}]/g, '');
      const t = newEntityBase('TEXT', e.id, e.tagStart, e.tagEnd);
      Object.assign(t, { text, insert: [x + h * 0.5, top - rowH + h * 0.5, 0], height: h, rotation: 0, widthFactor: 1, oblique: 0, style: 'STANDARD', generation: 0, halign: 0, valign: 0 });
      const p = layoutText(t as never, host.doc.styles.get('STANDARD'), host.measurer);
      const w = p ? p.layout.maxX - p.layout.minX + h : h * 2;
      if (p && text.trim()) host.text(p, base, st, e.id);
      if (idx < cells.length - 1 || cells.length === 1 || text.trim()) {
        host.useStyle(st);
        host.out.setMatrix(base);
        polyline(
          host,
          [
            [x, top, 0],
            [x + w, top, 0],
            [x + w, top - rowH, 0],
            [x, top - rowH, 0],
          ],
          true,
        );
      }
      x += w;
    });
  });
}

function emitMLine(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  const style = mlineStyle(host.doc, e.styleHandle, e.styleName);
  const verts = e.vertices as { point: Vec3; miter: Vec3; params: number[][] }[];
  if (verts.length < 2) return;
  const n = Math.max(e.elementCount || 0, verts[0].params.length);
  const closed = (e.flags & 2) !== 0;
  const lines: Vec3[][] = [];
  for (let k = 0; k < n; k++) {
    const pts: Vec3[] = [];
    for (const v of verts) {
      const d = v.params[k]?.[0] ?? 0;
      pts.push([v.point[0] + v.miter[0] * d, v.point[1] + v.miter[1] * d, v.point[2] + v.miter[2] * d]);
    }
    lines.push(pts);
    const el = style?.elements[k];
    const fake = { ...e, color: el?.color ?? 256, linetype: el?.linetype && !/^bylayer$/i.test(el.linetype) ? el.linetype : undefined };
    host.use(fake, ctx);
    host.out.setMatrix(m);
    polyline(host, pts, closed);
  }
  if (!closed && lines.length >= 2) {
    host.use(e, ctx);
    host.out.setMatrix(m);
    const flags = style?.flags ?? 0;
    if (!(e.flags & 4) && flags & 16) polyline(host, [lines[0][0], lines[lines.length - 1][0]]);
    const last = verts.length - 1;
    if (!(e.flags & 8) && flags & 256) polyline(host, [lines[0][last], lines[lines.length - 1][last]]);
  }
}

function emitImage(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  const st = host.use(e, ctx);
  const [w, h] = e.size as [number, number];
  const P = (x: number, y: number): Vec3 => {
    const p: Vec3 = [e.insert[0] + e.u[0] * x + e.v[0] * y, e.insert[1] + e.u[1] * x + e.v[1] * y, e.insert[2] + e.u[2] * x + e.v[2] * y];
    return applyPoint(m, p[0], p[1], p[2]);
  };
  const corners = [P(0, 0), P(w, 0), P(w, h), P(0, h)];
  let clip: Vec3[] | undefined;
  const cl = e.clip as [number, number][];
  if ((e.clipping || e.type === 'WIPEOUT') && cl.length >= 2) {
    // clip vertices are pixel coordinates relative to the pixel centers
    const pts = cl.length === 2 ? [cl[0], [cl[1][0], cl[0][1]], cl[1], [cl[0][0], cl[1][1]]] : cl;
    clip = pts.map(([x, y]) => P(x + 0.5, y + 0.5));
  }
  const def = e.type === 'IMAGE' ? imageDef(host.doc, e.imageDef) : undefined;
  const fileName = def?.fileName ?? '';
  host.image({ corners, clip, label: fileName.replace(/^.*[\\/]/, ''), wipeout: e.type === 'WIPEOUT', fileName, width: w, height: h }, st, e.id);
}

function emitUnderlay(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  host.use(e, ctx);
  const um = multiply(multiply(multiply(m, ocsToWcs(e.extrusion)), translation(e.insert[0], e.insert[1], e.insert[2])), multiply(rotationZ((e.rotation || 0) * DEG), scaling(e.scale[0] || 1, e.scale[1] || 1, 1)));
  const def = underlayDef(host.doc, e.definition);
  const name = `${e.type.replace('UNDERLAY', '')}: ${(def?.fileName ?? '').replace(/^.*[\\/]/, '')}${def?.name ? ` (${def.name})` : ''}`;
  host.out.setMatrix(um);
  const cl = e.clip as [number, number][];
  if (cl.length >= 2) {
    const pts = cl.length === 2 ? [cl[0], [cl[1][0], cl[0][1]], cl[1], [cl[0][0], cl[1][1]]] : cl;
    polyline(
      host,
      pts.map(([x, y]) => [x, y, 0] as Vec3),
      true,
    );
  } else {
    polyline(host, [
      [-0.5, 0, 0],
      [0.5, 0, 0],
    ]);
    polyline(host, [
      [0, -0.5, 0],
      [0, 0.5, 0],
    ]);
  }
  label(host, name, [0, -1, 0], 0.4, um, e, ctx);
}

function emitOle(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  host.use(e, ctx);
  host.out.setMatrix(m);
  const [x0, y0] = e.upperLeft;
  const [x1, y1] = e.lowerRight;
  polyline(
    host,
    [
      [x0, y0, 0],
      [x1, y0, 0],
      [x1, y1, 0],
      [x0, y1, 0],
    ],
    true,
  );
  polyline(host, [
    [x0, y0, 0],
    [x1, y1, 0],
  ]);
  label(host, `OLE ${e.oleType ?? ''}`.trim(), [x0, y1 + Math.abs(y0 - y1) * 0.02, 0], Math.abs(y0 - y1) * 0.05, m, e, ctx);
}

function emitShape(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  host.use(e, ctx);
  const sm = multiply(multiply(m, ocsToWcs(e.extrusion)), translation(e.insert[0], e.insert[1], e.insert[2]));
  host.out.setMatrix(sm);
  const r = (e.size || 1) / 2;
  host.out.beginPath('stroke');
  host.out.moveTo(r, 0, 0);
  host.out.arc(0, 0, 0, r, 0, 0, 0, r, 0, 0, Math.PI * 2);
  host.out.endPath();
  label(host, e.name, [r * 1.2, -r / 2, 0], r, sm, e, ctx);
  host.diag('shape', 'SHAPE entities are shown as placeholders (shape file not available)', e.handle);
}

function emitMesh(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  host.use(e, ctx);
  host.out.setMatrix(m);
  const v = e.vertices as Vec3[];
  if (e.faces.length) {
    for (const f of e.faces as number[][]) {
      const pts = f.map((i) => v[i]).filter(Boolean);
      polyline(host, pts, true);
    }
  } else {
    for (const [a, b] of e.edges as [number, number][]) if (v[a] && v[b]) polyline(host, [v[a], v[b]]);
  }
}

/** Outer bounds of an ACIS body from SAT "point" records (frame only). */
function emitAcis(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx): void {
  if (e.satStart === undefined) {
    host.diag('acis', `${e.type}: ACIS (SAB) data is not rendered`, e.handle);
    return;
  }
  const t = host.doc.tags;
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let found = 0;
  for (let i = e.satStart; i < e.satEnd; i++) {
    const c = t.code(i);
    if (c !== 1 && c !== 3) continue;
    const raw = t.str(i);
    // R2000–R2010 store SAT text with a character substitution; plain text otherwise
    const line = /\bpoint\b|\bbody\b/.test(raw) ? raw : decodeSat(raw);
    const mm = /\bpoint\b[^#]*?(-?\d[\d.eE+-]*)\s+(-?\d[\d.eE+-]*)\s+(-?\d[\d.eE+-]*)\s*#/.exec(line);
    if (!mm) continue;
    const p = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
    if (p.some((x) => !Number.isFinite(x))) continue;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
    found++;
  }
  if (!found) {
    host.diag('acis', `${e.type}: no vertices found in ACIS data (not rendered)`, e.handle);
    return;
  }
  host.use(e, ctx);
  host.out.setMatrix(m);
  const z = (min[2] + max[2]) / 2;
  polyline(
    host,
    [
      [min[0], min[1], z],
      [max[0], min[1], z],
      [max[0], max[1], z],
      [min[0], max[1], z],
    ],
    true,
  );
  host.diag('acis', `${e.type}: ACIS solids are shown as bounding frames`, e.handle);
}

function emitTable(host: EmitHost, e: E, m: Mat34, ctx: InheritCtx, depth: number): boolean {
  if (!e.name || !host.doc.blocks.has(nameKey(e.name))) return false;
  const tm = multiply(
    multiply(multiply(m, ocsToWcs(e.extrusion)), translation(e.insert[0], e.insert[1], e.insert[2])),
    multiply(rotationZ((e.rotation || 0) * DEG), scaling(e.scale[0] || 1, e.scale[1] || 1, e.scale[2] || 1)),
  );
  const block = host.doc.blocks.get(nameKey(e.name))!;
  const bm = multiply(tm, translation(-block.base[0], -block.base[1], -block.base[2]));
  const child = host.styles.childCtx(e, ctx, 1);
  return host.block(e.name, bm, e, child, depth + 1);
}

/** Simplified DIMENSION geometry when the *D block is missing. */
export function emitDimensionFallback(host: EmitHost, d: DimensionEntity, m: Mat34, ctx: InheritCtx, depth: number): void {
  const dv = dimVars(host.doc, d.dimStyle, d);
  const s = dv.scale || 1;
  const asz = dv.asz * s;
  const txt = dv.txt * s;
  const type = d.dimType & 0x0f;
  host.use(d, ctx);
  host.out.setMatrix(m);
  const W = (p: Vec3 | undefined): Vec3 => p ?? [0, 0, 0];
  let measured = d.measurement;
  let textAt = W(d.textMidpoint);
  if (type === 0 || type === 1) {
    const p1 = W(d.defPoint2);
    const p2 = W(d.defPoint3);
    const dl = W(d.defPoint);
    const ang = type === 0 ? (d.angle ?? 0) * DEG : Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const dir: Vec3 = [Math.cos(ang), Math.sin(ang), 0];
    const proj = (p: Vec3): Vec3 => {
      const t = (p[0] - dl[0]) * dir[0] + (p[1] - dl[1]) * dir[1];
      return [dl[0] + dir[0] * t, dl[1] + dir[1] * t, dl[2]];
    };
    const a = proj(p1);
    const b = proj(p2);
    polyline(host, [p1, a]);
    polyline(host, [p2, b]);
    polyline(host, [a, b]);
    measured ??= Math.hypot(b[0] - a[0], b[1] - a[1]);
    const la = applyPoint(m, ...a);
    const lb = applyPoint(m, ...b);
    emitArrow(host, dv.blk1 || dv.blk, la, Math.atan2(la[1] - lb[1], la[0] - lb[0]), asz, d, ctx, depth + 1);
    emitArrow(host, dv.blk2 || dv.blk, lb, Math.atan2(lb[1] - la[1], lb[0] - la[0]), asz, d, ctx, depth + 1);
    if (!d.textMidpoint) textAt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + txt, a[2]];
  } else if (type === 3 || type === 4) {
    const c = W(d.defPoint);
    const p = W(d.defPoint4);
    polyline(host, [c, p]);
    measured ??= Math.hypot(p[0] - c[0], p[1] - c[1]);
    const lp = applyPoint(m, ...p);
    const lc = applyPoint(m, ...c);
    emitArrow(host, dv.blk, lp, Math.atan2(lp[1] - lc[1], lp[0] - lc[0]), asz, d, ctx, depth + 1);
  }
  const value = measured !== undefined ? Number(measured.toFixed(Math.max(0, Math.min(8, dv.dec)))).toString() : '';
  const prefix = type === 3 ? 'Ø' : type === 4 ? 'R' : '';
  let text = d.textOverride === '' || d.textOverride === undefined ? `${prefix}${value}` : d.textOverride.replace(/<>/g, `${prefix}${value}`);
  if (text === ' ') text = '';
  if (text) {
    const mt = newEntityBase('MTEXT', d.id, d.tagStart, d.tagEnd) as unknown as MTextEntity;
    Object.assign(mt, { text, insert: textAt, height: txt, refWidth: 0, attachment: 5, direction: 1, style: 'STANDARD', rotation: (d.textRotation ?? 0) * DEG, lineSpacingStyle: 1, lineSpacingFactor: 1, bgFlags: 0, bgScale: 1.5, columnType: 0, columnCount: 0, columnWidth: 0, columnGutter: 0, columnHeights: [] });
    const p = layoutMText(mt, (n) => host.doc.styles.get(nameKey(n)), host.measurer);
    if (p) host.text(p, m, host.use(d, ctx), d.id);
  }
}

/** Emit a complex entity. Returns false when nothing could be drawn. */
export function emitComplex(host: EmitHost, e: Entity, m: Mat34, ctx: InheritCtx, depth: number): boolean {
  const x = e as E;
  switch (e.type) {
    case 'XLINE':
    case 'RAY': {
      const st = host.use(e, ctx);
      host.infinite(applyPoint(m, ...(x.base as [number, number, number])), applyVector(m, ...(x.direction as [number, number, number])), e.type === 'RAY', st, e.id);
      return true;
    }
    case 'HATCH':
    case 'MPOLYGON': {
      const st = host.use(e, ctx);
      const h = x as HatchEntity & Entity;
      const hm = multiply(multiply(m, ocsToWcs(e.extrusion)), translation(0, 0, h.elevation?.[2] ?? 0));
      const solidColor = e.type === 'MPOLYGON' && x.fillColor !== undefined && x.fillColor !== 256 ? aciToRgb(x.fillColor) : undefined;
      host.hatch(h, hm, st, e.id, { solidColor, outline: e.type === 'MPOLYGON' });
      return true;
    }
    case 'LEADER':
      emitLeader(host, x, m, ctx, depth);
      return true;
    case 'MULTILEADER':
    case 'MLEADER':
      emitMLeader(host, x, m, ctx, depth);
      return true;
    case 'TOLERANCE':
      emitTolerance(host, x, m, ctx);
      return true;
    case 'MLINE':
      emitMLine(host, x, m, ctx);
      return true;
    case 'IMAGE':
    case 'WIPEOUT':
      emitImage(host, x, m, ctx);
      return true;
    case 'PDFUNDERLAY':
    case 'DWFUNDERLAY':
    case 'DGNUNDERLAY':
      emitUnderlay(host, x, m, ctx);
      return true;
    case 'OLE2FRAME':
      emitOle(host, x, m, ctx);
      return true;
    case 'SHAPE':
      emitShape(host, x, m, ctx);
      return true;
    case 'MESH':
      emitMesh(host, x, m, ctx);
      return true;
    case 'ACAD_TABLE':
      return emitTable(host, x, m, ctx, depth) || emitProxy(host, e, m, ctx, depth);
    default:
      if (/SOLID|REGION|BODY|SURFACE/.test(e.type) && x.modelerVersion !== undefined) {
        if (emitProxy(host, e, m, ctx, depth)) return true;
        emitAcis(host, x, m, ctx);
        return true;
      }
      return emitProxy(host, e, m, ctx, depth);
  }
}

/** Render proxy graphics if the entity carries them. */
export function emitProxy(host: EmitHost, e: Entity, m: Mat34, ctx: InheritCtx, depth: number): boolean {
  const bytes = proxyBytes(host.doc, e);
  if (!bytes) return false;
  const children = decodeProxyGraphics(host.doc, e, bytes);
  if (!children.length) return false;
  const child = host.styles.childCtx(e, ctx, 1);
  for (const c of children) {
    if (c.type === 'PROXY_FILL') {
      const st = host.use(c, child);
      host.useStyle(st);
      host.out.setMatrix(m);
      const pts = c.points as Vec3[];
      host.out.beginPath(host.fill ? 'fill' : 'stroke');
      host.out.moveTo(pts[0][0], pts[0][1], pts[0][2]);
      for (const p of pts.slice(1)) host.out.lineTo(p[0], p[1], p[2]);
      host.out.closePath();
      host.out.endPath();
      continue;
    }
    host.child(c, m, child, depth + 1);
  }
  return true;
}
