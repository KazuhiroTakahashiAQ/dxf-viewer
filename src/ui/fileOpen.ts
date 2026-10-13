import { openFiles, openHandles, openSources } from '../session/DocumentSession';
import { loadRecent, type RecentEntry } from '../storage/recentFiles';

interface PickerWindow {
  showOpenFilePicker?(o: { multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle[]>;
}

/**
 * Let the user choose drawings. Uses the File System Access picker where
 * available (its handles allow reopening from "recent files"), otherwise the
 * given <input type=file>.
 */
export async function chooseFiles(fallback: HTMLInputElement | null): Promise<void> {
  const w = window as unknown as PickerWindow;
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const handles = await w.showOpenFilePicker({ multiple: true, types: [{ description: 'DXF / DWG drawing', accept: { 'image/vnd.dxf': ['.dxf', '.DXF'], 'image/vnd.dwg': ['.dwg', '.DWG'] } }] });
      await openHandles(handles);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') fallback?.click();
    }
    return;
  }
  fallback?.click();
}

/** Reopen a recent entry; returns false when the user has to choose the file again. */
export async function reopenRecent(e: RecentEntry): Promise<boolean> {
  const data = await loadRecent(e);
  if (!data) return false;
  await openSources([{ name: data.name, bytes: data.bytes, lastModified: data.lastModified, handle: e.handle }]);
  return true;
}

/** Handles of dropped files (Chromium); must be called synchronously in the drop handler. */
export function droppedHandles(dt: DataTransfer): Promise<(FileSystemHandle | null)[]> {
  const items = Array.from(dt.items ?? []);
  return Promise.all(
    items.map((it) => {
      const f = it as DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
      return it.kind === 'file' && typeof f.getAsFileSystemHandle === 'function' ? f.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null);
    }),
  );
}

export { openFiles };
