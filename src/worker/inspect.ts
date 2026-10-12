import { aciToRgb } from '../dxf/colors';
import { describeCode } from '../dxf/codes';
import { decodeSat } from '../dxf/entities/complexSpecs';
import { nameKey, type DxfDocument, type Entity, type InsertEntity, type MTextEntity, type TextEntity } from '../dxf/model';
import { decodeEscapes, plainText } from '../dxf/text/escapes';
import { mtextPlain } from '../dxf/text/mtext';
import { identity } from '../geom/matrix';
import { FLATTEN_BUDGET, FlattenBudgetError, FlattenHost } from '../scene/flatten';
import type { StyleResolver } from '../scene/style';
import { TOP_CTX } from '../scene/style';
import type { TextMeasurer } from '../scene/textLayout';
import type { EntityInfo, PropRow, RawTagRow } from '../shared/docApi';

const SKIP = new Set(['id', 'tagStart', 'tagEnd', 'xdataStart', 'subclasses', 'proxyGraphics', 'virtual', 'partial', 'attribs', 'vertices', 'parentInsert', 'satStart', 'satEnd', 'mtext', 'ctx', 'leaders', 'paths', 'patternLines']);

const COMMON_KEYS = ['type', 'handle', 'owner', 'layer', 'color', 'trueColor', 'colorName', 'linetype', 'lineweight', 'ltscale', 'transparency', 'invisible', 'paperSpace', 'layoutName', 'block', 'thickness', 'extrusion', 'xdict', 'reactors', 'xdataApps'];

function fmt(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toPrecision(12));
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    if (v.length <= 4 && v.every((x) => typeof x === 'number')) return v.map((x) => Number((x as number).toPrecision(12))).join(', ');
    if (v.length && v.every((x) => typeof x === 'string')) return v.length <= 8 ? v.join(', ') : `${v.slice(0, 8).join(', ')} … (${v.length})`;
    return `[${v.length} items]`;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch {
    return String(v);
  }
}

const hex = (rgb: number) => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

function colorText(e: Entity): string {
  if (e.trueColor !== undefined) return `${hex(e.trueColor)} (true color, ACI ${e.color})`;
  if (e.color === 256) return 'BYLAYER';
  if (e.color === 0) return 'BYBLOCK';
  return `ACI ${e.color} (${hex(aciToRgb(e.color))})`;
}

function lineweightText(lw: number): string {
  if (lw === -1) return 'BYLAYER';
  if (lw === -2) return 'BYBLOCK';
  if (lw === -3) return 'DEFAULT';
  return `${(lw / 100).toFixed(2)} mm`;
}

