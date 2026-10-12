import { aciToRgb } from '../dxf/colors';
import { nameKey, type DxfDocument, type Entity, type InsertEntity, type TextEntity } from '../dxf/model';
import { decodeEscapes, plainText } from '../dxf/text/escapes';
import { mtextPlain } from '../dxf/text/mtext';
import { identity } from '../geom/matrix';
import { isDefaultExtrusion } from '../geom/ocs';
import { FlattenHost } from '../scene/flatten';
import type { FlatGeometry } from './spatial';
import type { InheritCtx, StyleResolver } from '../scene/style';
import type { TextMeasurer } from '../scene/textLayout';
import { riskyPattern, type CatalogProp, type FacetKey, type FilterCond, type FilterGroup, type FilterSpec } from '../shared/filterSpec';

export const CATALOG: CatalogProp[] = [
  { key: 'type', label: 'Entity type', type: 'string', group: 'General' },
  { key: 'handle', label: 'Handle', type: 'string', group: 'General' },
  { key: 'layer', label: 'Layer (as written)', type: 'string', group: 'General' },
  { key: 'effectiveLayer', label: 'Layer (effective)', type: 'string', group: 'General' },
  { key: 'color', label: 'Color (as written)', type: 'string', group: 'General' },
  { key: 'aci', label: 'Color number (ACI)', type: 'number', group: 'General' },
  { key: 'effectiveColor', label: 'Effective color (#rrggbb)', type: 'string', group: 'General' },
  { key: 'linetype', label: 'Linetype (as written)', type: 'string', group: 'General' },
  { key: 'effectiveLinetype', label: 'Linetype (effective)', type: 'string', group: 'General' },
  { key: 'lineweight', label: 'Lineweight (1/100 mm, as written)', type: 'number', group: 'General' },
  { key: 'effectiveLineweight', label: 'Lineweight (effective, 1/100 mm)', type: 'number', group: 'General' },
  { key: 'transparency', label: 'Transparency (%)', type: 'number', group: 'General' },
  { key: 'space', label: 'Space / container', type: 'string', group: 'General' },
  { key: 'layout', label: 'Layout name', type: 'string', group: 'General' },
  { key: 'owner', label: 'Owner handle', type: 'string', group: 'General' },
  { key: 'invisible', label: 'Invisible flag', type: 'boolean', group: 'General' },
  { key: 'depth', label: 'Nesting depth', type: 'number', group: 'Blocks' },
  { key: 'blockPath', label: 'Block path (outer/inner)', type: 'string', group: 'Blocks' },
  { key: 'blockName', label: 'Block name (references)', type: 'string', group: 'Blocks' },
  { key: 'effectiveBlockName', label: 'Effective block name (dynamic blocks)', type: 'string', group: 'Blocks' },
  { key: 'mirrored', label: 'Mirrored reference', type: 'boolean', group: 'Blocks' },
  { key: 'scaleX', label: 'Scale X', type: 'number', group: 'Blocks' },
  { key: 'scaleY', label: 'Scale Y', type: 'number', group: 'Blocks' },
  { key: 'text', label: 'Text (plain)', type: 'string', group: 'Text' },
  { key: 'textRaw', label: 'Text (raw codes)', type: 'string', group: 'Text' },
  { key: 'textStyle', label: 'Text style', type: 'string', group: 'Text' },
  { key: 'textHeight', label: 'Text height', type: 'number', group: 'Text' },
  { key: 'rotation', label: 'Rotation (deg)', type: 'number', group: 'Geometry' },
  { key: 'length', label: 'Length', type: 'number', group: 'Geometry' },
  { key: 'area', label: 'Area', type: 'number', group: 'Geometry' },
  { key: 'radius', label: 'Radius', type: 'number', group: 'Geometry' },
  { key: 'minX', label: 'Bounds min X', type: 'number', group: 'Geometry' },
  { key: 'minY', label: 'Bounds min Y', type: 'number', group: 'Geometry' },
  { key: 'maxX', label: 'Bounds max X', type: 'number', group: 'Geometry' },
  { key: 'maxY', label: 'Bounds max Y', type: 'number', group: 'Geometry' },
  { key: 'width', label: 'Bounds width', type: 'number', group: 'Geometry' },
  { key: 'height', label: 'Bounds height', type: 'number', group: 'Geometry' },
  { key: 'centerX', label: 'Bounds center X', type: 'number', group: 'Geometry' },
  { key: 'centerY', label: 'Bounds center Y', type: 'number', group: 'Geometry' },
  { key: 'elevation', label: 'Elevation / Z', type: 'number', group: 'Geometry' },
  { key: 'nonPlanarExtrusion', label: 'Non-default extrusion (OCS)', type: 'boolean', group: 'Geometry' },
  { key: 'closed', label: 'Closed', type: 'boolean', group: 'Geometry' },
  { key: 'vertexCount', label: 'Vertex count', type: 'number', group: 'Geometry' },
  { key: 'measurement', label: 'Dimension measurement', type: 'number', group: 'Annotation' },
  { key: 'dimStyle', label: 'Dimension style', type: 'string', group: 'Annotation' },
  { key: 'pattern', label: 'Hatch pattern', type: 'string', group: 'Annotation' },
  { key: 'solidFill', label: 'Solid fill', type: 'boolean', group: 'Annotation' },
  { key: 'xdataApps', label: 'XDATA applications', type: 'string', group: 'Data' },
  { key: 'hasXdata', label: 'Has XDATA', type: 'boolean', group: 'Data' },
  { key: 'hasProxyGraphics', label: 'Has proxy graphics', type: 'boolean', group: 'Data' },
  { key: 'tagCount', label: 'Number of group codes', type: 'number', group: 'Data' },
];

