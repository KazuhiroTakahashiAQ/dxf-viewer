import { describe, expect, it } from 'vitest';

import { parseDxf } from '../../src/dxf/parser';
import type { LwPolylineEntity, PolylineEntity, InsertEntity, TextEntity, MTextEntity } from '../../src/dxf/model';
import { dxf, enc, entitiesDoc } from './helpers';

describe('parseDxf (ASCII)', () => {
  it('parses a minimal ENTITIES-only file with CRLF', () => {
    const doc = parseDxf(
      enc(dxf(entitiesDoc([[0, 'LINE'], [8, 'WALL'], [62, 1], [10, 1], [20, 2], [30, 0], [11, 3], [21, 4], [31, 0]]))),
      { name: 't.dxf' },
    );
    expect(doc.entities).toHaveLength(1);
    const e = doc.entities[0];
    expect(e.type).toBe('LINE');
    expect(e.layer).toBe('WALL');
    expect(e.color).toBe(1);
    expect(e.start).toEqual([1, 2, 0]);
    expect(e.end).toEqual([3, 4, 0]);
    expect(doc.modelSpace).toEqual([0]);
  });

  it('accepts LF and CR line endings and padded codes', () => {
    for (const eol of ['\n', '\r']) {
      const doc = parseDxf(enc(dxf(entitiesDoc([[0, 'CIRCLE'], [10, 5], [20, 6], [40, 2.5]]), eol)), { name: 't' });
      expect(doc.entities[0].center).toEqual([5, 6, 0]);
      expect(doc.entities[0].radius).toBe(2.5);
    }
  });

  it('keeps every tag: tag count equals half the line count', () => {
    const text = dxf(entitiesDoc([[0, 'POINT'], [10, 1], [20, 1], [999, 'comment'], [1001, 'APP'], [1000, 'x']]));
    const doc = parseDxf(enc(text), { name: 't' });
    expect(doc.tags.count * 2).toBe(doc.source.lineCount);
    expect(doc.entities[0].xdataApps).toEqual(['APP']);
  });

  it('assembles LWPOLYLINE vertices with bulges and widths', () => {
    const doc = parseDxf(
      enc(
        dxf(
          entitiesDoc([
            [0, 'LWPOLYLINE'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbPolyline'], [90, 3], [70, 1],
            [10, 0], [20, 0], [42, 1],
            [10, 10], [20, 0], [40, 0.5], [41, 1],
            [10, 10], [20, 10],
          ]),
        ),
      ),
      { name: 't' },
    );
    const p = doc.entities[0] as LwPolylineEntity;
    expect(p.closed).toBe(true);
    expect(p.points).toEqual([0, 0, 10, 0, 10, 10]);
    expect(p.bulges).toEqual([1, 0, 0]);
    expect(p.startWidths[1]).toBe(0.5);
    expect(p.endWidths[1]).toBe(1);
  });

  it('collects POLYLINE vertices until SEQEND', () => {
    const doc = parseDxf(
      enc(
        dxf(
          entitiesDoc([
            [0, 'POLYLINE'], [66, 1], [70, 8], [10, 0], [20, 0], [30, 0],
            [0, 'VERTEX'], [10, 1], [20, 2], [30, 3], [70, 32],
            [0, 'VERTEX'], [10, 4], [20, 5], [30, 6], [70, 32],
            [0, 'SEQEND'],
            [0, 'LINE'], [10, 0], [20, 0], [11, 1], [21, 1],
          ]),
        ),
      ),
      { name: 't' },
    );
    expect(doc.modelSpace).toHaveLength(2);
    const pl = doc.entities[0] as PolylineEntity;
    expect(pl.vertices.map((v) => v.position)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('attaches ATTRIBs to INSERT and parses blocks', () => {
    const text = dxf([
      [0, 'SECTION'], [2, 'BLOCKS'],
      [0, 'BLOCK'], [8, '0'], [2, 'DOOR'], [70, 2], [10, 1], [20, 1], [30, 0], [3, 'DOOR'],
      [0, 'LINE'], [8, '0'], [10, 0], [20, 0], [11, 1], [21, 0],
      [0, 'ATTDEF'], [10, 0], [20, 0], [40, 1], [1, ''], [3, 'Tag?'], [2, 'TAG'], [70, 0],
      [0, 'ENDBLK'],
      [0, 'ENDSEC'],
      [0, 'SECTION'], [2, 'ENTITIES'],
      [0, 'INSERT'], [66, 1], [2, 'door'], [10, 5], [20, 5], [41, 2], [42, 2], [50, 90],
      [0, 'ATTRIB'], [10, 5], [20, 5], [40, 1], [1, 'D1'], [2, 'TAG'], [70, 0], [74, 2],
      [0, 'SEQEND'],
      [0, 'ENDSEC'], [0, 'EOF'],
    ]);
    const doc = parseDxf(enc(text), { name: 't' });
    const block = doc.blocks.get('DOOR')!;
    expect(block.entities).toHaveLength(2);
    expect(block.base).toEqual([1, 1, 0]);
    const ins = doc.entities[doc.modelSpace[0]] as InsertEntity;
    expect(ins.name).toBe('door');
    expect(ins.scale).toEqual([2, 2, 1]);
    expect(ins.attribs).toHaveLength(1);
    const att = ins.attribs[0];
    expect(att.tag).toBe('TAG');
    expect(att.text).toBe('D1');
    expect(att.valign).toBe(2);
  });

  it('decodes Shift_JIS text and reports the reason', () => {
    const header = dxf([
      [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [9, '$DWGCODEPAGE'], [3, 'ANSI_932'], [0, 'ENDSEC'],
    ]);
    const body = dxf(entitiesDoc([[0, 'TEXT'], [8, '寸法'], [10, 0], [20, 0], [40, 2.5], [1, '日本語テキスト']]));
    const sjis = encodeShiftJis(header + body);
    const doc = parseDxf(sjis, { name: 't' });
    expect(doc.source.encoding.encoding).toBe('shift_jis');
    expect(doc.source.encoding.reason).toContain('ANSI_932');
    expect(doc.source.encoding.replacements).toBe(0);
    const t = doc.entities[0] as TextEntity;
    expect(t.layer).toBe('寸法');
    expect(t.text).toBe('日本語テキスト');
  });

  it('detects Shift_JIS without $DWGCODEPAGE (Jw_cad style R12)', () => {
    const body = dxf(entitiesDoc([[0, 'TEXT'], [8, '0'], [10, 0], [20, 0], [40, 2.5], [1, '平面図　Ｓ＝１：１００']]));
    const doc = parseDxf(encodeShiftJis(body), { name: 't' });
    expect(doc.source.encoding.encoding).toBe('shift_jis');
    expect((doc.entities[0] as TextEntity).text).toBe('平面図　Ｓ＝１：１００');
  });

  it('uses UTF-8 for R2007+ and allows manual override', () => {
    const text = dxf([
      [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1032'], [9, '$DWGCODEPAGE'], [3, 'ANSI_1252'], [0, 'ENDSEC'],
      [0, 'SECTION'], [2, 'ENTITIES'], [0, 'MTEXT'], [10, 0], [20, 0], [40, 1], [3, 'ab'], [1, 'cdé'], [0, 'ENDSEC'], [0, 'EOF'],
    ]);
    const doc = parseDxf(enc(text), { name: 't' });
    expect(doc.source.encoding.encoding).toBe('utf-8');
    expect((doc.entities[0] as MTextEntity).text).toBe('abcdé');
    const forced = parseDxf(enc(text), { name: 't', encoding: 'windows-1252' });
    expect(forced.source.encoding.overridden).toBe(true);
    expect((forced.entities[0] as MTextEntity).text).not.toBe('abcdé');
  });

  it('decodes \\U+ escapes in layer names', () => {
    const doc = parseDxf(enc(dxf(entitiesDoc([[0, 'POINT'], [8, '\\U+58C1'], [10, 0], [20, 0]]))), { name: 't' });
    expect(doc.entities[0].layer).toBe('壁');
  });

  it('records diagnostics for orphan VERTEX and invalid group codes', () => {
    const text = '  0\nSECTION\n  2\nENTITIES\nfoo\n  0\nVERTEX\n 10\n0\n  0\nENDSEC\n  0\nEOF\n';
    const doc = parseDxf(enc(text), { name: 't' });
    expect(doc.diagnostics.map((d) => d.code)).toContain('bad-group-code');
    expect(doc.diagnostics.map((d) => d.code)).toContain('orphan-subentity');
  });
});

/** Minimal Shift_JIS encoder for tests (via a reverse lookup table built from TextDecoder). */
function encodeShiftJis(s: string): Uint8Array {
  const table = sjisTable();
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) {
      out.push(c);
      continue;
    }
    const b = table.get(ch);
    if (!b) throw new Error(`cannot encode ${ch}`);
    out.push(...b);
  }
  return new Uint8Array(out);
}

let cached: Map<string, number[]> | null = null;
function sjisTable(): Map<string, number[]> {
  if (cached) return cached;
  const dec = new TextDecoder('shift_jis');
  const m = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch !== '�' && !m.has(ch)) m.set(ch, [lead, trail]);
    }
  }
  cached = m;
  return m;
}

describe('encoding detection heuristics', () => {
  it('a lone high byte next to ASCII letters is Windows-1252, not Shift_JIS', async () => {
    const { detectEncoding } = await import('../../src/dxf/reader/encoding');
    const bytes = new Uint8Array([...new TextEncoder().encode('  0\nSECTION\n  2\nENTITIES\n  0\nTEXT\n  1\nSample1'), 0xbf, ...new TextEncoder().encode('\n  0\nENDSEC\n  0\nEOF\n')]);
    expect(detectEncoding(bytes).encoding).toBe('windows-1252');
  });
  it('Shift_JIS double-byte text without a code page is still detected', async () => {
    const { detectEncoding } = await import('../../src/dxf/reader/encoding');
    // "平面図" in Shift_JIS
    const bytes = new Uint8Array([...new TextEncoder().encode('  0\nTEXT\n  1\n'), 0x95, 0xbd, 0x96, 0xca, 0x90, 0x7d, ...new TextEncoder().encode('\n  0\nEOF\n')]);
    expect(detectEncoding(bytes).encoding).toBe('shift_jis');
  });
});

describe('MTEXT embedded object (R2018 columns)', () => {
  it('keeps the main properties and reads the column settings', () => {
    const doc = parseDxf(
      enc(
        dxf(
          entitiesDoc([
            [0, 'MTEXT'], [8, '0'], [100, 'AcDbMText'], [10, 72.95], [20, 49.46], [30, 0], [40, 0.8], [41, 13.88], [71, 1], [72, 5], [1, 'POLYLINE WITH BULGE'], [73, 1], [44, 1],
            [101, 'Embedded Object'], [70, 1], [10, 1], [20, 0], [30, 0], [11, 72.95], [21, 49.46], [31, 0], [40, 13.88], [41, 0], [42, 12.58], [43, 0.83],
            [71, 2], [72, 3], [44, 13.88], [45, 1.5], [73, 0], [74, 0], [46, 5], [46, 6], [46, 7],
          ]),
        ),
      ),
      { name: 't.dxf' },
    );
    const m = doc.entities[doc.modelSpace[0]] as unknown as Record<string, unknown>;
    expect(m.height).toBe(0.8);
    expect(m.insert).toEqual([72.95, 49.46, 0]);
    expect(m.attachment).toBe(1);
    expect(m.xAxis ?? [1, 0, 0]).toEqual([1, 0, 0]);
    expect([m.columnType, m.columnCount, m.columnWidth, m.columnGutter, m.columnHeights]).toEqual([2, 3, 13.88, 1.5, [5, 6, 7]]);
  });
});
