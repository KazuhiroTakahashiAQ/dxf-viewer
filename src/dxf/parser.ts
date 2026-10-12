import type {
  BlockDef,
  Diagnostic,
  DxfDocument,
  DxfObject,
  EncodingInfo,
  Entity,
  HeaderValue,
  Layer,
  Layout,
  Linetype,
  TableRecord,
  TextStyle,
} from './model';
import { nameKey } from './model';
import { newEntityBase, parseEntityRecord } from './entities/common';
import { ENTITY_SPECS, VERTEX, vertexFrom } from './entities/specs';
import { countReplacements, decodeBytes, detectEncoding, RELEASES } from './reader/encoding';
import { buildAsciiTagStore, type TagStore } from './reader/tagStore';
import { isBinaryDxf, parseBinaryDxf } from './reader/binary';
import { decodeEscapes } from './text/escapes';

export interface ParseOptions {
  name: string;
  /** force a text encoding (manual override) */
  encoding?: string;
  onProgress?: (phase: string, fraction: number) => void;
}

interface RecordRange {
  start: number;
  end: number;
  type: string;
}

function splitRecords(tags: TagStore, start: number, end: number): RecordRange[] {
  const out: RecordRange[] = [];
  let cur = -1;
  for (let i = start; i < end; i++) {
    if (tags.code(i) === 0) {
      if (cur >= 0) out.push({ start: cur, end: i, type: tags.str(cur).trim().toUpperCase() });
      cur = i;
    }
  }
  if (cur >= 0) out.push({ start: cur, end, type: tags.str(cur).trim().toUpperCase() });
  return out;
}

interface SectionRange {
  name: string;
  start: number; // first tag after "2 NAME"
  end: number; // index of "0 ENDSEC" (exclusive)
}

function findSections(tags: TagStore, diagnostics: Diagnostic[]): SectionRange[] {
  const out: SectionRange[] = [];
  const n = tags.count;
  let i = 0;
  while (i < n) {
    if (tags.code(i) === 0) {
      const v = tags.str(i).trim().toUpperCase();
      if (v === 'EOF') break;
      if (v === 'SECTION') {
        let name = '';
        let s = i + 1;
        if (s < n && tags.code(s) === 2) {
          name = tags.str(s).trim().toUpperCase();
          s++;
        }
        let j = s;
        while (j < n && !(tags.code(j) === 0 && /^(ENDSEC|EOF)$/i.test(tags.str(j).trim()))) {
          // a nested SECTION means ENDSEC is missing
          if (tags.code(j) === 0 && tags.str(j).trim().toUpperCase() === 'SECTION') break;
          j++;
        }
        if (j >= n || tags.str(j).trim().toUpperCase() !== 'ENDSEC') {
          diagnostics.push({ level: 'warning', code: 'missing-endsec', message: `Section ${name} has no ENDSEC`, line: tags.line(i) });
        }
        out.push({ name, start: s, end: j });
        i = j + 1;
        continue;
      }
      diagnostics.push({ level: 'warning', code: 'outside-section', message: `Record "${v}" outside of any section`, line: tags.line(i) });
    }
    i++;
  }
  return out;
}

function parseHeader(tags: TagStore, s: SectionRange): Map<string, HeaderValue> {
  const header = new Map<string, HeaderValue>();
  let cur: HeaderValue | null = null;
  for (let i = s.start; i < s.end; i++) {
    const code = tags.code(i);
    if (code === 9) {
      cur = { codes: [], values: [], tag: i };
      header.set(tags.str(i).trim().toUpperCase(), cur);
      continue;
    }
    if (!cur) continue;
    cur.codes.push(code);
    const isNum = (code >= 10 && code <= 59) || (code >= 60 && code <= 99) || (code >= 140 && code <= 147) || (code >= 160 && code <= 179) || (code >= 270 && code <= 289) || (code >= 370 && code <= 389);
    cur.values.push(isNum ? tags.num(i) : tags.str(i));
  }
  return header;
}

