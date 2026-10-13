import { describeCode, HEADER_DESCRIPTIONS } from '../dxf/codes';
import type { DxfDocument } from '../dxf/model';
import { dictEntries, objectByHandle } from '../dxf/objects';
import { decodeEscapes } from '../dxf/text/escapes';
import type { GeneratorGuess, HeaderVarRow, InspectedRecord, ObjectNode, RawRow, TableGroup } from '../shared/docApi';

/** Header variables with descriptions. */
export function headerVars(doc: DxfDocument): HeaderVarRow[] {
  const rows: HeaderVarRow[] = [];
  for (const [name, v] of doc.header) {
    const value = v.values.map((x) => (typeof x === 'number' ? String(Number(x.toPrecision(15))) : decodeEscapes(String(x)).trim())).join(v.values.length > 1 ? ', ' : '');
    rows.push({ name, value, codes: v.codes.join(','), description: HEADER_DESCRIPTIONS[name] ?? '', line: doc.tags.line(v.tag) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Symbol table records grouped by table. */
export function tableGroups(doc: DxfDocument): TableGroup[] {
  const groups = new Map<string, TableGroup>();
  const add = (table: string, name: string, handle: string | undefined, line: number) => {
    if (!groups.has(table)) groups.set(table, { table, records: [] });
    groups.get(table)!.records.push({ name, handle: handle ?? '', line });
  };
  for (const l of doc.layers.values()) if (l.tag >= 0) add('LAYER', l.name, l.handle, doc.tags.line(l.tag));
  for (const l of doc.linetypes.values()) add('LTYPE', l.name, l.handle, doc.tags.line(l.tag));
  for (const s of doc.styles.values()) add('STYLE', s.name, s.handle, doc.tags.line(s.tag));
  for (const r of doc.tableRecords) if (!r.table.endsWith(':TABLE')) add(r.table, r.name, r.handle, doc.tags.line(r.tag));
  const order = ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD'];
  return [...groups.values()].sort((a, b) => (order.indexOf(a.table) + 99) % 99 - ((order.indexOf(b.table) + 99) % 99) || a.table.localeCompare(b.table));
}

/** Children of an OBJECTS dictionary ('' = the root dictionary). */
export function objectChildren(doc: DxfDocument, handle: string): ObjectNode[] {
  const nodes: ObjectNode[] = [];
  if (!handle) {
    const root = doc.objects.find((o) => o.type === 'DICTIONARY');
    if (!root) return [];
    handle = root.handle;
  }
  const dict = objectByHandle(doc, handle);
  for (const [key, h] of dictEntries(dict)) {
    const o = objectByHandle(doc, h);
    nodes.push({ key, handle: h, type: o?.type ?? '?', hasChildren: !!o && (o.type === 'DICTIONARY' || o.type === 'ACDBDICTIONARYWDFLT') && dictEntries(o).length > 0 });
  }
  return nodes;
}

/** Any record (entity, object, table record, block) by handle with its raw tags. */
export function inspectHandle(doc: DxfDocument, handle: string, limit = 2000): InspectedRecord | null {
  const ref = doc.handles.get(handle.trim().toUpperCase());
  if (!ref) return null;
  let start: number;
  let end: number;
  let type: string;
  let name: string | undefined;
  let entityId: number | undefined;
  if (ref.kind === 'entity') {
    const e = doc.entities[ref.index];
    start = e.tagStart;
    end = e.tagEnd;
    type = e.type;
    entityId = e.id;
  } else if (ref.kind === 'object') {
    const o = doc.objects[ref.index];
    start = o.tagStart;
    end = o.tagEnd;
    type = o.type;
    name = typeof o.name === 'string' ? o.name : undefined;
  } else if (ref.kind === 'table') {
    const r = doc.tableRecords[ref.index];
    start = r.tag;
    end = r.tagEnd;
    type = r.table;
    name = r.name;
  } else if (ref.kind === 'block') {
    const b = [...doc.blocks.values()][ref.index];
    if (!b) return null;
    start = b.tag;
    end = b.tagEnd;
    type = 'BLOCK';
    name = b.name;
  } else {
    const rec = ref.kind === 'layer' ? [...doc.layers.values()][ref.index] : ref.kind === 'ltype' ? [...doc.linetypes.values()][ref.index] : [...doc.styles.values()][ref.index];
    if (!rec || rec.tag < 0) return null;
    start = rec.tag;
    end = start + 1;
    while (end < doc.tags.count && doc.tags.code(end) !== 0) end++;
    type = ref.kind === 'layer' ? 'LAYER' : ref.kind === 'ltype' ? 'LTYPE' : 'STYLE';
    name = rec.name;
  }
  const tags: RawRow[] = [];
  let owner: string | undefined;
  for (let i = start; i < end && tags.length < limit; i++) {
    const code = doc.tags.code(i);
    const value = doc.tags.str(i);
    if (code === 330 && owner === undefined) owner = value.trim();
    tags.push({ index: i, line: doc.tags.line(i), code, value, desc: describeCode(type, code) });
  }
  return { handle: handle.toUpperCase(), kind: ref.kind, type, name, owner, entityId, total: end - start, tags };
}

/** Raw tag rows of the whole file. */
export function rawRows(doc: DxfDocument, offset: number, limit: number): RawRow[] {
  const rows: RawRow[] = [];
  const end = Math.min(doc.tags.count, offset + limit);
  for (let i = Math.max(0, offset); i < end; i++) rows.push({ index: i, line: doc.tags.line(i), code: doc.tags.code(i), value: doc.tags.str(i) });
  return rows;
}

/** Next tag index (from `from`, in direction `dir`) whose value (or code) matches. */
export function rawSearch(doc: DxfDocument, q: { query: string; regex: boolean; caseSensitive: boolean; code?: number; from: number; dir: 1 | -1 }): { index: number } | { error: string } | null {
  let test: (s: string) => boolean;
  if (q.regex) {
    try {
      const re = new RegExp(q.query, q.caseSensitive ? 'u' : 'iu');
      test = (s) => re.test(s);
    } catch (e) {
      return { error: (e as Error).message };
    }
  } else {
    const needle = q.caseSensitive ? q.query : q.query.toLowerCase();
    test = (s) => (q.caseSensitive ? s : s.toLowerCase()).includes(needle);
  }
  const n = doc.tags.count;
  for (let k = 1; k <= n; k++) {
    const i = (((q.from + k * q.dir) % n) + n) % n;
    if (q.code !== undefined && doc.tags.code(i) !== q.code) continue;
    if (!q.query || test(doc.tags.str(i))) return { index: i };
  }
  return null;
}

/** Tag index of the first tag at or after a 1-based line number. */
export function tagAtLine(doc: DxfDocument, line: number): number {
  let lo = 0;
  let hi = doc.tags.count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (doc.tags.line(mid) < line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The record containing a tag: entity id and/or handle. */
export function tagOwner(doc: DxfDocument, index: number): { entityId?: number; handle?: string; type: string } | null {
  // entities are stored in file order with tag ranges; binary search over them
  const ents = doc.entities;
  let lo = 0;
  let hi = ents.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = ents[mid];
    if (index < e.tagStart) hi = mid - 1;
    else if (index >= e.tagEnd) lo = mid + 1;
    else return { entityId: e.id, handle: e.handle, type: e.type };
  }
  // fall back to a linear scan (sub-entities are not always in order)
  for (const e of ents) if (index >= e.tagStart && index < e.tagEnd) return { entityId: e.id, handle: e.handle, type: e.type };
  for (const o of doc.objects) if (index >= o.tagStart && index < o.tagEnd) return { handle: o.handle, type: o.type };
  for (const r of doc.tableRecords) if (index >= r.tag && index < r.tagEnd) return { handle: r.handle, type: r.table };
  return null;
}

/** Entity counts by type for model space, paper space and block definitions. */
export function typeStats(doc: DxfDocument): { type: string; model: number; paper: number; blocks: number }[] {
  const m = new Map<string, { type: string; model: number; paper: number; blocks: number }>();
  const get = (t: string) => {
    if (!m.has(t)) m.set(t, { type: t, model: 0, paper: 0, blocks: 0 });
    return m.get(t)!;
  };
  for (const id of doc.modelSpace) get(doc.entities[id].type).model++;
  for (const id of doc.paperSpace) get(doc.entities[id].type).paper++;
  for (const b of doc.blocks.values()) {
    if (/^\*(model|paper)_space/i.test(b.name)) {
      if (/^\*paper_space/i.test(b.name)) for (const id of b.entities) get(doc.entities[id].type).paper++;
      continue;
    }
    for (const id of b.entities) get(doc.entities[id].type).blocks++;
  }
  return [...m.values()].sort((a, b) => b.model + b.paper + b.blocks - (a.model + a.paper + a.blocks));
}

/**
 * Best-effort guess of the producing application with the evidence used.
 * Only lists what the file actually says; the guess is labelled as such.
 */
export function guessGenerator(doc: DxfDocument): GeneratorGuess {
  const evidence: string[] = [];
  const comments: string[] = [];
  const t = doc.tags;
  for (let i = 0; i < t.count && comments.length < 20; i++) if (t.code(i) === 999) comments.push(t.str(i).trim());
  // a converted DWG: the converter's comment says nothing about the application that wrote the DWG
  const dwg = doc.source.dwg;
  if (dwg) {
    const own = comments.findIndex((c) => c.startsWith('LibreDWG'));
    if (own >= 0) comments.splice(own, 1);
    evidence.push(`DWG ${dwg.version}, converted to DXF with ${dwg.converter}`);
  }
  for (const c of comments) evidence.push(`comment: ${c}`);
  const appids = doc.tableRecords.filter((r) => r.table === 'APPID').map((r) => r.name);
  if (appids.length) evidence.push(`APPID: ${appids.slice(0, 30).join(', ')}${appids.length > 30 ? ', …' : ''}`);
  const classApps = [...new Set(doc.classes.map((c) => c.app))].filter(Boolean);
  if (classApps.length) evidence.push(`CLASSES applications: ${classApps.slice(0, 12).join(', ')}`);
  const ver = doc.source.version;
  const maint = doc.header.get('$ACADMAINTVER')?.values[0];
  if (ver) evidence.push(`$ACADVER ${ver}${maint !== undefined ? ` / $ACADMAINTVER ${maint}` : ''}`);
  const cp = doc.header.get('$DWGCODEPAGE')?.values[0];
  if (cp !== undefined) evidence.push(`$DWGCODEPAGE ${cp}`);
  const hasHandles = doc.entities.some((e) => !!e.handle && !e.handle.startsWith('~'));
  if (!hasHandles) evidence.push('entities have no handles');
  const dicts = new Set<string>();
  for (const o of doc.objects) if (o.type === 'DICTIONARY') for (const [k] of dictEntries(o)) dicts.add(k.toUpperCase());
  const layerNames = [...doc.layers.values()].map((l) => l.name);
  const styles = [...doc.styles.values()];
  const all = [...comments, ...appids, ...classApps, ...dicts].join('\n').toUpperCase();
  const ltNames = new Set([...doc.linetypes.values()].map((l) => l.name.toUpperCase()));
  const jwLinetypes = ['RAND1', 'RAND5', 'LONG1', 'DUMMY'].every((n) => ltNames.has(n));
  const jwVertical = styles.some((s) => s.name.toUpperCase() === 'TATEGAKI' && /bigfont/i.test(s.bigFont));

  const classNames = doc.classes.map((c) => `${c.name} ${c.cppName}`).join(' ');
  // object enablers name their product in the CLASSES application field
  const products = [...new Set(classApps.map((a) => /Product Desc:\s*([^|]+)/i.exec(a)?.[1].trim()).filter((x): x is string => !!x))];
  const vertical = products.length
    ? { name: products.join(' / '), reason: 'product named by CLASSES application entries (object enablers)' }
    : /\bAecc/.test(classNames)
      ? { name: 'AutoCAD Civil 3D', reason: 'Aecc* classes' }
      : /\bAecb?Db/.test(classNames)
        ? { name: 'AutoCAD Architecture / MEP', reason: 'AecDb* classes' }
        : /\bAcMap/.test(classNames)
          ? { name: 'AutoCAD Map 3D', reason: 'AcMap* classes' }
          : null;
  const rules: [string, boolean, string][] = [
    [vertical?.name ?? '', !!vertical, vertical?.reason ?? ''],
    ['ezdxf (Python)', dicts.has('EZDXF_META') || /EZDXF/.test(all), 'EZDXF_META dictionary / EZDXF marker'],
    ['LibreCAD (libdxfrw)', /DXFRW|LIBRECAD/.test(all), 'dxfrw / LibreCAD comment'],
    ['QCAD (dxflib)', /DXFLIB|QCAD/.test(all), 'dxflib / QCAD comment'],
    ['Autodesk Revit', /REVIT/.test(all), 'Revit marker'],
    ['Graphisoft Archicad', /ARCHICAD|GRAPHISOFT/.test(all), 'Archicad / Graphisoft marker'],
    ['BricsCAD', /BRICSCAD|BRICSYS/.test(all), 'Bricsys marker'],
    ['DraftSight', /DRAFTSIGHT/.test(all), 'DraftSight marker'],
    ['FreeCAD', /FREECAD/.test(all), 'FreeCAD marker'],
    ['Adobe Illustrator', /ILLUSTRATOR|ADOBE/.test(all), 'Adobe marker'],
    ['Rebro', /REBRO|NYK/.test(all), 'Rebro marker'],
    ['TFAS', /TFAS|TFASW/.test(all), 'TFAS marker'],
    [
      'Jw_cad',
      /JW_?CAD|JWW/.test(all) ||
        jwLinetypes ||
        jwVertical ||
        (ver === 'AC1009' && layerNames.some((n) => /^_?[0-9A-F]-[0-9A-F](_[0-9A-F])?$/i.test(n))),
      jwLinetypes ? 'Jw_cad linetype set (RAND1…RAND5, LONG1…, DUMMY)' : jwVertical ? 'TATEGAKI (vertical) text style with bigfont.shx' : 'R12 with Jw_cad "group-layer" names such as _0-1_0 / 0-1',
    ],
  ];
  const hits = rules.filter((r) => r[1]);
  if (!hits.length && styles.some((s) => /ＭＳ|MS (ゴシック|明朝)|msgothic|msmincho/i.test(`${s.font} ${s.family ?? ''} ${s.name}`)) && cp === 'ANSI_932')
    hits.push(['Japanese Windows application', true, 'ANSI_932 with MS Gothic / Mincho text styles (TFAS, Rebro and others write such files)']);
  if (!hits.length && classApps.some((a) => /ObjectDBX/i.test(a)))
    hits.push(['AutoCAD or an ODA-based CAD', true, 'ObjectDBX classes (written by AutoCAD and ODA/Teigha-based applications)']);
  return {
    guess: hits.map((h) => h[0]),
    reasons: hits.map((h) => h[2]),
    evidence,
  };
}
