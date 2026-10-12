import { clear, createStore, del, entries, get, set, type UseStore } from 'idb-keyval';

/**
 * Recently opened drawings.
 * - 'meta' (default): only name, size, dates and the content hash are recorded;
 *   on Chromium the File System Access handle is kept too (a reference, not the content).
 * - 'content': the drawing bytes are also stored in this browser (opt-in).
 * - 'off': nothing is recorded.
 */
export type RecentMode = 'off' | 'meta' | 'content';

export interface RecentEntry {
  hash: string;
  name: string;
  size: number;
  lastModified?: number;
  openedAt: number;
  /** content stored in IndexedDB */
  stored: boolean;
  handle?: FileSystemFileHandle;
}

export const MAX_RECENT = 30;
export const MAX_STORED_BYTES = 300 * 1024 * 1024;

let metaStore: UseStore | null = null;
let contentStore: UseStore | null = null;
const meta = () => (metaStore ??= createStore('dxfv-recent', 'meta'));
const content = () => (contentStore ??= createStore('dxfv-recent-content', 'files'));

export async function listRecent(): Promise<RecentEntry[]> {
  try {
    const all = (await entries<string, RecentEntry>(meta())).map(([, v]) => v);
    return all.sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

/** Record an opened file according to the mode; prunes to the limits (oldest first). */
export async function recordOpen(mode: RecentMode, info: { hash: string; name: string; size: number; lastModified?: number; handle?: FileSystemFileHandle; bytes?: ArrayBuffer }): Promise<void> {
  if (mode === 'off' || !info.hash) return;
  try {
    const prev = await get<RecentEntry>(info.hash, meta());
    const store = mode === 'content' && !!info.bytes && info.bytes.byteLength <= MAX_STORED_BYTES;
    if (store) await set(info.hash, info.bytes, content());
    const entry: RecentEntry = {
      hash: info.hash,
      name: info.name,
      size: info.size,
      lastModified: info.lastModified ?? prev?.lastModified,
      openedAt: Date.now(),
      stored: store || (!!prev?.stored && mode === 'content'),
      handle: info.handle ?? prev?.handle,
    };
    await set(info.hash, entry, meta());
    await prune();
  } catch {
    /* storage unavailable (private mode, quota) */
  }
}

async function prune(): Promise<void> {
  const list = await listRecent();
  let bytes = 0;
  for (const [i, e] of list.entries()) {
    if (i >= MAX_RECENT) {
      await removeRecent(e.hash);
      continue;
    }
    if (e.stored) {
      bytes += e.size;
      if (bytes > MAX_STORED_BYTES) {
        await del(e.hash, content());
        await set(e.hash, { ...e, stored: false }, meta());
      }
    }
  }
}

export async function removeRecent(hash: string): Promise<void> {
  try {
    await del(hash, meta());
    await del(hash, content());
  } catch {
    /* ignore */
  }
}

/** Forget every recent entry and stored drawing. */
export async function clearRecent(): Promise<void> {
  try {
    await clear(meta());
    await clear(content());
  } catch {
    /* ignore */
  }
}

/** Remove stored drawings but keep the names (switching back to the default mode). */
export async function dropStoredContent(): Promise<void> {
  try {
    await clear(content());
    for (const e of await listRecent()) if (e.stored) await set(e.hash, { ...e, stored: false }, meta());
  } catch {
    /* ignore */
  }
}

/**
 * Bytes of a recent entry: stored content, or the file behind the saved handle
 * (asks for read permission). Returns null when the user has to pick the file again.
 */
export async function loadRecent(e: RecentEntry): Promise<{ bytes: ArrayBuffer; name: string; lastModified?: number } | null> {
  if (e.stored) {
    try {
      const bytes = await get<ArrayBuffer>(e.hash, content());
      if (bytes) return { bytes, name: e.name };
    } catch {
      /* fall through */
    }
  }
  if (e.handle) {
    try {
      const h = e.handle as FileSystemFileHandle & {
        queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
        requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
      };
      let p = (await h.queryPermission?.({ mode: 'read' })) ?? 'granted';
      if (p !== 'granted') p = (await h.requestPermission?.({ mode: 'read' })) ?? 'denied';
      if (p === 'granted') {
        const file = await h.getFile();
        return { bytes: await file.arrayBuffer(), name: file.name, lastModified: file.lastModified };
      }
    } catch {
      /* moved / deleted / denied */
    }
  }
  return null;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
