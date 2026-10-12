import { type DxfDocument, type InsertEntity, type TextEntity } from '../dxf/model';
import { CATALOG, compilePredicate, PropertyReader, type EntityPredicate } from '../filter/evaluate';
import { boxRelation, geometryInRegion, regionOf } from '../filter/spatial';
import { walkLeaves } from '../filter/walk';
import { TOP_CTX, type StyleResolver } from '../scene/style';
import type { TextMeasurer } from '../scene/textLayout';
import type { FilterCatalog, ResultRow, SearchHit } from '../shared/docApi';
import { riskyPattern, type FacetKey, type FilterSpec } from '../shared/filterSpec';
import type { TextIndex } from './textIndex';

const FACETS: FacetKey[] = ['type', 'layer', 'block', 'color', 'linetype', 'lineweight', 'style', 'xdata'];

export interface CompiledFilter {
  spec: FilterSpec;
  pred: EntityPredicate;
  /** layout name → matching top-level ids */
  matched: Map<string, Set<number>>;
  leafCount: number;
  truncated: boolean;
}

/** Filter evaluation over the entities of a document (one per worker). */
export class FilterEngine {
  readonly reader: PropertyReader;

  constructor(
    private doc: DxfDocument,
    private styles: StyleResolver,
    measurer: TextMeasurer,
  ) {
    this.reader = new PropertyReader(doc, styles, measurer);
  }

