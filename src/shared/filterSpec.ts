/**
 * Declarative filter definition (JSON-serializable, never executed as code).
 * Shared by the UI, URL sharing and the worker evaluator.
 */
export type FilterOp =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'between'
  | 'exists'
  | 'notExists'
  | 'in';

export interface FilterCond {
  kind: 'cond';
  /** property key from the catalog, e.g. "layer", "length", "gc[8]", "xdata.APP", "attr.TAG" */
  prop: string;
  op: FilterOp;
  value?: string;
  value2?: string;
  caseSensitive?: boolean;
}

export interface FilterGroup {
  kind: 'group';
  logic: 'and' | 'or';
  not?: boolean;
  items: (FilterCond | FilterGroup)[];
}

export type FacetKey = 'type' | 'layer' | 'block' | 'color' | 'linetype' | 'lineweight' | 'style' | 'xdata';

export type SpatialSpec =
  | { kind: 'rect'; minX: number; minY: number; maxX: number; maxY: number; mode: 'inside' | 'crossing' }
  /** flat [x0, y0, x1, y1, …] world coordinates, implicitly closed */
  | { kind: 'polygon'; points: number[]; mode: 'inside' | 'crossing' };

export interface FilterSpec {
  version: 1;
  facets: Partial<Record<FacetKey, string[]>>;
  where: FilterGroup;
  /** spatial restriction in world coordinates */
  spatial?: SpatialSpec;
  /** evaluate top-level entities or entities inside blocks */
  level: 'top' | 'leaf';
  mode: 'show' | 'highlight' | 'select';
}

export function emptyFilter(): FilterSpec {
  return { version: 1, facets: {}, where: { kind: 'group', logic: 'and', items: [] }, level: 'top', mode: 'show' };
}

export function isEmptyFilter(f: FilterSpec): boolean {
  return !Object.values(f.facets).some((v) => v && v.length) && !hasConds(f.where) && !f.spatial;
}

function hasConds(g: FilterGroup): boolean {
  return g.items.some((i) => (i.kind === 'cond' ? true : hasConds(i)));
}

export const OPS_BY_TYPE: Record<'string' | 'number' | 'boolean', FilterOp[]> = {
  string: ['eq', 'ne', 'contains', 'notContains', 'startsWith', 'endsWith', 'regex', 'in', 'exists', 'notExists'],
  number: ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'between', 'exists', 'notExists'],
  boolean: ['eq', 'exists', 'notExists'],
};

export interface CatalogProp {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  group: string;
}

/** Limits for patterns coming from shared links (ReDoS hygiene). */
export const MAX_PATTERN = 300;

/** Heuristic check for regular expressions prone to catastrophic backtracking. */
export function riskyPattern(p: string): boolean {
  return p.length > MAX_PATTERN || /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/.test(p) || /(\.\*){3,}/.test(p);
}

/** Regular expressions of a filter that are rejected (invalid or too risky to evaluate). */
export function regexIssues(f: FilterSpec): { pattern: string; reason: 'invalid' | 'risky' }[] {
  const out: { pattern: string; reason: 'invalid' | 'risky' }[] = [];
  const walk = (g: FilterGroup) => {
    for (const it of g.items) {
      if (it.kind === 'group') walk(it);
      else if (it.op === 'regex' && it.value) {
        if (riskyPattern(it.value)) out.push({ pattern: it.value, reason: 'risky' });
        else
          try {
            new RegExp(it.value, 'u');
          } catch {
            out.push({ pattern: it.value, reason: 'invalid' });
          }
      }
    }
  };
  walk(f.where);
  return out;
}

export function encodeFilter(f: FilterSpec): string {
  const json = JSON.stringify(f);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ALL_OPS = new Set<string>(['eq', 'ne', 'contains', 'notContains', 'startsWith', 'endsWith', 'regex', 'lt', 'le', 'gt', 'ge', 'between', 'exists', 'notExists', 'in']);
const FACET_KEYS = new Set<string>(['type', 'layer', 'block', 'color', 'linetype', 'lineweight', 'style', 'xdata']);
const MAX_VALUE = 2000;

const str = (v: unknown, max = MAX_VALUE): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);

/**
 * Parse and validate a shared filter. Returns null for anything malformed.
 * The result is rebuilt from whitelisted fields only, so unexpected keys never reach the evaluator.
 */
export function decodeFilter(s: string): FilterSpec | null {
  try {
    if (s.length > 100_000) return null;
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || obj.version !== 1) return null;
    let count = 0;
    const group = (g: unknown, depth: number): FilterGroup | null => {
      const x = g as Record<string, unknown>;
      if (!x || x.kind !== 'group' || depth > 8 || !Array.isArray(x.items) || (x.logic !== 'and' && x.logic !== 'or')) return null;
      const items: (FilterCond | FilterGroup)[] = [];
      for (const it of x.items as unknown[]) {
        if (++count > 500) return null;
        const i = it as Record<string, unknown>;
        if (i?.kind === 'group') {
          const sub = group(i, depth + 1);
          if (!sub) return null;
          items.push(sub);
        } else if (i?.kind === 'cond') {
          const prop = str(i.prop, 200);
          if (!prop || typeof i.op !== 'string' || !ALL_OPS.has(i.op)) return null;
          const c: FilterCond = { kind: 'cond', prop, op: i.op as FilterOp };
          const v = str(i.value);
          const v2 = str(i.value2);
          if (v !== undefined) c.value = v;
          if (v2 !== undefined) c.value2 = v2;
          if (i.caseSensitive === true) c.caseSensitive = true;
          items.push(c);
        } else return null;
      }
      return { kind: 'group', logic: x.logic, not: x.not === true ? true : undefined, items };
    };
    const where = group(obj.where, 0);
    if (!where) return null;
    const facets: FilterSpec['facets'] = {};
    if (obj.facets && typeof obj.facets === 'object') {
      for (const [k, v] of Object.entries(obj.facets as Record<string, unknown>)) {
        if (!FACET_KEYS.has(k) || !Array.isArray(v)) continue;
        facets[k as FacetKey] = v.filter((x): x is string => typeof x === 'string' && x.length <= 1000).slice(0, 5000);
      }
    }
    let spatial: FilterSpec['spatial'];
    const sp = obj.spatial as Record<string, unknown> | undefined;
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (sp && typeof sp === 'object') {
      const mode = sp.mode === 'inside' ? 'inside' : 'crossing';
      if (sp.kind === 'polygon') {
        const pts = sp.points;
        if (Array.isArray(pts) && pts.length >= 6 && pts.length <= 4000 && pts.length % 2 === 0 && pts.every(finite)) spatial = { kind: 'polygon', points: pts as number[], mode };
      } else {
        const n = [sp.minX, sp.minY, sp.maxX, sp.maxY];
        if (n.every(finite)) spatial = { kind: 'rect', minX: n[0], minY: n[1], maxX: n[2], maxY: n[3], mode };
      }
    }
    return {
      version: 1,
      facets,
      where,
      spatial,
      level: obj.level === 'leaf' ? 'leaf' : 'top',
      mode: obj.mode === 'highlight' || obj.mode === 'select' ? obj.mode : 'show',
    };
  } catch {
    return null;
  }
}