export function entityInfo(doc: DxfDocument, id: number, styles: StyleResolver, measurer: TextMeasurer): EntityInfo | null {
  const e = doc.entities[id];
  if (!e) return null;
  const rows: PropRow[] = [];
  const add = (group: string, key: string, label: string, value: unknown, extra: Partial<PropRow> = {}) => rows.push({ group, key, label, value: fmt(value), ...extra });

  // --- General ---
  add('General', 'type', 'Type', e.type);
  add('General', 'handle', 'Handle', e.handle, { kind: 'handle' });
  if (e.owner) add('General', 'owner', 'Owner', e.owner, { kind: 'handle' });
  const st = styles.resolve(e, TOP_CTX);
  add('General', 'layer', 'Layer', decodeEscapes(e.layer), { kind: 'layer' });
  add('General', 'color', 'Color', colorText(e), { kind: 'color', color: st.fg ? undefined : hex(st.rgb) });
  add('General', 'effectiveColor', 'Effective color', st.fg ? 'foreground (ACI 7)' : hex(st.rgb), { kind: 'color', color: st.fg ? undefined : hex(st.rgb) });
  add('General', 'linetype', 'Linetype', e.linetype ?? 'BYLAYER');
  add('General', 'lineweight', 'Lineweight', lineweightText(e.lineweight));
  if (e.ltscale !== 1) add('General', 'ltscale', 'Linetype scale', e.ltscale);
  if (e.transparency !== undefined) add('General', 'transparency', 'Transparency', e.transparency & 0x02000000 ? `${Math.round((1 - (e.transparency & 0xff) / 255) * 100)}%` : e.transparency === 0x01000000 ? 'BYBLOCK' : 'BYLAYER');
  if (e.invisible) add('General', 'invisible', 'Invisible', true);
  add('General', 'space', 'Space', e.block ? `Block: ${e.block}` : e.paperSpace ? 'Paper' : 'Model');
  if (e.layoutName) add('General', 'layoutName', 'Layout', e.layoutName);
  if (e.thickness) add('General', 'thickness', 'Thickness', e.thickness);
  if (e.extrusion) add('General', 'extrusion', 'Extrusion', e.extrusion);
  if (e.subclasses?.length) add('General', 'subclasses', 'Subclasses', e.subclasses.join(' / '));
  if (typeof e.parentInsert === 'number') add('General', 'parent', 'Parent INSERT', doc.entities[e.parentInsert as number]?.handle, { kind: 'handle' });

  // --- type specific fields ---
  for (const [k, v] of Object.entries(e)) {
    if (SKIP.has(k) || COMMON_KEYS.includes(k) || k.startsWith('_')) continue;
    if (v === undefined) continue;
    if (k === 'text' && typeof v === 'string') continue;
    add('Properties', k, k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), v);
  }

  // --- text ---
  if (e.type === 'TEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF' || e.type === 'MTEXT') {
    const t = e as TextEntity | MTextEntity;
    const raw = (t as TextEntity).mtext?.text ?? t.text;
    add('Text', 'raw', 'Raw', raw, { kind: 'text' });
    add('Text', 'decoded', 'Decoded escapes', decodeEscapes(raw), { kind: 'text' });
    add('Text', 'plain', 'Plain text', e.type === 'MTEXT' || (t as TextEntity).mtext ? mtextPlain(raw) : plainText(raw), { kind: 'text' });
  }

  // --- geometry metrics ---
  const host = new FlattenHost({ doc, measurer, styles });
  try {
    host.visit(e, identity());
    const out = host.out;
    if (out.polylines.length && !['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF', 'INSERT', 'DIMENSION'].includes(e.type)) {
      add('Computed', 'length', 'Length', out.length());
      const area = out.area();
      if (area !== undefined) add('Computed', 'area', 'Area', area);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pl of out.polylines)
      for (let i = 0; i < pl.length; i += 2) {
        minX = Math.min(minX, pl[i]);
        maxX = Math.max(maxX, pl[i]);
        minY = Math.min(minY, pl[i + 1]);
        maxY = Math.max(maxY, pl[i + 1]);
      }
    if (minX <= maxX) {
      add('Computed', 'bboxMin', 'Bounds min', [minX, minY]);
      add('Computed', 'bboxMax', 'Bounds max', [maxX, maxY]);
      add('Computed', 'size', 'Size (W × H)', `${fmt(maxX - minX)} × ${fmt(maxY - minY)}`);
    }
  } catch (err) {
    // metrics are best effort; huge block expansions are not flattened
    if (err instanceof FlattenBudgetError) add('Computed', 'notComputed', 'Not computed', `more than ${FLATTEN_BUDGET.toLocaleString('en-US')} entities inside`);
  }

  // --- block reference ---
  if (e.type === 'INSERT') {
    const ins = e as InsertEntity;
    const block = doc.blocks.get(nameKey(ins.name));
    add('Block', 'name', 'Block name', ins.name, { kind: 'block' });
    if (block) {
      add('Block', 'base', 'Base point', block.base);
      add('Block', 'count', 'Entities in block', block.entities.length);
      if (block.flags & 4) add('Block', 'xref', 'External reference', block.xrefPath ?? '');
      const rec = doc.tableRecords.find((r) => r.table === 'BLOCK_RECORD' && nameKey(r.name) === nameKey(ins.name));
      const src = rec?.dynamicSource ? doc.tableRecords.find((r) => r.handle?.toUpperCase() === String(rec.dynamicSource).toUpperCase()) : undefined;
      if (src) add('Block', 'effectiveName', 'Effective name (dynamic block)', src.name, { kind: 'block' });
    } else add('Block', 'missing', 'Definition', 'missing');
    const mirrored = (ins.scale[0] || 1) * (ins.scale[1] || 1) < 0;
    if (mirrored) add('Block', 'mirrored', 'Mirrored', true);
    for (const a of ins.attribs) {
      const t = a as TextEntity;
      add('Attributes', `attr.${t.tag}`, t.tag ?? '?', t.mtext ? mtextPlain(t.mtext.text) : plainText(t.text), { kind: 'text', link: { entity: a.id } });
    }
  }

  // --- ACIS ---
  if (typeof e.satStart === 'number') {
    const lines: string[] = [];
    for (let i = e.satStart as number; i < (e.satEnd as number) && lines.length < 200; i++) {
      const raw = doc.tags.str(i);
      lines.push(/\bpoint\b|\bbody\b/.test(raw) ? raw : decodeSat(raw));
    }
    add('ACIS', 'sat', 'SAT (decoded, first 200 lines)', lines.join('\n'), { kind: 'text' });
  }

  // --- XDATA ---
  const xdata: EntityInfo['xdata'] = [];
  if (e.xdataStart !== undefined) {
    let cur: { app: string; tags: { code: number; value: string }[] } | null = null;
    for (let i = e.xdataStart; i < e.tagEnd; i++) {
      const c = doc.tags.code(i);
      if (c < 1000) break;
      if (c === 1001) {
        cur = { app: doc.tags.str(i).trim(), tags: [] };
        xdata.push(cur);
      } else cur?.tags.push({ code: c, value: decodeEscapes(doc.tags.str(i)) });
    }
  }
  if (e.reactors?.length) add('Links', 'reactors', 'Reactors', e.reactors.join(', '), { kind: 'handle' });
  if (e.xdict) add('Links', 'xdict', 'Extension dictionary', e.xdict, { kind: 'handle' });

  return {
    id,
    handle: e.handle,
    type: e.type,
    layer: decodeEscapes(e.layer),
    rows,
    xdata,
    tagCount: e.tagEnd - e.tagStart,
    line: doc.tags.binary ? undefined : doc.tags.line(e.tagStart),
  };
}

export function rawTags(doc: DxfDocument, id: number, offset: number, limit: number): { total: number; rows: RawTagRow[] } {
  const e = doc.entities[id];
  if (!e) return { total: 0, rows: [] };
  const total = e.tagEnd - e.tagStart;
  const rows: RawTagRow[] = [];
  let type = e.type;
  for (let i = e.tagStart + offset; i < Math.min(e.tagEnd, e.tagStart + offset + limit); i++) {
    const code = doc.tags.code(i);
    if (code === 0) type = doc.tags.str(i).trim().toUpperCase();
    rows.push({ index: i - e.tagStart, line: doc.tags.line(i), code, value: doc.tags.str(i), desc: describeCode(type, code) });
  }
  return { total, rows };
}
