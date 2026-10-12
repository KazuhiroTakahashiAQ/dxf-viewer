/**
 * Extract the Hershey stroke fonts used as SHX substitutes from `hersheytext`
 * (MIT) into src/fonts/hershey/hershey-subset.json.
 * Glyph `d` strings are kept as-is; index i is character code 33 + i.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const all = JSON.parse(readFileSync(join(root, 'node_modules/hersheytext/hersheytext.json'), 'utf8')) as Record<string, { name: string; chars: { d: string; o: number }[] }>;
const ids = ['futural', 'futuram', 'timesr', 'timesrb', 'timesi', 'scripts', 'scriptc', 'gothiceng', 'gothicger', 'gothicita', 'greek', 'cyrillic'];
const out: Record<string, { name: string; chars: [string, number][] }> = {};
for (const id of ids) {
  out[id] = { name: all[id].name, chars: all[id].chars.map((c) => [c.d, Number(c.o)]) };
}
writeFileSync(join(root, 'src/fonts/hershey/hershey-subset.json'), JSON.stringify(out));
console.log(`[hershey] ${ids.length} fonts`);