type Val = string | number | boolean | (string | number)[] | undefined;

interface Metrics {
  length: number;
  area?: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Reads catalog properties of entities (with inheritance context for nested ones). */
export class PropertyReader {
  private metricsCache = new Map<number, Metrics | null>();
  private host: FlattenHost;
  private dynamicNames = new Map<string, string>();

  constructor(
    private doc: DxfDocument,
    private styles: StyleResolver,
    measurer: TextMeasurer,
  ) {
    this.host = new FlattenHost({ doc, measurer, styles });
    const byHandle = new Map(doc.tableRecords.filter((r) => r.table === 'BLOCK_RECORD' && r.handle).map((r) => [r.handle!.toUpperCase(), r.name]));
    for (const r of doc.tableRecords) {
      if (r.table === 'BLOCK_RECORD' && r.dynamicSource) {
        const src = byHandle.get(String(r.dynamicSource).toUpperCase());
        if (src) this.dynamicNames.set(nameKey(r.name), src);
      }
    }
  }

  private metrics(e: Entity): Metrics | null {
    if (this.metricsCache.has(e.id)) return this.metricsCache.get(e.id)!;
    let m: Metrics | null = null;
    try {
      this.host.reset();
      this.host.visit(e, identity());
      const out = this.host.out;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pl of out.polylines)
        for (let i = 0; i < pl.length; i += 2) {
          if (pl[i] < minX) minX = pl[i];
          if (pl[i] > maxX) maxX = pl[i];
          if (pl[i + 1] < minY) minY = pl[i + 1];
          if (pl[i + 1] > maxY) maxY = pl[i + 1];
        }
      m = minX <= maxX ? { length: out.length(), area: out.area(), minX, minY, maxX, maxY } : null;
    } catch {
      m = null;
    }
    if (this.metricsCache.size > 200_000) this.metricsCache.clear();
    this.metricsCache.set(e.id, m);
    return m;
  }

  /** Flattened world geometry (not cached; used for exact spatial tests). */
  geometry(e: Entity): FlatGeometry | null {
    try {
      this.host.reset();
      this.host.visit(e, identity());
      return { polylines: this.host.out.polylines, fills: this.host.out.fills, infinite: this.host.infiniteLines };
    } catch {
      return null;
    }
  }

  effectiveBlockName(name: string): string {
    return this.dynamicNames.get(nameKey(name)) ?? name;
  }