  catalog(items: number[]): FilterCatalog {
    const codes = new Set<number>();
    const apps = new Set<string>();
    const tags = new Set<string>();
    const fields = new Set<string>();
    const sample = items.length > 50_000 ? items.filter((_, i) => i % Math.ceil(items.length / 50_000) === 0) : items;
    for (const id of sample) {
      const e = this.doc.entities[id];
      for (let i = e.tagStart; i < (e.xdataStart ?? e.tagEnd); i++) codes.add(this.doc.tags.code(i));
      for (const a of e.xdataApps ?? []) apps.add(a);
      if (e.type === 'INSERT') for (const a of (e as InsertEntity).attribs) if ((a as TextEntity).tag) tags.add(String((a as TextEntity).tag));
      for (const [k, v] of Object.entries(e)) if ((typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') && !k.startsWith('_')) fields.add(k);
    }
    return {
      props: CATALOG,
      gcCodes: [...codes].sort((a, b) => a - b),
      xdataApps: [...apps].sort(),
      attrTags: [...tags].sort(),
      fields: [...fields].sort(),
    };
  }

  facets(items: number[], level: 'top' | 'leaf'): Partial<Record<FacetKey, [string, number][]>> {
    const counts = new Map<FacetKey, Map<string, number>>();
    for (const k of FACETS) counts.set(k, new Map());
    const add = (e: (typeof this.doc.entities)[number], ctx: typeof TOP_CTX, path: string[]) => {
      for (const k of FACETS) {
        const m = counts.get(k)!;
        for (const v of this.reader.facet(e, k, ctx, path)) m.set(v, (m.get(v) ?? 0) + 1);
      }
    };
    if (level === 'top') for (const id of items) add(this.doc.entities[id], TOP_CTX, []);
    else walkLeaves(this.doc, this.styles, items, (e, ctx, path) => add(e, ctx, path), 1_000_000);
    const out: Partial<Record<FacetKey, [string, number][]>> = {};
    for (const [k, m] of counts) if (m.size) out[k] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
    return out;
  }

  values(items: number[], prop: string, level: 'top' | 'leaf', limit: number): [string, number][] {
    const m = new Map<string, number>();
    const add = (v: unknown) => {
      const vals = Array.isArray(v) ? v : [v];
      for (const x of vals) {
        if (x === undefined || x === null) continue;
        const s = typeof x === 'number' ? String(Number(x.toPrecision(10))) : String(x);
        m.set(s, (m.get(s) ?? 0) + 1);
      }
    };
    if (level === 'top') for (const id of items.slice(0, 200_000)) add(this.reader.get(this.doc.entities[id], prop, TOP_CTX, []));
    else walkLeaves(this.doc, this.styles, items, (e, ctx, path) => add(this.reader.get(e, prop, ctx, path)), 300_000);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  compile(spec: FilterSpec): CompiledFilter {
    return { spec, pred: compilePredicate(spec, this.reader), matched: new Map(), leafCount: 0, truncated: false };
  }

  /** Top-level ids of `items` matching the filter (leaf level: containing a match). */
  match(f: CompiledFilter, layout: string, items: number[]): Set<number> {
    const cached = f.matched.get(layout);
    if (cached) return cached;
    const out = new Set<number>();
    const region = f.spec.spatial ? regionOf(f.spec.spatial) : null;
    const spatialOk = (id: number) => {
      if (!region) return true;
      const e = this.doc.entities[id];
      const minX = this.reader.get(e, 'minX', TOP_CTX, []) as number | undefined;
      if (minX === undefined) {
        // unbounded (XLINE/RAY) or empty: exact test only
        const g = this.reader.geometry(e);
        return !!g && geometryInRegion(g, region);
      }
      const rel = boxRelation(region, minX, this.reader.get(e, 'minY', TOP_CTX, []) as number, this.reader.get(e, 'maxX', TOP_CTX, []) as number, this.reader.get(e, 'maxY', TOP_CTX, []) as number);
      if (rel !== 'partial') return rel === 'in';
      const g = this.reader.geometry(e);
      return !!g && geometryInRegion(g, region);
    };
    if (f.spec.level === 'top') {
      for (const id of items) if (f.pred(this.doc.entities[id], TOP_CTX, []) && spatialOk(id)) out.add(id);
    } else {
      let leaves = 0;
      const ok = walkLeaves(this.doc, this.styles, items, (e, ctx, path, top) => {
        if (f.pred(e, ctx, path)) {
          leaves++;
          out.add(top);
        }
      });
      if (region) for (const id of [...out]) if (!spatialOk(id)) out.delete(id);
      f.leafCount = leaves;
      f.truncated = !ok;
    }
    f.matched.set(layout, out);
    return out;
  }

  rows(ids: number[], offset: number, limit: number): ResultRow[] {
    return ids.slice(offset, offset + limit).map((id) => {
      const e = this.doc.entities[id];
      let label = '';
      const text = this.reader.get(e, 'text', TOP_CTX, []);
      if (typeof text === 'string' && text) label = text.slice(0, 120);
      else if (e.type === 'INSERT') label = String(e.name ?? '');
      else if (typeof e.radius === 'number') label = `R ${Number((e.radius as number).toPrecision(8))}`;
      else {
        const len = this.reader.get(e, 'length', TOP_CTX, []);
        if (typeof len === 'number' && len > 0) label = `L ${Number(len.toPrecision(8))}`;
      }
      return { id, handle: e.handle, type: e.type, layer: e.layer, label };
    });
  }

  /** Free-text search over texts, handles, layer names, block names and attribute values. */
  search(items: number[], textIndex: TextIndex, q: { query: string; regex: boolean; caseSensitive: boolean; limit: number }): { total: number; hits: SearchHit[]; error?: string } {
    let test: (s: string) => boolean;
    if (q.regex) {
      if (riskyPattern(q.query)) return { total: 0, hits: [], error: 'Pattern not evaluated: too long or nested quantifiers (can hang)' };
      try {
        const re = new RegExp(q.query, q.caseSensitive ? 'u' : 'iu');
        test = (s) => re.test(s);
      } catch (err) {
        return { total: 0, hits: [], error: (err as Error).message };
      }
    } else {
      const needle = q.caseSensitive ? q.query : q.query.toLowerCase();
      test = (s) => (q.caseSensitive ? s : s.toLowerCase()).includes(needle);
    }
    const inScope = new Set(items);
    const hits: SearchHit[] = [];
    let total = 0;
    const push = (id: number, field: string, text: string) => {
      total++;
      if (hits.length < q.limit) {
        const e = this.doc.entities[id];
        hits.push({ id, handle: e.handle, type: e.type, layer: e.layer, field, text: text.slice(0, 200) });
      }
    };
    // texts (top-level or attributes of top-level inserts)
    for (const r of textIndex.rows) {
      const e = this.doc.entities[r.id];
      const top = typeof e.parentInsert === 'number' ? (e.parentInsert as number) : r.id;
      if (!inScope.has(top)) continue;
      if (test(r.plain) || (r.tag && test(r.tag))) push(top, r.tag ? `attribute ${r.tag}` : 'text', r.plain);
    }
    const handleQ = q.query.trim().toUpperCase();
    for (const id of items) {
      const e = this.doc.entities[id];
      if (!q.regex && e.handle.toUpperCase() === handleQ) push(id, 'handle', e.handle);
      if (test(e.layer)) push(id, 'layer', e.layer);
      if (e.type === 'INSERT') {
        const name = String(e.name ?? '');
        if (test(name)) push(id, 'block', name);
        else {
          const eff = this.reader.effectiveBlockName(name);
          if (eff !== name && test(eff)) push(id, 'block', eff);
        }
      }
    }
    return { total, hits };
  }
}
