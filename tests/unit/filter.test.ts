import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseDxf } from '../../src/dxf/parser';
import type { DxfDocument, Entity, InsertEntity, TextEntity } from '../../src/dxf/model';
import { StyleResolver } from '../../src/scene/style';
import type { TextMeasurer } from '../../src/scene/textLayout';
import { decodeFilter, emptyFilter, encodeFilter, regexIssues, riskyPattern, type FilterCond, type FilterGroup, type FilterSpec } from '../../src/shared/filterSpec';
import { FilterEngine } from '../../src/worker/filtering';
import { TextIndex } from '../../src/worker/textIndex';
import { dxf, enc, entitiesDoc } from './helpers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const measurer: TextMeasurer = {
  width: (text) => text.length * 60,
  metrics: () => ({ capHeight: 0.7, ascent: 0.9, descent: 0.2 }),
};

function load(name: string): DxfDocument {
  return parseDxf(new Uint8Array(readFileSync(join(root, 'public/samples', name))), { name });
}

function engineFor(doc: DxfDocument): FilterEngine {
  return new FilterEngine(doc, new StyleResolver(doc), measurer);
}

const spec = (items: (FilterCond | FilterGroup)[], extra: Partial<FilterSpec> = {}): FilterSpec => ({
  ...emptyFilter(),
  where: { kind: 'group', logic: 'and', items },
  ...extra,
});

/** Raw values of a group code read straight from the tag store (independent of the evaluator). */
function rawCodes(doc: DxfDocument, e: Entity, code: number): string[] {
  const out: string[] = [];
  for (let i = e.tagStart; i < (e.xdataStart ?? e.tagEnd); i++) if (doc.tags.code(i) === code) out.push(doc.tags.str(i).trim());
  return out;
}