export function headerNumber(doc: Pick<DxfDocument, 'header'>, name: string, fallback: number): number {
  const v = doc.header.get(name)?.values[0];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function headerString(doc: Pick<DxfDocument, 'header'>, name: string): string | undefined {
  const v = doc.header.get(name)?.values[0];
  return v === undefined ? undefined : String(v).trim();
}

export function headerPoint(doc: Pick<DxfDocument, 'header'>, name: string): [number, number, number] | undefined {
  const h = doc.header.get(name);
  if (!h) return undefined;
  const get = (c: number) => {
    const k = h.codes.indexOf(c);
    return k >= 0 ? Number(h.values[k]) : 0;
  };
  const x = h.codes.find((c) => c >= 10 && c <= 18);
  if (x === undefined) return undefined;
  return [get(x), get(x + 10), get(x + 20)];
}

/** Read the first occurrence of each code inside [start, end) excluding XDATA. */
function firstValues(tags: TagStore, start: number, end: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = start + 1; i < end; i++) {
    const c = tags.code(i);
    if (c >= 1000) break;
    if (!m.has(c)) m.set(c, i);
  }
  return m;
}

function xdataFirst(tags: TagStore, start: number, end: number, app: string): { code: number; i: number }[] {
  const out: { code: number; i: number }[] = [];
  let inApp = false;
  for (let i = start; i < end; i++) {
    const c = tags.code(i);
    if (c === 1001) {
      inApp = tags.str(i).trim().toUpperCase() === app;
      continue;
    }
    if (inApp && c >= 1000) out.push({ code: c, i });
  }
  return out;
}

function parseTables(doc: DxfDocument, tags: TagStore, s: SectionRange): void {
  const records = splitRecords(tags, s.start, s.end);
  let table = '';
  for (const rec of records) {
    if (rec.type === 'TABLE') {
      const f = firstValues(tags, rec.start, rec.end);
      table = f.has(2) ? tags.str(f.get(2)!).trim().toUpperCase() : '';
      // table-level extension dictionary (layer states hang off the LAYER table)
      for (let i = rec.start; i < rec.end; i++) {
        if (tags.code(i) === 360) {
          doc.tableRecords.push({ table: `${table}:TABLE`, name: table, tag: rec.start, tagEnd: rec.end, xdict: tags.str(i).trim() });
          break;
        }
      }
      continue;
    }
    if (rec.type === 'ENDTAB') continue;
    const f = firstValues(tags, rec.start, rec.end);
    const str = (c: number) => (f.has(c) ? decodeEscapes(tags.str(f.get(c)!)) : undefined);
    const num = (c: number, d: number) => (f.has(c) ? tags.num(f.get(c)!) : d);
    const handle = (str(5) ?? str(105))?.trim();
    const name = (str(2) ?? '').trim();
    switch (rec.type) {
      case 'LAYER': {
        const layer: Layer = {
          name,
          handle,
          flags: num(70, 0),
          color: num(62, 7),
          linetype: (str(6) ?? 'CONTINUOUS').trim(),
          lineweight: num(370, -3),
          plot: num(290, 1) !== 0,
          tag: rec.start,
        };
        if (f.has(420)) layer.trueColor = num(420, 0) & 0xffffff;
        for (const x of xdataFirst(tags, rec.start, rec.end, 'ACCMTRANSPARENCY')) {
          if (x.code === 1071) layer.transparency = tags.num(x.i);
        }
        doc.layers.set(nameKey(name), layer);
        break;
      }
      case 'LTYPE': {
        const pattern: number[] = [];
        let complex = false;
        for (let i = rec.start + 1; i < rec.end; i++) {
          const c = tags.code(i);
          if (c >= 1000) break;
          if (c === 49) pattern.push(tags.num(i));
          if (c === 74 && tags.num(i) !== 0) complex = true;
        }
        const lt: Linetype = {
          name,
          handle,
          description: str(3) ?? '',
          totalLength: num(40, 0),
          pattern,
          complex,
          tag: rec.start,
        };
        doc.linetypes.set(nameKey(name), lt);
        break;
      }
      case 'STYLE': {
        const st: TextStyle = {
          name,
          handle,
          flags: num(70, 0),
          height: num(40, 0),
          widthFactor: num(41, 1) || 1,
          oblique: num(50, 0),
          generation: num(71, 0),
          font: (str(3) ?? '').trim(),
          bigFont: (str(4) ?? '').trim(),
          tag: rec.start,
        };
        for (const x of xdataFirst(tags, rec.start, rec.end, 'ACAD')) {
          if (x.code === 1000 && st.family === undefined) st.family = decodeEscapes(tags.str(x.i)).trim();
          if (x.code === 1071) st.ttfFlags = tags.num(x.i);
        }
        // Shape files (flag 1) share the table but are not text styles
        if (name || !(st.flags & 1)) doc.styles.set(nameKey(name), st);
        else doc.tableRecords.push({ table: 'STYLE', name: st.font, handle, tag: rec.start, tagEnd: rec.end, shapeFile: true });
        break;
      }
      default: {
        const tr: TableRecord = { table: rec.type, name, handle, tag: rec.start, tagEnd: rec.end };
        tr.flags = num(70, 0);
        if (rec.type === 'VPORT' || rec.type === 'VIEW') {
          const p = (c: number): [number, number, number] => [num(c, 0), num(c + 10, 0), num(c + 20, 0)];
          if (rec.type === 'VPORT') {
            tr.center = p(12);
            tr.height = num(40, 0);
            tr.aspect = num(41, 1);
            tr.twist = num(51, 0);
            tr.direction = p(16);
            tr.target = p(17);
          } else {
            tr.center = [num(10, 0), num(20, 0), 0];
            tr.height = num(40, 0);
            tr.width = num(41, 0);
            tr.twist = num(50, 0);
            tr.direction = p(11);
            tr.target = p(12);
          }
        }
        if (rec.type === 'BLOCK_RECORD') {
          tr.layout = str(340)?.trim();
          tr.units = num(70, 0);
          for (const x of xdataFirst(tags, rec.start, rec.end, 'ACDBBLOCKREPBTAG')) {
            if (x.code === 1005) tr.dynamicSource = tags.str(x.i).trim();
          }
        }
        doc.tableRecords.push(tr);
      }
    }
  }
}

