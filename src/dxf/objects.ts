import { decodeEscapes } from './text/escapes';
import { nameKey, type DxfDocument, type DxfObject, type Entity, type TableRecord } from './model';

/** Look up any record (entity/object/table record) by handle. */
export function byHandle(doc: DxfDocument, handle: string | undefined): { kind: string; index: number } | undefined {
  if (!handle) return undefined;
  return doc.handles.get(handle.trim().toUpperCase());
}

export function objectByHandle(doc: DxfDocument, handle: string | undefined): DxfObject | undefined {
  const r = byHandle(doc, handle);
  return r?.kind === 'object' ? doc.objects[r.index] : undefined;
}

export function tableRecordByHandle(doc: DxfDocument, handle: string | undefined): TableRecord | undefined {
  const r = byHandle(doc, handle);
  return r?.kind === 'table' ? doc.tableRecords[r.index] : undefined;
}

/** Block name for a BLOCK_RECORD handle. */
export function blockNameByRecord(doc: DxfDocument, handle: string | undefined): string | undefined {
  const tr = tableRecordByHandle(doc, handle);
  return tr && tr.table === 'BLOCK_RECORD' ? tr.name : undefined;
}

/** Text style name for a STYLE record handle. */
export function styleNameByHandle(doc: DxfDocument, handle: string | undefined): string | undefined {
  if (!handle) return undefined;
  const h = handle.trim().toUpperCase();
  for (const st of doc.styles.values()) if (st.handle?.toUpperCase() === h) return st.name;
  return undefined;
}

/** Iterate the tags of a record as [code, index] (excluding XDATA). */
export function* recordTags(doc: DxfDocument, start: number, end: number): Generator<[number, number]> {
  for (let i = start + 1; i < end; i++) {
    const c = doc.tags.code(i);
    if (c >= 1000) return;
    yield [c, i];
  }
}

/** Dictionary entries of a DICTIONARY object. */
export function dictEntries(obj: DxfObject | undefined): [string, string][] {
  return (obj?.entries as [string, string][] | undefined) ?? [];
}

export function dictLookup(doc: DxfDocument, dictHandle: string | undefined, key: string): DxfObject | undefined {
  const d = objectByHandle(doc, dictHandle);
  const hit = dictEntries(d).find(([k]) => k.toUpperCase() === key.toUpperCase());
  return hit ? objectByHandle(doc, hit[1]) : undefined;
}

export interface MlineStyle {
  name: string;
  flags: number;
  fillColor: number;
  startAngle: number;
  endAngle: number;
  elements: { offset: number; color: number; linetype: string }[];
}

export function mlineStyle(doc: DxfDocument, handle: string | undefined, name: string): MlineStyle | undefined {
  let obj = objectByHandle(doc, handle);
  if (!obj || obj.type !== 'MLINESTYLE') {
    obj = doc.objects.find((o) => o.type === 'MLINESTYLE' && nameKey(String(readName(doc, o) ?? '')) === nameKey(name));
  }
  if (!obj) return undefined;
  const st: MlineStyle = { name: readName(doc, obj) ?? name, flags: 0, fillColor: 256, startAngle: 90, endAngle: 90, elements: [] };
  let inElements = false;
  for (const [c, i] of recordTags(doc, obj.tagStart, obj.tagEnd)) {
    const t = doc.tags;
    if (c === 71) inElements = true;
    if (!inElements) {
      if (c === 70) st.flags = t.num(i);
      else if (c === 62) st.fillColor = t.num(i);
      else if (c === 51) st.startAngle = t.num(i);
      else if (c === 52) st.endAngle = t.num(i);
    } else {
      if (c === 49) st.elements.push({ offset: t.num(i), color: 256, linetype: 'BYLAYER' });
      else if (c === 62 && st.elements.length) st.elements[st.elements.length - 1].color = t.num(i);
      else if (c === 6 && st.elements.length) st.elements[st.elements.length - 1].linetype = decodeEscapes(t.str(i)).trim();
    }
  }
  return st;
}

function readName(doc: DxfDocument, obj: DxfObject): string | undefined {
  for (const [c, i] of recordTags(doc, obj.tagStart, obj.tagEnd)) if (c === 2) return decodeEscapes(doc.tags.str(i)).trim();
  return undefined;
}

export interface ImageDef {
  fileName: string;
  width: number;
  height: number;
}