/** Atomic conditions paired with brute-force oracles that only use the parsed model / raw tags. */
function atoms(doc: DxfDocument): { cond: FilterCond; oracle: (e: Entity) => boolean }[] {
  return [
    { cond: { kind: 'cond', prop: 'type', op: 'eq', value: 'circle' }, oracle: (e) => e.type === 'CIRCLE' },
    { cond: { kind: 'cond', prop: 'type', op: 'in', value: 'LINE, ARC' }, oracle: (e) => e.type === 'LINE' || e.type === 'ARC' },
    { cond: { kind: 'cond', prop: 'layer', op: 'eq', value: 'WALL' }, oracle: (e) => e.layer.toUpperCase() === 'WALL' },
    { cond: { kind: 'cond', prop: 'layer', op: 'startsWith', value: 'D' }, oracle: (e) => e.layer.toUpperCase().startsWith('D') },
    {
      cond: { kind: 'cond', prop: 'radius', op: 'between', value: '1', value2: '6' },
      oracle: (e) => typeof e.radius === 'number' && (e.radius as number) >= 1 && (e.radius as number) <= 6,
    },
    { cond: { kind: 'cond', prop: 'radius', op: 'gt', value: '5' }, oracle: (e) => typeof e.radius === 'number' && (e.radius as number) > 5 },
    { cond: { kind: 'cond', prop: 'gc[8]', op: 'regex', value: '^w' }, oracle: (e) => rawCodes(doc, e, 8).some((v) => /^w/i.test(v)) },
    { cond: { kind: 'cond', prop: 'gc[62]', op: 'exists' }, oracle: (e) => rawCodes(doc, e, 62).length > 0 },
    { cond: { kind: 'cond', prop: 'gc[62]', op: 'notExists' }, oracle: (e) => rawCodes(doc, e, 62).length === 0 },
    { cond: { kind: 'cond', prop: 'hasXdata', op: 'eq', value: 'true' }, oracle: (e) => !!e.xdataApps?.length },
    { cond: { kind: 'cond', prop: 'handle', op: 'ne', value: '94' }, oracle: (e) => e.handle.toUpperCase() !== '94' },
    {
      cond: { kind: 'cond', prop: 'attr.TAG', op: 'eq', value: 'D-01' },
      oracle: (e) => e.type === 'INSERT' && (e as InsertEntity).attribs.some((a) => (a as TextEntity).tag === 'TAG' && (a as TextEntity).text === 'D-01'),
    },
  ];
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('filter evaluation', () => {
  const doc = load('basic_entities.dxf');
  const items = doc.modelSpace;
  const list = atoms(doc);

  it('each atomic condition matches a brute-force oracle', () => {
    const eng = engineFor(doc);
    for (const { cond, oracle } of list) {
      const got = [...eng.match(eng.compile(spec([cond])), 'Model', items)].sort((a, b) => a - b);
      const want = items.filter((id) => oracle(doc.entities[id]));
      expect(got, JSON.stringify(cond)).toEqual(want);
    }
  });

  it('random AND/OR/NOT trees match the brute-force evaluation', () => {
    const rand = rng(42);
    const eng = engineFor(doc);
    type Node = { group: FilterGroup; oracle: (e: Entity) => boolean };
    const build = (depth: number): Node => {
      const n = 1 + Math.floor(rand() * 3);
      const logic = rand() < 0.5 ? 'and' : 'or';
      const not = rand() < 0.3;
      const kids: { item: FilterCond | FilterGroup; oracle: (e: Entity) => boolean }[] = [];
      for (let i = 0; i < n; i++) {
        if (depth < 3 && rand() < 0.35) {
          const sub = build(depth + 1);
          kids.push({ item: sub.group, oracle: sub.oracle });
        } else {
          const a = list[Math.floor(rand() * list.length)];
          kids.push({ item: a.cond, oracle: a.oracle });
        }
      }
      const oracle = (e: Entity) => {
        const r = logic === 'and' ? kids.every((k) => k.oracle(e)) : kids.some((k) => k.oracle(e));
        return not ? !r : r;
      };
      return { group: { kind: 'group', logic, not, items: kids.map((k) => k.item) }, oracle };
    };
    for (let i = 0; i < 200; i++) {
      const node = build(0);
      const s: FilterSpec = { ...emptyFilter(), where: node.group };
      const got = [...eng.match(eng.compile(s), 'Model', items)].sort((a, b) => a - b);
      const want = items.filter((id) => node.oracle(doc.entities[id]));
      expect(got, JSON.stringify(node.group)).toEqual(want);
    }
  });

  it('facets combine with AND across keys and OR within a key', () => {
    const eng = engineFor(doc);
    const s = { ...emptyFilter(), facets: { type: ['LINE', 'CIRCLE'], layer: ['WALL', '0'] } };
    const got = [...eng.match(eng.compile(s), 'Model', items)].sort((a, b) => a - b);
    const want = items.filter((id) => {
      const e = doc.entities[id];
      return (e.type === 'LINE' || e.type === 'CIRCLE') && (e.layer === 'WALL' || e.layer === '0');
    });
    expect(got).toEqual(want);
  });

  it('leaf level finds entities inside blocks and reports the containing reference', () => {
    const eng = engineFor(doc);
    const f = eng.compile(spec([{ kind: 'cond', prop: 'type', op: 'eq', value: 'ARC' }], { level: 'leaf' }));
    const got = eng.match(f, 'Model', items);
    const inserts = items.filter((id) => {
      const e = doc.entities[id];
      return e.type === 'INSERT' && ['DOOR', 'ROOM'].includes(String(e.name));
    });
    for (const id of inserts) expect(got.has(id)).toBe(true);
    expect(f.leafCount).toBeGreaterThan(inserts.length);
    // block facet at leaf level = containing blocks
    const g = eng.compile({ ...emptyFilter(), level: 'leaf', facets: { block: ['DOOR'] } });
    const m = eng.match(g, 'Model', items);
    for (const id of inserts) expect(m.has(id)).toBe(true);
    for (const id of m) expect(doc.entities[id].type === 'INSERT').toBe(true);
  });

  it('does not evaluate risky regular expressions', () => {
    const eng = engineFor(doc);
    const s = spec([{ kind: 'cond', prop: 'text', op: 'regex', value: '(a+)+$' }]);
    expect(regexIssues(s)).toEqual([{ pattern: '(a+)+$', reason: 'risky' }]);
    expect(eng.match(eng.compile(s), 'Model', items).size).toBe(0);
    expect(riskyPattern('^W.*$')).toBe(false);
  });

  it('searches texts, handles, layers and block names', () => {
    const eng = engineFor(doc);
    const idx = new TextIndex(doc);
    const r = eng.search(items, idx, { query: 'door', regex: false, caseSensitive: false, limit: 100 });
    expect(r.hits.some((h) => h.field === 'block')).toBe(true);
    const h = eng.search(items, idx, { query: '94', regex: false, caseSensitive: false, limit: 100 });
    expect(h.hits.some((x) => x.field === 'handle' && x.handle === '94')).toBe(true);
    expect(eng.search(items, idx, { query: '(x+)+', regex: true, caseSensitive: false, limit: 10 }).error).toBeTruthy();
  });
});

describe('shared filter links', () => {
  it('round-trips through the URL encoding (incl. non-ASCII)', () => {
    const s = spec([{ kind: 'cond', prop: 'layer', op: 'eq', value: '壁' }], { facets: { type: ['TEXT'] }, mode: 'highlight', level: 'leaf' });
    expect(decodeFilter(encodeFilter(s))).toEqual({ ...s, spatial: undefined, where: { ...s.where, not: undefined } });
  });

  it('rejects malformed or hostile input and strips unknown fields', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeFilter('!!!')).toBeNull();
    expect(decodeFilter(b64({ version: 2 }))).toBeNull();
    expect(decodeFilter(b64({ version: 1, where: { kind: 'group', logic: 'xor', items: [] } }))).toBeNull();
    expect(decodeFilter(b64({ version: 1, where: { kind: 'group', logic: 'and', items: [{ kind: 'cond', prop: 'x', op: 'eval' }] } }))).toBeNull();
    let deep: unknown = { kind: 'group', logic: 'and', items: [] };
    for (let i = 0; i < 20; i++) deep = { kind: 'group', logic: 'and', items: [deep] };
    expect(decodeFilter(b64({ version: 1, where: deep }))).toBeNull();
    const ok = decodeFilter(
      b64({
        version: 1,
        __proto__x: 1,
        facets: { layer: ['A', 3], bogus: ['x'] },
        where: { kind: 'group', logic: 'and', items: [{ kind: 'cond', prop: 'type', op: 'eq', value: 'LINE', onerror: 'x' }] },
        spatial: { minX: 0, minY: 0, maxX: 'a', maxY: 1 },
        mode: 'run',
      }),
    )!;
    expect(ok.facets).toEqual({ layer: ['A'] });
    expect(ok.where.items[0]).toEqual({ kind: 'cond', prop: 'type', op: 'eq', value: 'LINE' });
    expect(ok.spatial).toBeUndefined();
    expect(ok.mode).toBe('show');
  });
});