class EntityCollector {
  constructor(
    private doc: DxfDocument,
    private tags: TagStore,
  ) {}

  /** Parse a run of records into entities; returns ids of top-level entities. */
  collect(records: RecordRange[], from: number, to: number, block?: string): number[] {
    const { doc, tags } = this;
    const ids: number[] = [];
    let i = from;
    while (i < to) {
      const rec = records[i];
      const type = rec.type;
      if (type === 'SEQEND' || type === 'VERTEX' || type === 'ATTRIB') {
        doc.diagnostics.push({ level: 'warning', code: 'orphan-subentity', message: `${type} without parent`, line: tags.line(rec.start) });
        if (type !== 'ATTRIB') {
          i++;
          continue;
        }
      }
      const e = this.parseOne(rec, block);
      ids.push(e.id);
      i++;
      if (type === 'POLYLINE') {
        const vertices = [];
        while (i < to && records[i].type === 'VERTEX') {
          const v = newEntityBase('VERTEX', -1, records[i].start, records[i].end);
          parseEntityRecord(v, VERTEX, tags, records[i].start, records[i].end, doc.diagnostics);
          vertices.push(vertexFrom(v));
          i++;
        }
        (e as unknown as { vertices: unknown[] }).vertices = vertices;
        if (i < to && records[i].type === 'SEQEND') {
          e.tagEnd = records[i].end;
          i++;
        } else {
          doc.diagnostics.push({ level: 'warning', code: 'missing-seqend', message: 'POLYLINE without SEQEND', line: tags.line(rec.start), handle: e.handle });
          if (i > 0) e.tagEnd = records[i - 1].end;
        }
      } else if (type === 'INSERT') {
        const attribs: Entity[] = [];
        while (i < to && records[i].type === 'ATTRIB') {
          const a = this.parseOne(records[i], block);
          a.parentInsert = e.id;
          attribs.push(a);
          i++;
        }
        (e as unknown as { attribs: Entity[] }).attribs = attribs;
        if (attribs.length || (i < to && records[i].type === 'SEQEND')) {
          if (i < to && records[i].type === 'SEQEND') {
            e.tagEnd = records[i].end;
            i++;
          } else {
            e.tagEnd = records[i - 1].end;
          }
        }
      }
    }
    return ids;
  }

