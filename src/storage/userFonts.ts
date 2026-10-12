import { createStore, del, entries, set, type UseStore } from 'idb-keyval';

/**
 * Fonts supplied by the user (TTF/OTF/TTC/WOFF and SHX), kept in IndexedDB so
 * they are available in later sessions. Shared by the UI and document workers.
 */
export interface StoredFont {
  /** original file name */
  name: string;
  kind: 'ttf' | 'shx';
  size: number;
  added: number;
  bytes: ArrayBuffer;
}

export type StoredFontInfo = Omit<StoredFont, 'bytes'>;

let store: UseStore | null = null;
function db(): UseStore {
  store ??= createStore('dxfv-user-fonts', 'fonts');
  return store;
}

export function fontKind(fileName: string): 'ttf' | 'shx' | null {
  if (/\.shx$/i.test(fileName)) return 'shx';
  if (/\.(ttf|ttc|otf|woff2?)$/i.test(fileName)) return 'ttf';
  return null;
}

/** Lower-case base name used to match fonts referenced by drawings. */
export function fontKey(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.(shx|ttf|ttc|otf|woff2?)$/i, '').trim().toLowerCase();
}

export async function getAllUserFonts(): Promise<StoredFont[]> {
  try {
    return (await entries<string, StoredFont>(db())).map(([, v]) => v);
  } catch {
    return [];
  }
}

export async function listUserFonts(): Promise<StoredFontInfo[]> {
  return (await getAllUserFonts()).map(({ bytes: _bytes, ...info }) => info).sort((a, b) => a.name.localeCompare(b.name));
}

export async function addUserFont(file: File): Promise<StoredFontInfo> {
  const kind = fontKind(file.name);
  if (!kind) throw new Error(`Unsupported font file: ${file.name}`);
  const bytes = await file.arrayBuffer();
  const entry: StoredFont = { name: file.name, kind, size: bytes.byteLength, added: Date.now(), bytes };
  await set(fontKey(file.name), entry, db());
  return { name: entry.name, kind, size: entry.size, added: entry.added };
}

export async function removeUserFont(name: string): Promise<void> {
  await del(fontKey(name), db());
}