describe('spatial conditions', () => {
  const pairs: [number, string | number][] = [];
  const line = (h: string, x0: number, y0: number, x1: number, y1: number) =>
    pairs.push([0, 'LINE'], [5, h], [8, '0'], [10, x0], [20, y0], [30, 0], [11, x1], [21, y1], [31, 0]);
  line('A', 1, 1, 2, 2); // inside both regions
  line('B', 1, 1, 20, 1); // crosses the right edge
  line('C', 30, 30, 40, 40); // outside
  line('D', -5, 5, 15, 5); // passes through without a vertex inside
  line('E', 6, 6, 9, 9); // inside the box, but in the notch of the L-shaped polygon
  pairs.push([0, 'CIRCLE'], [5, 'F'], [8, '0'], [10, 5], [20, 5], [30, 0], [40, 100]); // encloses the region (not filled)
  pairs.push([0, 'XLINE'], [5, 'G'], [8, '0'], [10, 0], [20, -50], [30, 0], [11, 0], [21, 1], [31, 0]); // vertical through x=0
  const doc = parseDxf(enc(dxf(entitiesDoc(pairs))), { name: 'spatial.dxf' });
  const items = doc.modelSpace;
  const eng = engineFor(doc);
  const run = (spatial: FilterSpec['spatial']) =>
    [...eng.match(eng.compile({ ...emptyFilter(), spatial }), 'Model', items)].map((id) => doc.entities[id].handle).sort();

  it('rectangle: window vs crossing', () => {
    expect(run({ kind: 'rect', minX: 0, minY: 0, maxX: 10, maxY: 10, mode: 'inside' })).toEqual(['A', 'E']);
    expect(run({ kind: 'rect', minX: 0, minY: 0, maxX: 10, maxY: 10, mode: 'crossing' })).toEqual(['A', 'B', 'D', 'E', 'G']);
  });

  it('concave polygon (L-shape)', () => {
    // L: (0,0)-(10,0)-(10,5)-(5,5)-(5,10)-(0,10); the square (5..10, 5..10) is outside
    const points = [0, 0, 10, 0, 10, 5, 5, 5, 5, 10, 0, 10];
    expect(run({ kind: 'polygon', points, mode: 'inside' })).toEqual(['A']);
    expect(run({ kind: 'polygon', points, mode: 'crossing' })).toEqual(['A', 'B', 'D', 'G']);
  });
});