  parseOne(rec: RecordRange, block?: string): Entity {
    const { doc, tags } = this;
    const id = doc.entities.length;
    const e = newEntityBase(rec.type, id, rec.start, rec.end);
    if (block !== undefined) e.block = block;
    try {
      parseEntityRecord(e, ENTITY_SPECS[rec.type], tags, rec.start, rec.end, doc.diagnostics);
    } catch (err) {
      e.partial = true;
      doc.diagnostics.push({
        level: 'error',
        code: 'entity-parse-error',
        message: `${rec.type}: ${(err as Error).message}`,
        line: tags.line(rec.start),
      });
    }
    if (!e.handle) e.handle = `#${id}`;
    doc.entities.push(e);
    return e;
  }
}

function parseBlocks(doc: DxfDocument, tags: TagStore, s: SectionRange, collector: EntityCollector): void {
  const records = splitRecords(tags, s.start, s.end);
  let i = 0;
  while (i < records.length) {
    const rec = records[i];
    if (rec.type !== 'BLOCK') {
      doc.diagnostics.push({ level: 'warning', code: 'block-structure', message: `Unexpected ${rec.type} in BLOCKS section`, line: tags.line(rec.start) });
      i++;
      continue;
    }
    const f = firstValues(tags, rec.start, rec.end);
    const str = (c: number) => (f.has(c) ? decodeEscapes(tags.str(f.get(c)!)) : undefined);
    const num = (c: number, d: number) => (f.has(c) ? tags.num(f.get(c)!) : d);
    const name = (str(2) ?? str(3) ?? '').trim();
    let ownerAfter: string | undefined;
    for (let k = rec.start + 1; k < rec.end; k++) {
      if (tags.code(k) === 330) {
        ownerAfter = tags.str(k).trim();
        break;
      }
    }
    const def: BlockDef = {
      name,
      handle: str(5)?.trim(),
      recordHandle: ownerAfter,
      flags: num(70, 0),
      base: [num(10, 0), num(20, 0), num(30, 0)],
      xrefPath: str(1),
      description: str(4),
      layer: (str(8) ?? '0').trim(),
      entities: [],
      tag: rec.start,
      tagEnd: rec.end,
    };
    let j = i + 1;
    while (j < records.length && records[j].type !== 'ENDBLK' && records[j].type !== 'BLOCK') j++;
    def.entities = collector.collect(records, i + 1, j, name);
    if (j < records.length && records[j].type === 'ENDBLK') {
      def.tagEnd = records[j].end;
      j++;
    } else {
      doc.diagnostics.push({ level: 'warning', code: 'missing-endblk', message: `BLOCK ${name} without ENDBLK`, line: tags.line(rec.start) });
    }
    if (doc.blocks.has(nameKey(name))) {
      doc.diagnostics.push({ level: 'warning', code: 'duplicate-block', message: `Duplicate block definition "${name}"`, line: tags.line(rec.start) });
    }
    doc.blocks.set(nameKey(name), def);
    i = j;
  }
}

