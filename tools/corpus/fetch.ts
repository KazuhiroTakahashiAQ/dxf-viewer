/**
 * Download the real-world DXF corpus listed in tests/real/corpus.json into
 * tests/real/.cache (git-ignored; the files are not redistributed).
 *
 *   node tools/corpus/fetch.ts            # download missing files, verify SHA-256
 *   node tools/corpus/fetch.ts --update   # also record hashes that are still empty
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

interface Entry {
  id: string;
  url: string;
  sha256: string;
  zipEntry?: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(root, 'tests/real/corpus.json');
const cacheDir = join(root, 'tests/real/.cache');
const update = process.argv.includes('--update');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: Entry[] };
mkdirSync(cacheDir, { recursive: true });

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Minimal ZIP reader (stored / deflated entries via the central directory). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('latin1');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function fetchEntry(e: Entry): Promise<string> {
  const target = join(cacheDir, `${e.id}.dxf`);
  if (existsSync(target) && e.sha256 && sha(readFileSync(target)) === e.sha256) return 'cached';
  const res = await fetch(e.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data: Buffer = Buffer.from(await res.arrayBuffer());
  if (e.zipEntry) {
    const files = unzip(data);
    const pattern = new RegExp(`^${e.zipEntry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
    const name = [...files.keys()].sort().find((n) => pattern.test(n.replace(/^.*\//, '')));
    if (!name) throw new Error(`no entry matching ${e.zipEntry}`);
    data = files.get(name)!;
  }
  const h = sha(data);
  if (e.sha256 && e.sha256 !== h) throw new Error(`SHA-256 mismatch (expected ${e.sha256}, got ${h})`);
  if (!e.sha256) {
    if (!update) throw new Error(`no SHA-256 in the manifest (got ${h}); run with --update after reviewing the source`);
    e.sha256 = h;
  }
  writeFileSync(target, data);
  return 'downloaded';
}

let failed = 0;
const queue = [...manifest.files];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        console.log(`${(await fetchEntry(e)).padEnd(10)} ${e.id}`);
      } catch (err) {
        failed++;
        console.error(`FAILED     ${e.id}: ${(err as Error).message}`);
      }
    }
  }),
);
if (update) writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${manifest.files.length - failed}/${manifest.files.length} files in ${cacheDir}`);
process.exitCode = failed ? 1 : 0;
