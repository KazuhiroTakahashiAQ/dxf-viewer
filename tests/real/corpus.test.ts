/**
 * Invariant tests on real-world DXF files (tests/real/corpus.json, downloaded by
 * `node tools/corpus/fetch.ts`) and on any files placed in tests/real/local/.
 * Files that are not present are skipped, so CI without the corpus still passes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseDxf } from '../../src/dxf/parser';
import type { DxfDocument } from '../../src/dxf/model';
import { SvgPath } from '../../src/render/svgContext';
import { SceneBuilder } from '../../src/scene/scene';
import { StyleResolver } from '../../src/scene/style';
import type { TextMeasurer } from '../../src/scene/textLayout';
import { guessGenerator } from '../../src/worker/docInfo';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const local = join(here, 'local');
const manifest = JSON.parse(readFileSync(join(here, 'corpus.json'), 'utf8')) as {
  files: { id: string; generator: string; expect?: { malformed?: boolean; generator?: string } }[];
};
const measurer: TextMeasurer = { width: (t) => t.length * 60, metrics: () => ({ capHeight: 0.7, ascent: 0.9, descent: 0.2 }) };

interface Case {
  id: string;
  path: string;
  malformed: boolean;
  generator?: string;
}

const cases: Case[] = [
  ...manifest.files.map((f) => ({ id: f.id, path: join(cache, `${f.id}.dxf`), malformed: !!f.expect?.malformed, generator: f.expect?.generator })),
  ...(existsSync(local) ? readdirSync(local).filter((n) => /\.dxf$/i.test(n)) : []).map((n) => ({ id: `local/${n}`, path: join(local, n), malformed: false })),
];

function build(doc: DxfDocument, items: number[]) {
  const styles = new StyleResolver(doc);
  const b = new SceneBuilder(doc, items, measurer, () => new SvgPath() as unknown as Path2D, undefined, styles);
  b.prepare();
  let guard = 0;
  while (!b.done && guard++ < 1e6) b.step(Infinity, () => 0);
  return b;
}

describe('real-world corpus', () => {
  const present = cases.filter((c) => existsSync(c.path));
  it.skipIf(present.length > 0)('corpus not downloaded (run node tools/corpus/fetch.ts)', () => {});

  for (const c of cases) {
    it.skipIf(!existsSync(c.path))(c.id, () => {
      const bytes = new Uint8Array(readFileSync(c.path));
      const doc = parseDxf(bytes, { name: c.id });
      if (c.malformed) {
        // must not throw; problems are reported as diagnostics
        expect(doc).toBeTruthy();
        build(doc, doc.modelSpace);
        return;
      }
      // decoding: no replacement characters
      expect(doc.source.encoding.replacements, `${c.id}: U+FFFD (${doc.source.encoding.encoding})`).toBe(0);
      // every tag is kept: two lines per tag (ASCII files ending with EOF)
      if (!doc.source.binary) expect(Math.abs(doc.tags.count * 2 - doc.source.lineCount)).toBeLessThanOrEqual(1);
      expect(doc.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
      // model space and every paper layout build without exceptions
      const b = build(doc, doc.modelSpace);
      const ext = b.scene.extents;
      if (ext.minX <= ext.maxX) for (const v of [ext.minX, ext.minY, ext.maxX, ext.maxY]) expect(Number.isFinite(v)).toBe(true);
      if (doc.paperSpace.length) build(doc, doc.paperSpace);
      for (const blk of doc.blocks.values()) if (!/^\*(model|paper)_space/i.test(blk.name) && blk.entities.length < 5000) build(doc, blk.entities);
      const missing = [...b.scene.coverage.values()].filter((r) => r.method === 'none' && r.count > 0).map((r) => r.type);
      const summary = {
        version: doc.source.version ?? null,
        binary: doc.source.binary,
        encoding: doc.source.encoding.encoding,
        entities: doc.entities.length,
        model: doc.modelSpace.length,
        paper: doc.paperSpace.length,
        layers: doc.layers.size,
        blocks: doc.blocks.size,
        notRendered: missing,
        generator: guessGenerator(doc).guess,
      };
      if (c.generator) expect(summary.generator.join(' ')).toMatch(new RegExp(c.generator, 'i'));
      if (!c.id.startsWith('local/')) expect(summary).toMatchSnapshot();
    });
  }
});