  get(e: Entity, prop: string, ctx: InheritCtx, path: string[]): Val {
    const x = e as Entity & Record<string, unknown>;
    if (prop.startsWith('gc[')) {
      const code = Number(prop.slice(3, -1));
      const out: (string | number)[] = [];
      const end = code >= 1000 ? e.tagEnd : (e.xdataStart ?? e.tagEnd);
      for (let i = e.tagStart; i < end; i++) if (this.doc.tags.code(i) === code) out.push(decodeEscapes(this.doc.tags.str(i)).trim());
      return out.length ? out : undefined;
    }
    if (prop.startsWith('xdata.')) {
      const m = /^xdata\.([^[]+)(?:\[(\d+)\])?$/.exec(prop);
      if (!m || e.xdataStart === undefined) return undefined;
      const app = m[1].toUpperCase();
      const code = m[2] !== undefined ? Number(m[2]) : undefined;
      let inApp = false;
      let found = false;
      const vals: string[] = [];
      for (let i = e.xdataStart; i < e.tagEnd; i++) {
        const c = this.doc.tags.code(i);
        if (c === 1001) {
          inApp = this.doc.tags.str(i).trim().toUpperCase() === app;
          if (inApp) found = true;
          continue;
        }
        if (inApp && (code === undefined || c === code)) vals.push(decodeEscapes(this.doc.tags.str(i)));
      }
      if (code === undefined) return found;
      return vals.length ? vals : undefined;
    }
    if (prop.startsWith('attr.')) {
      if (e.type !== 'INSERT') return undefined;
      const tag = prop.slice(5).toUpperCase();
      const a = (e as InsertEntity).attribs.find((t) => String((t as TextEntity).tag ?? '').toUpperCase() === tag) as TextEntity | undefined;
      return a ? (a.mtext ? mtextPlain(a.mtext.text) : plainText(a.text)) : undefined;
    }
    if (prop.startsWith('field.')) {
      const v = x[prop.slice(6)];
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
      if (Array.isArray(v) && v.every((i) => typeof i === 'number')) return v as number[];
      return JSON.stringify(v);
    }
    switch (prop) {
      case 'type':
        return e.type;
      case 'handle':
        return e.handle;
      case 'layer':
        return decodeEscapes(e.layer);
      case 'effectiveLayer':
        return decodeEscapes(this.styles.effectiveLayer(e, ctx));
      case 'color':
        return e.trueColor !== undefined ? '#' + e.trueColor.toString(16).padStart(6, '0') : e.color === 256 ? 'BYLAYER' : e.color === 0 ? 'BYBLOCK' : `ACI ${e.color}`;
      case 'aci':
        return e.color;
      case 'effectiveColor': {
        const st = this.styles.resolve(e, ctx);
        return st.fg ? 'foreground' : '#' + st.rgb.toString(16).padStart(6, '0');
      }
      case 'linetype':
        return e.linetype ?? 'BYLAYER';
      case 'effectiveLinetype': {
        const st = this.styles.resolve(e, ctx);
        return st.lt < 0 ? 'CONTINUOUS' : this.styles.linetypes[st.lt]?.name;
      }
      case 'lineweight':
        return e.lineweight;
      case 'effectiveLineweight':
        return this.styles.resolve(e, ctx).lw;
      case 'transparency':
        return e.transparency !== undefined && e.transparency & 0x02000000 ? Math.round((1 - (e.transparency & 0xff) / 255) * 100) : undefined;
      case 'space':
        return path.length ? `Block: ${path[path.length - 1]}` : e.block ? `Block: ${e.block}` : e.paperSpace ? 'Paper' : 'Model';
      case 'layout':
        return e.layoutName;
      case 'owner':
        return e.owner;
      case 'invisible':
        return e.invisible;
      case 'depth':
        return path.length;
      case 'blockPath':
        return path.join('/');
      case 'blockName':
        return e.type === 'INSERT' || e.type === 'ACAD_TABLE' ? String(x.name ?? '') : e.type.endsWith('DIMENSION') ? String(x.blockName ?? '') : undefined;
      case 'effectiveBlockName':
        return e.type === 'INSERT' ? this.effectiveBlockName(String(x.name ?? '')) : undefined;
      case 'mirrored':
        return e.type === 'INSERT' ? ((e as InsertEntity).scale[0] || 1) * ((e as InsertEntity).scale[1] || 1) < 0 : undefined;
      case 'scaleX':
        return e.type === 'INSERT' ? (e as InsertEntity).scale[0] : undefined;
      case 'scaleY':
        return e.type === 'INSERT' ? (e as InsertEntity).scale[1] : undefined;
      case 'text': {
        if (e.type === 'MTEXT') return mtextPlain(String(x.text));
        if (e.type === 'TEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF') return (e as TextEntity).mtext ? mtextPlain((e as TextEntity).mtext!.text) : plainText(String(x.text));
        if (e.type === 'INSERT') return (e as InsertEntity).attribs.map((a) => plainText(String(a.text))).join(' ');
        if (e.type.endsWith('DIMENSION')) return String(x.textOverride ?? '') || (typeof x.measurement === 'number' ? String(x.measurement) : undefined);
        return undefined;
      }
      case 'textRaw':
        return typeof x.text === 'string' ? x.text : undefined;
      case 'textStyle':
        return typeof x.style === 'string' && (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF') ? x.style : undefined;
      case 'textHeight':
        return e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF' ? (x.height as number) : undefined;
      case 'rotation':
        return typeof x.rotation === 'number' ? (e.type === 'MTEXT' ? ((x.rotation as number) * 180) / Math.PI : (x.rotation as number)) : undefined;
      case 'radius':
        return typeof x.radius === 'number' ? x.radius : undefined;
      case 'length':
        return this.metrics(e)?.length;
      case 'area':
        return this.metrics(e)?.area;
      case 'minX':
      case 'minY':
      case 'maxX':
      case 'maxY':
        return this.metrics(e)?.[prop];
      case 'width': {
        const m = this.metrics(e);
        return m ? m.maxX - m.minX : undefined;
      }
      case 'height': {
        const m = this.metrics(e);
        return m ? m.maxY - m.minY : undefined;
      }
      case 'centerX': {
        const m = this.metrics(e);
        return m ? (m.minX + m.maxX) / 2 : undefined;
      }
      case 'centerY': {
        const m = this.metrics(e);
        return m ? (m.minY + m.maxY) / 2 : undefined;
      }
      case 'elevation': {
        for (const k of ['start', 'center', 'insert', 'position', 'elevation']) {
          const v = x[k];
          if (Array.isArray(v) && typeof v[2] === 'number') return v[2];
          if (typeof v === 'number') return v;
        }
        return undefined;
      }
      case 'nonPlanarExtrusion':
        return !isDefaultExtrusion(e.extrusion);
      case 'closed':
        return e.type === 'LWPOLYLINE' ? !!x.closed : e.type === 'POLYLINE' ? ((x.flags as number) & 1) !== 0 : e.type === 'CIRCLE' || e.type === 'ELLIPSE' ? true : undefined;
      case 'vertexCount':
        return e.type === 'LWPOLYLINE' ? (x.points as number[]).length / 2 : e.type === 'POLYLINE' ? (x.vertices as unknown[]).length : e.type === 'SPLINE' ? (x.ctrl as unknown[]).length || (x.fit as unknown[]).length : undefined;
      case 'measurement':
        return typeof x.measurement === 'number' ? x.measurement : undefined;
      case 'dimStyle':
        return typeof x.dimStyle === 'string' ? x.dimStyle : undefined;
      case 'pattern':
        return e.type === 'HATCH' || e.type === 'MPOLYGON' ? String(x.pattern ?? '') : undefined;
      case 'solidFill':
        return e.type === 'HATCH' || e.type === 'MPOLYGON' ? !!x.solid : undefined;
      case 'xdataApps':
        return e.xdataApps?.length ? e.xdataApps : undefined;
      case 'hasXdata':
        return !!e.xdataApps?.length;
      case 'hasProxyGraphics':
        return !!e.proxyGraphics;
      case 'tagCount':
        return e.tagEnd - e.tagStart;
      default:
        return undefined;
    }
  }

  /**
   * Facet value used for grouping/filtering. For entities inside blocks
   * (`path` non-empty) the block facet lists every containing block.
   */
  facet(e: Entity, key: FacetKey, ctx: InheritCtx, path: string[] = []): string[] {
    switch (key) {
      case 'type':
        return [e.type];
      case 'layer':
        return [decodeEscapes(this.styles.effectiveLayer(e, ctx))];
      case 'block': {
        const out = new Set<string>();
        const n = this.get(e, 'blockName', ctx, []);
        for (const b of typeof n === 'string' && n ? [...path, n] : path) {
          out.add(b);
          out.add(this.effectiveBlockName(b));
        }
        return [...out];
      }
      case 'color': {
        const st = this.styles.resolve(e, ctx);
        if (st.fg) return ['ACI 7 / foreground'];
        if (e.trueColor !== undefined) return ['#' + st.rgb.toString(16).padStart(6, '0')];
        const aci = e.color === 256 || e.color === 0 ? this.styles.layers[st.layer].aci : Math.abs(e.color);
        return aciToRgb(aci) === st.rgb ? [`ACI ${aci}`] : ['#' + st.rgb.toString(16).padStart(6, '0')];
      }
      case 'linetype':
        return [String(this.get(e, 'effectiveLinetype', ctx, []) ?? 'CONTINUOUS')];
      case 'lineweight': {
        const lw = this.styles.resolve(e, ctx).lw;
        return [`${(lw / 100).toFixed(2)} mm`];
      }
      case 'style': {
        const s = this.get(e, 'textStyle', ctx, []);
        return typeof s === 'string' ? [s] : [];
      }
      case 'xdata':
        return e.xdataApps ?? [];
    }
  }
}

function toNum(s: string | undefined): number {
  const v = s === undefined ? NaN : Number(s);
  return Number.isFinite(v) ? v : NaN;
}

function testCond(c: FilterCond, v: Val, regexCache: Map<string, RegExp | null>): boolean {
  if (c.op === 'exists') return v !== undefined && !(Array.isArray(v) && !v.length);
  if (c.op === 'notExists') return v === undefined || (Array.isArray(v) && !v.length);
  if (v === undefined) return c.op === 'ne' || c.op === 'notContains';
  const values = Array.isArray(v) ? v : [v];
  const cs = !!c.caseSensitive;
  const norm = (s: string) => (cs ? s : s.toLowerCase());
  const target = c.value ?? '';
  const any = (fn: (x: string | number | boolean) => boolean) => values.some(fn);
  switch (c.op) {
    case 'eq':
      return any((x) => (typeof x === 'number' ? x === toNum(target) : typeof x === 'boolean' ? String(x) === norm(target) : norm(String(x)) === norm(target)));
    case 'ne':
      return !any((x) => (typeof x === 'number' ? x === toNum(target) : norm(String(x)) === norm(target)));
    case 'contains':
      return any((x) => norm(String(x)).includes(norm(target)));
    case 'notContains':
      return !any((x) => norm(String(x)).includes(norm(target)));
    case 'startsWith':
      return any((x) => norm(String(x)).startsWith(norm(target)));
    case 'endsWith':
      return any((x) => norm(String(x)).endsWith(norm(target)));
    case 'in': {
      const set = new Set(target.split(/[,\n]/).map((s) => norm(s.trim())).filter(Boolean));
      return any((x) => set.has(norm(String(x))));
    }
    case 'regex': {
      const key = `${cs ? 'c' : 'i'}:${target}`;
      let re = regexCache.get(key);
      if (re === undefined) {
        try {
          // patterns prone to catastrophic backtracking are refused (see regexIssues)
          re = riskyPattern(target) ? null : new RegExp(target, cs ? 'u' : 'iu');
        } catch {
          re = null;
        }
        regexCache.set(key, re);
      }
      return !!re && any((x) => re!.test(String(x).slice(0, 10_000)));
    }
    case 'lt':
      return any((x) => typeof x === 'number' && x < toNum(target));
    case 'le':
      return any((x) => typeof x === 'number' && x <= toNum(target));
    case 'gt':
      return any((x) => typeof x === 'number' && x > toNum(target));
    case 'ge':
      return any((x) => typeof x === 'number' && x >= toNum(target));
    case 'between': {
      const a = toNum(target);
      const b = toNum(c.value2);
      return any((x) => typeof x === 'number' && x >= Math.min(a, b) && x <= Math.max(a, b));
    }
  }
  return false;
}

export type EntityPredicate = (e: Entity, ctx: InheritCtx, path: string[]) => boolean;

/** Compile facets + condition tree into a predicate. */
export function compilePredicate(spec: FilterSpec, reader: PropertyReader): EntityPredicate {
  const regexCache = new Map<string, RegExp | null>();
  const facets = (Object.entries(spec.facets) as [FacetKey, string[] | undefined][])
    .filter(([, v]) => v && v.length)
    .map(([k, v]) => [k, new Set(v!.map((s) => s.toLowerCase()))] as const);
  const evalGroup = (g: FilterGroup, e: Entity, ctx: InheritCtx, path: string[]): boolean => {
    if (!g.items.length) return !g.not;
    const res = g.logic === 'and' ? g.items.every((it) => evalItem(it, e, ctx, path)) : g.items.some((it) => evalItem(it, e, ctx, path));
    return g.not ? !res : res;
  };
  const evalItem = (it: FilterCond | FilterGroup, e: Entity, ctx: InheritCtx, path: string[]): boolean =>
    it.kind === 'group' ? evalGroup(it, e, ctx, path) : testCond(it, reader.get(e, it.prop, ctx, path), regexCache);
  return (e, ctx, path) => {
    for (const [k, set] of facets) {
      if (!reader.facet(e, k, ctx, path).some((v) => set.has(v.toLowerCase()))) return false;
    }
    return evalGroup(spec.where, e, ctx, path);
  };
}
