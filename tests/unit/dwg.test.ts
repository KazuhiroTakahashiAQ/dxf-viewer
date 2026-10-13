import { describe, expect, it } from 'vitest';

import { convertDwg, DwgConvertError } from '../../src/dwg/convert';
import { dwgErrorNames, dwgSignature } from '../../src/dwg/detect';
import { noteDwgOrigin } from '../../src/dwg/origin';
import { parseDxf } from '../../src/dxf/parser';
import { setLocale, tx } from '../../src/i18n';
import { guessGenerator } from '../../src/worker/docInfo';
import { dxf, enc, entitiesDoc } from './helpers';

const ascii = (s: string) => new TextEncoder().encode(s);

describe('DWG signature', () => {
  it('recognizes DWG files of every generation', () => {
    expect(dwgSignature(ascii('AC1032\0\0\0'))).toEqual({ version: 'AC1032', release: 'R2018' });
    expect(dwgSignature(ascii('AC1015'))).toEqual({ version: 'AC1015', release: 'R2000' });
    expect(dwgSignature(ascii('AC1009'))).toEqual({ version: 'AC1009', release: 'R11/R12' });
    expect(dwgSignature(ascii('AC2.10\0'))).toEqual({ version: 'AC2.10', release: 'R2.10' });
    expect(dwgSignature(ascii('AC2.21\0'))).toEqual({ version: 'AC2.21', release: 'R2.21' });
    expect(dwgSignature(ascii('AC1.40\0'))).toEqual({ version: 'AC1.40', release: 'R1.4' });
    expect(dwgSignature(ascii('AC1.2\0\0'))).toEqual({ version: 'AC1.2', release: 'R1.2' });
    // a signature newer than the table is still a DWG
    expect(dwgSignature(ascii('AC1040'))).toEqual({ version: 'AC1040', release: undefined });
  });

  it('does not mistake DXF for DWG', () => {
    expect(dwgSignature(enc(dxf(entitiesDoc([]))))).toBeNull();
    expect(dwgSignature(ascii('999\r\nAC1032 comment'))).toBeNull();
    expect(dwgSignature(ascii('AutoCAD Binary DXF\r\n\x1a\0'))).toBeNull();
    expect(dwgSignature(new Uint8Array())).toBeNull();
  });

  it('names LibreDWG error flags', () => {
    expect(dwgErrorNames(0)).toEqual([]);
    expect(dwgErrorNames(4 | 64)).toEqual(['UNHANDLEDCLASS', 'VALUEOUTOFBOUNDS']);
  });
});

describe('DWG conversion (LibreDWG WebAssembly)', () => {
  it('rejects a file that is not a valid DWG', async () => {
    const err = await convertDwg(ascii('AC1032 this is not a drawing')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DwgConvertError);
    expect((err as DwgConvertError).code & 2048).toBeTruthy();
    expect((err as Error).message).toMatch(/INVALIDDWG/);
    setLocale('ja');
    expect(tx((err as Error).message)).toMatch(/^DWG ファイルを変換できませんでした（LibreDWG: .*INVALIDDWG.*）$/);
    setLocale('en');
  });

  it('records the DWG origin on the parsed document', () => {
    const conv = { dxf: enc(dxf([[999, 'LibreDWG 0.13.3'], ...entitiesDoc([])])), errorCode: 4, converter: 'LibreDWG 0.13.3', layerOff: null, ms: 12 };
    const d = parseDxf(conv.dxf, { name: 'a.dwg' });
    noteDwgOrigin(d, { version: 'AC1032', release: 'R2018' }, conv, 1234);
    expect(d.source.dwg).toEqual({ version: 'AC1032', release: 'R2018', size: 1234, converter: 'LibreDWG 0.13.3', errors: ['UNHANDLEDCLASS'], ms: 12 });
    expect(d.diagnostics.map((x) => x.code)).toEqual(['dwg-converted', 'dwg-errors', 'dwg-empty']);
    // the converter's own comment is not evidence of the application that wrote the DWG
    const g = guessGenerator(d);
    expect(g.evidence.some((e) => e.startsWith('comment:'))).toBe(false);
    expect(g.evidence).toContain('DWG AC1032, converted to DXF with LibreDWG 0.13.3');
    setLocale('ja');
    expect(tx(d.diagnostics[0].message)).toBe('DWG AC1032 (R2018) を LibreDWG 0.13.3 で DXF に変換しました。行番号とグループコードは変換後の DXF のものです');
    for (const x of d.diagnostics) expect(tx(x.message)).not.toBe(x.message);
    setLocale('en');
  });

  it('warns that DWG files older than R13 are only partly supported', () => {
    const conv = { dxf: enc(dxf(entitiesDoc([[0, 'POINT'], [8, '0'], [10, 0], [20, 0]]))), errorCode: 0, converter: 'LibreDWG', layerOff: null, ms: 1 };
    const codes = (version: string) => {
      const d = parseDxf(conv.dxf, { name: 'a.dwg' });
      noteDwgOrigin(d, { version }, conv, 1);
      return d.diagnostics.map((x) => x.code);
    };
    expect(codes('AC1009')).toEqual(['dwg-converted', 'dwg-old']);
    expect(codes('AC2.10')).toEqual(['dwg-converted', 'dwg-old']);
    expect(codes('AC1012')).toEqual(['dwg-converted']);
    expect(codes('AC1032')).toEqual(['dwg-converted']);
    expect(codes('AC402b')).toEqual(['dwg-converted']);
  });

  it('takes layer on / off from the DWG when the converted DXF disagrees', () => {
    const layer = (handle: string, name: string, color: number): [number, string | number][] => [[0, 'LAYER'], [5, handle], [2, name], [70, 0], [62, color]];
    const text = dxf([
      [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'],
      ...layer('10', '0', -7), ...layer('89', 'Walls', -2), ...layer('8A', 'Hidden', 4), ...layer('8B', 'Unknown', -5),
      [0, 'ENDTAB'], [0, 'ENDSEC'],
      ...entitiesDoc([[0, 'POINT'], [8, 'Walls'], [10, 0], [20, 0]]),
    ]);
    const d = parseDxf(enc(text), { name: 'a.dwg' });
    // as LibreDWG 0.13.3 writes R13+ layers: all negative; the DWG says only "Hidden" is off
    noteDwgOrigin(d, { version: 'AC1032' }, { dxf: enc(text), errorCode: 0, converter: 'LibreDWG', layerOff: { '10': false, '89': false, '8A': true }, ms: 1 }, 1);
    const colors = Object.fromEntries([...d.layers.values()].map((l) => [l.name, l.color]));
    expect(colors).toEqual({ '0': 7, Walls: 2, Hidden: -4, Unknown: -5 });
    expect(d.diagnostics.find((x) => x.code === 'dwg-layer-off')?.message).toBe('On / off of 3 layers taken from the DWG (the converted DXF has them wrong)');
  });
});