export function imageDef(doc: DxfDocument, handle: string | undefined): ImageDef | undefined {
  const obj = objectByHandle(doc, handle);
  if (!obj) return undefined;
  const def: ImageDef = { fileName: '', width: 0, height: 0 };
  for (const [c, i] of recordTags(doc, obj.tagStart, obj.tagEnd)) {
    if (c === 1) def.fileName = decodeEscapes(doc.tags.str(i));
    else if (c === 10) def.width = doc.tags.num(i);
    else if (c === 20) def.height = doc.tags.num(i);
  }
  return def;
}

/** Underlay definition (PDFDEFINITION etc.): file and sheet name. */
export function underlayDef(doc: DxfDocument, handle: string | undefined): { fileName: string; name: string } | undefined {
  const obj = objectByHandle(doc, handle);
  if (!obj) return undefined;
  const out = { fileName: '', name: '' };
  for (const [c, i] of recordTags(doc, obj.tagStart, obj.tagEnd)) {
    if (c === 1) out.fileName = decodeEscapes(doc.tags.str(i));
    else if (c === 2) out.name = decodeEscapes(doc.tags.str(i));
  }
  return out;
}

export interface SpatialFilter {
  /** boundary in block coordinates */
  points: [number, number][];
  enabled: boolean;
}

/** XCLIP boundary of an INSERT (ACAD_FILTER/SPATIAL in its extension dictionary). */
export function spatialFilter(doc: DxfDocument, insert: Entity): SpatialFilter | undefined {
  if (!insert.xdict) return undefined;
  const filterDict = dictLookup(doc, insert.xdict, 'ACAD_FILTER');
  if (!filterDict) return undefined;
  const sf = dictLookup(doc, filterDict.handle, 'SPATIAL');
  if (!sf || sf.type !== 'SPATIAL_FILTER') return undefined;
  const raw: [number, number][] = [];
  const m: number[] = [];
  let enabled = true;
  const t = doc.tags;
  for (const [c, i] of recordTags(doc, sf.tagStart, sf.tagEnd)) {
    if (c === 10) raw.push([t.num(i), t.code(i + 1) === 20 ? t.num(i + 1) : 0]);
    else if (c === 71) enabled = t.num(i) !== 0;
    else if (c === 40) m.push(t.num(i));
  }
  if (!enabled || raw.length < 2) return undefined;
  // last 24 values: inverse insert matrix (12) + transform matrix (12), column-major 3x4
  let points = raw;
  if (m.length >= 24) {
    const v = m.slice(m.length - 24, m.length - 12);
    points = raw.map(([x, y]) => [v[0] * x + v[1] * y + v[3], v[4] * x + v[5] * y + v[7]]);
  }
  if (points.length === 2) {
    const [[x0, y0], [x1, y1]] = points;
    points = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  return { points, enabled };
}

/** SORTENTSTABLE of a block record: entity handle → sort handle. */
export function sortTable(doc: DxfDocument, blockRecordHandle: string | undefined): Map<string, string> | undefined {
  if (!blockRecordHandle) return undefined;
  const brIdx = byHandle(doc, blockRecordHandle);
  if (!brIdx || brIdx.kind !== 'table') return undefined;
  const br = doc.tableRecords[brIdx.index];
  // the block record's extension dictionary holds ACAD_SORTENTS
  let xdict: string | undefined;
  for (let i = br.tag + 1; i < br.tagEnd; i++) {
    if (doc.tags.code(i) === 360) {
      xdict = doc.tags.str(i).trim();
      break;
    }
  }
  const st = xdict ? dictLookup(doc, xdict, 'ACAD_SORTENTS') : doc.objects.find((o) => o.type === 'SORTENTSTABLE' && hasOwnerRecord(doc, o, blockRecordHandle));
  if (!st || st.type !== 'SORTENTSTABLE') return undefined;
  const map = new Map<string, string>();
  let ent: string | null = null;
  for (const [c, i] of recordTags(doc, st.tagStart, st.tagEnd)) {
    if (c === 331) ent = doc.tags.str(i).trim().toUpperCase();
    else if (c === 5 && ent) {
      map.set(ent, doc.tags.str(i).trim().toUpperCase());
      ent = null;
    }
  }
  return map.size ? map : undefined;
}

function hasOwnerRecord(doc: DxfDocument, o: DxfObject, recordHandle: string): boolean {
  for (const [c, i] of recordTags(doc, o.tagStart, o.tagEnd)) if (c === 330 && doc.tags.str(i).trim().toUpperCase() === recordHandle.toUpperCase()) return true;
  return false;
}