function parseObjects(doc: DxfDocument, tags: TagStore, s: SectionRange): void {
  const records = splitRecords(tags, s.start, s.end);
  for (const rec of records) {
    const obj: DxfObject = { type: rec.type, handle: '', tagStart: rec.start, tagEnd: rec.end };
    let subclass = '';
    let inGroup = false;
    const entries: [string, string][] = [];
    let pendingKey: string | null = null;
    for (let i = rec.start + 1; i < rec.end; i++) {
      const c = tags.code(i);
      if (c >= 1000) break;
      if (c === 102) {
        const v = tags.str(i).trim();
        inGroup = v.startsWith('{');
        if (v === '{ACAD_XDICTIONARY' && i + 1 < rec.end) obj.xdict = tags.str(i + 1).trim();
        continue;
      }
      if (inGroup) continue;
      if (c === 100) {
        subclass = tags.str(i).trim();
        continue;
      }
      if (c === 5 && !obj.handle) obj.handle = tags.str(i).trim();
      else if (c === 330 && obj.owner === undefined) obj.owner = tags.str(i).trim();
      if (rec.type === 'DICTIONARY' || rec.type === 'ACDBDICTIONARYWDFLT') {
        if (c === 3) pendingKey = decodeEscapes(tags.str(i));
        else if ((c === 350 || c === 360) && pendingKey !== null) {
          entries.push([pendingKey, tags.str(i).trim()]);
          pendingKey = null;
        }
      }
      if (rec.type === 'LAYOUT' && subclass === 'AcDbLayout') {
        if (c === 1) obj.name = decodeEscapes(tags.str(i));
        else if (c === 71) obj.tabOrder = tags.num(i);
        else if (c === 330) obj.blockRecord = tags.str(i).trim();
      }
      if (rec.type === 'IMAGEDEF' || rec.type === 'IMAGEDEF_REACTOR') {
        if (c === 1) obj.fileName = decodeEscapes(tags.str(i));
      }
    }
    if (entries.length) obj.entries = entries;
    if (!obj.handle) obj.handle = `#obj${doc.objects.length}`;
    doc.objects.push(obj);
  }
}

function parseClasses(doc: DxfDocument, tags: TagStore, s: SectionRange): void {
  for (const rec of splitRecords(tags, s.start, s.end)) {
    const f = firstValues(tags, rec.start, rec.end);
    doc.classes.push({
      name: f.has(1) ? tags.str(f.get(1)!).trim() : '',
      cppName: f.has(2) ? tags.str(f.get(2)!).trim() : '',
      app: f.has(3) ? tags.str(f.get(3)!) : '',
      flags: f.has(90) ? tags.num(f.get(90)!) : 0,
      tag: rec.start,
    });
  }
}

function parseThumbnail(doc: DxfDocument, tags: TagStore, s: SectionRange): void {
  let hex = '';
  for (let i = s.start; i < s.end; i++) if (tags.code(i) === 310) hex += tags.str(i).trim();
  if (!hex) return;
  const bytes = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  doc.thumbnail = bytes;
}

function buildLayouts(doc: DxfDocument): void {
  const records = new Map<string, TableRecord>();
  for (const tr of doc.tableRecords) if (tr.table === 'BLOCK_RECORD' && tr.handle) records.set(tr.handle.toUpperCase(), tr);
  const layouts: Layout[] = [];
  for (const o of doc.objects) {
    if (o.type !== 'LAYOUT') continue;
    const br = o.blockRecord ? records.get(String(o.blockRecord).toUpperCase()) : undefined;
    layouts.push({
      name: String(o.name ?? ''),
      handle: o.handle,
      tabOrder: Number(o.tabOrder ?? 0),
      blockRecord: o.blockRecord as string | undefined,
      blockName: br?.name,
    });
  }
  layouts.sort((a, b) => a.tabOrder - b.tabOrder);
  doc.layouts = layouts;
}

function buildHandles(doc: DxfDocument): void {
  const h = doc.handles;
  doc.entities.forEach((e, i) => {
    if (e.handle) h.set(e.handle.toUpperCase(), { kind: 'entity', index: i });
  });
  doc.objects.forEach((o, i) => {
    if (o.handle) h.set(o.handle.toUpperCase(), { kind: 'object', index: i });
  });
  doc.tableRecords.forEach((t, i) => {
    if (t.handle) h.set(t.handle.toUpperCase(), { kind: 'table', index: i });
  });
}

