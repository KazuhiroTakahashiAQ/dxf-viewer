/**
 * Copies the bundled substitute fonts from @fontsource packages into
 * `public/fonts/<id>/` and writes `public/fonts/manifest.json`.
 *
 * The manifest lists every unicode-range slice with its byte size so the app
 * can (a) register FontFace objects lazily inside the document worker and
 * (b) show download sizes before a bulk pre-download.
 *
 * Usage: node tools/fonts/build-font-manifest.ts [--if-missing]
 */
import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_FONT_FAMILIES } from '../../src/fonts/bundledFamilies.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'public', 'fonts');
const manifestPath = join(outDir, 'manifest.json');

if (process.argv.includes('--if-missing') && existsSync(manifestPath)) {
  process.exit(0);
}

interface FaceFile {
  url: string;
  unicodeRange: string;
  size: number;
}
interface Face {
  weight: number;
  style: 'normal' | 'italic';
  files: FaceFile[];
}
interface FamilyEntry {
  id: string;
  family: string;
  license: string;
  totalSize: number;
  faces: Face[];
}

const fontFaceRe = /@font-face\s*{([^}]*)}/g;

function prop(block: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block);
  return m ? m[1].trim() : undefined;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const families: FamilyEntry[] = [];
for (const def of BUNDLED_FONT_FAMILIES) {
  const pkgDir = join(root, 'node_modules', '@fontsource', def.id);
  if (!existsSync(pkgDir)) {
    console.warn(`[fonts] skip ${def.id}: package not installed`);
    continue;
  }
  const famOut = join(outDir, def.id);
  mkdirSync(famOut, { recursive: true });
  const entry: FamilyEntry = { id: def.id, family: def.cssFamily, license: 'OFL-1.1', totalSize: 0, faces: [] };
  for (const weight of def.weights) {
    for (const style of def.styles) {
      const cssName = style === 'italic' ? `${weight}-italic.css` : `${weight}.css`;
      const cssPath = join(pkgDir, cssName);
      if (!existsSync(cssPath)) continue;
      const css = readFileSync(cssPath, 'utf8');
      const face: Face = { weight, style, files: [] };
      for (const m of css.matchAll(fontFaceRe)) {
        const block = m[1];
        const src = prop(block, 'src') ?? '';
        const woff2 = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(src);
        if (!woff2) continue;
        const fileName = woff2[1];
        const from = join(pkgDir, 'files', fileName);
        copyFileSync(from, join(famOut, fileName));
        const size = statSync(from).size;
        face.files.push({
          url: `${def.id}/${fileName}`,
          unicodeRange: prop(block, 'unicode-range') ?? 'U+0-10FFFF',
          size,
        });
        entry.totalSize += size;
      }
      if (face.files.length) entry.faces.push(face);
    }
  }
  const licenseSrc = join(pkgDir, 'LICENSE');
  if (existsSync(licenseSrc)) copyFileSync(licenseSrc, join(famOut, 'LICENSE.txt'));
  families.push(entry);
}

writeFileSync(manifestPath, JSON.stringify({ version: 1, families }, null, 0));
const total = families.reduce((s, f) => s + f.totalSize, 0);
console.log(
  `[fonts] ${families.length} families, ${(total / 1024 / 1024).toFixed(1)} MiB -> ${manifestPath}`,
);
