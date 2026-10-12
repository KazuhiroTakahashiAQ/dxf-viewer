import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseDxf } from '../../src/dxf/parser';
import type { MTextEntity, TextEntity } from '../../src/dxf/model';
import { plainText } from '../../src/dxf/text/escapes';
import { mtextPlain } from '../../src/dxf/text/mtext';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'tests/fixtures/samples-manifest.json'), 'utf8')) as Record<
  string,
  { modelspace: Record<string, number>; layers: string[]; texts: string[]; blocks: string[] }
>;

function load(name: string) {
  const bytes = new Uint8Array(readFileSync(join(root, 'public/samples', name)));
  return parseDxf(bytes, { name });
}

describe('generated samples (consistency with ezdxf)', () => {
  for (const [name, expected] of Object.entries(manifest)) {
    it(`${name}: parses without errors and matches model space counts`, () => {
      const doc = load(name);
      expect(doc.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
      expect(doc.source.encoding.replacements).toBe(0);
      const counts: Record<string, number> = {};
      for (const id of doc.modelSpace) {
        const t = doc.entities[id].type;
        counts[t] = (counts[t] ?? 0) + 1;
      }
      expect(counts).toEqual(expected.modelspace);
      const layerNames = [...doc.layers.values()].map((l) => l.name).sort();
      expect(layerNames).toEqual([...expected.layers].sort());
      if (!doc.source.binary) expect(doc.tags.count * 2).toBe(doc.source.lineCount);
    });
  }

  it('decodes Japanese text in the Shift_JIS samples', () => {
    for (const name of ['japanese_sjis_r2000.dxf', 'jwcad_like_r12.dxf']) {
      const doc = load(name);
      expect(doc.source.encoding.encoding).toBe('shift_jis');
      const texts = doc.modelSpace
        .map((id) => doc.entities[id])
        .filter((e) => e.type === 'TEXT')
        .map((e) => plainText((e as TextEntity).text));
      for (const t of manifest[name].texts.filter((x) => !x.includes('\\'))) expect(texts).toContain(t);
    }
  });

  it('the Jw_cad-like file has no $DWGCODEPAGE and is detected heuristically', () => {
    const doc = load('jwcad_like_r12.dxf');
    expect(doc.header.has('$DWGCODEPAGE')).toBe(false);
    expect(doc.source.encoding.reason).toMatch(/Shift_JIS/);
  });

  it('resolves \\U+ and \\M+ escapes', () => {
    const doc = load('unicode_escapes_r2000.dxf');
    const text = doc.modelSpace.map((id) => doc.entities[id]).find((e) => e.type === 'TEXT') as TextEntity;
    expect(plainText(text.text)).toContain('漢 Unicode 漢字');
    const mt = doc.modelSpace.map((id) => doc.entities[id]).find((e) => e.type === 'MTEXT') as MTextEntity;
    expect(mtextPlain(mt.text)).toBe('MTEXT 東京\n第二段落');
    expect([...doc.layers.values()].map((l) => l.name)).toContain('図面枠');
  });

  it('reads binary DXF', () => {
    const doc = load('binary.dxf');
    expect(doc.source.binary).toBe(true);
    const text = doc.modelSpace.map((id) => doc.entities[id]).find((e) => e.type === 'TEXT') as TextEntity;
    expect(text.text).toBe('Binary DXF');
  });
});