export function parseDxf(bytes: Uint8Array, options: ParseOptions): DxfDocument {
  const diagnostics: Diagnostic[] = [];
  const progress = options.onProgress ?? (() => {});
  let tags: TagStore;
  let encoding: EncodingInfo;
  let binary = false;

  progress('decode', 0);
  if (isBinaryDxf(bytes)) {
    binary = true;
    tags = parseBinaryDxf(bytes, options.encoding, diagnostics);
    encoding = {
      encoding: options.encoding ?? 'auto',
      reason: options.encoding ? 'Binary DXF (manually selected encoding)' : 'Binary DXF (encoding from $ACADVER/$DWGCODEPAGE)',
      replacements: 0,
      overridden: !!options.encoding,
    };
  } else {
    const detected = detectEncoding(bytes);
    const enc = options.encoding ?? detected.encoding;
    const text = decodeBytes(bytes, enc);
    encoding = {
      ...detected,
      encoding: enc,
      reason: options.encoding ? `Manually selected (detected: ${detected.encoding} – ${detected.reason})` : detected.reason,
      replacements: countReplacements(text),
      overridden: !!options.encoding,
    };
    if (encoding.replacements > 0) {
      diagnostics.push({
        level: 'warning',
        code: 'decode-replacements',
        message: `${encoding.replacements} characters could not be decoded with ${enc}`,
      });
    }
    progress('tokenize', 0.1);
    tags = buildAsciiTagStore(text, diagnostics);
  }

  const doc: DxfDocument = {
    source: {
      name: options.name,
      size: bytes.length,
      binary,
      encoding,
      lineCount: tags.lineCount,
    },
    tags,
    header: new Map(),
    classes: [],
    layers: new Map(),
    linetypes: new Map(),
    styles: new Map(),
    tableRecords: [],
    blocks: new Map(),
    entities: [],
    modelSpace: [],
    paperSpace: [],
    objects: [],
    layouts: [],
    handles: new Map(),
    diagnostics,
  };

  progress('sections', 0.3);
  const sections = findSections(tags, diagnostics);
  const collector = new EntityCollector(doc, tags);
  let entityIds: number[] = [];
  for (const s of sections) {
    switch (s.name) {
      case 'HEADER':
        doc.header = parseHeader(tags, s);
        break;
      case 'CLASSES':
        parseClasses(doc, tags, s);
        break;
      case 'TABLES':
        parseTables(doc, tags, s);
        break;
      case 'BLOCKS':
        progress('blocks', 0.4);
        parseBlocks(doc, tags, s, collector);
        break;
      case 'ENTITIES': {
        progress('entities', 0.6);
        const records = splitRecords(tags, s.start, s.end);
        entityIds = collector.collect(records, 0, records.length);
        break;
      }
      case 'OBJECTS':
        progress('objects', 0.85);
        parseObjects(doc, tags, s);
        break;
      case 'THUMBNAILIMAGE':
        parseThumbnail(doc, tags, s);
        break;
      default:
        break;
    }
  }

  const ver = headerString(doc, '$ACADVER');
  doc.source.version = ver;
  doc.source.release = ver ? RELEASES[ver.toUpperCase()] : undefined;

  for (const id of entityIds) {
    if (doc.entities[id].paperSpace) doc.paperSpace.push(id);
    else doc.modelSpace.push(id);
  }
  // Some writers place model space content in the *Model_Space block
  const msBlock = doc.blocks.get('*MODEL_SPACE');
  if (msBlock && msBlock.entities.length) doc.modelSpace.push(...msBlock.entities);
  const psBlock = doc.blocks.get('*PAPER_SPACE');
  if (psBlock && psBlock.entities.length) doc.paperSpace.push(...psBlock.entities);

  if (!doc.layers.has('0')) {
    doc.layers.set('0', { name: '0', flags: 0, color: 7, linetype: 'CONTINUOUS', lineweight: -3, plot: true, tag: -1 });
  }
  buildLayouts(doc);
  buildHandles(doc);
  progress('done', 1);
  return doc;
}
