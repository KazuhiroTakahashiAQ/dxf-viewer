import { nameKey, type DimensionEntity, type DxfDocument, type MTextEntity, type TextEntity } from '../dxf/model';
import { decodeEscapes, plainText } from '../dxf/text/escapes';
import { mtextPlain } from '../dxf/text/mtext';
import type { TextQuery, TextRow } from '../shared/docApi';

/** Text-bearing entity types and how their text is extracted. */
export function textOf(doc: DxfDocument, id: number): { raw: string; plain: string; style: string; height: number } | null {
  const e = doc.entities[id];
  switch (e.type) {
    case 'TEXT':
    case 'ATTRIB':
    case 'ATTDEF': {
      const t = e as TextEntity;
      if (t.mtext) return { raw: t.mtext.text, plain: mtextPlain(t.mtext.text), style: t.style, height: t.mtext.height || t.height };
      return { raw: t.text, plain: plainText(t.text), style: t.style, height: t.height };
    }
    case 'MTEXT': {
      const m = e as MTextEntity;
      return { raw: m.text, plain: mtextPlain(m.text), style: m.style, height: m.height };
    }
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION': {
      const d = e as DimensionEntity;
      const measured = d.measurement !== undefined ? String(Number(d.measurement.toFixed(6))) : '';
      const over = d.textOverride ?? '';
      const plain = over === '' ? measured : over === ' ' ? '' : mtextPlain(over.replace(/<>/g, measured));
      return { raw: over || measured, plain, style: d.dimStyle, height: 0 };
    }
    default:
      return null;
  }
}

export class TextIndex {
  rows: TextRow[] = [];

  constructor(doc: DxfDocument) {
    const containers = new Map<number, string>();
    for (const b of doc.blocks.values()) for (const id of b.entities) containers.set(id, `Block: ${b.name}`);
    for (const id of doc.modelSpace) containers.set(id, 'Model');
    for (const id of doc.paperSpace) containers.set(id, 'Paper');
    for (let id = 0; id < doc.entities.length; id++) {
      const t = textOf(doc, id);
      if (!t) continue;
      const e = doc.entities[id];
      const parent = typeof e.parentInsert === 'number' ? (e.parentInsert as number) : undefined;
      const container = containers.get(parent ?? id) ?? (e.block ? `Block: ${e.block}` : '');
      this.rows.push({
        id,
        handle: e.handle,
        type: e.type,
        layer: decodeEscapes(e.layer),
        style: t.style,
        height: t.height,
        raw: t.raw,
        plain: t.plain,
        container,
        tag: (e as TextEntity).tag,
      });
    }
  }

  query(q: TextQuery): { total: number; rows: TextRow[]; error?: string } {
    let list = this.rows;
    if (q.container && q.container !== 'all') {
      list = list.filter((r) => (q.container === 'blocks' ? r.container.startsWith('Block') : r.container === q.container));
    }
    if (q.text) {
      let test: (s: string) => boolean;
      if (q.regex) {
        if (q.text.length > 500) return { total: 0, rows: [], error: 'Pattern too long' };
        try {
          const re = new RegExp(q.text, q.caseSensitive ? 'u' : 'iu');
          test = (s) => re.test(s);
        } catch (err) {
          return { total: 0, rows: [], error: (err as Error).message };
        }
      } else {
        const needle = q.caseSensitive ? q.text : q.text.toLowerCase();
        test = (s) => (q.caseSensitive ? s : s.toLowerCase()).includes(needle);
      }
      list = list.filter((r) => test(q.field === 'raw' ? r.raw : r.plain) || (!!r.tag && test(r.tag)));
    }
    const total = list.length;
    return { total, rows: list.slice(q.offset, q.offset + q.limit) };
  }

  styleUsage(): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of this.rows) m.set(nameKey(r.style), (m.get(nameKey(r.style)) ?? 0) + 1);
    return m;
  }
}
