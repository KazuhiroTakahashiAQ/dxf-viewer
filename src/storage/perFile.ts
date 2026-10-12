import type { ViewState } from '../shared/view';

/**
 * Small viewer-side data kept per drawing (keyed by the SHA-256 of the file):
 * saved views and saved layer states. Only names and view/layer settings are
 * stored — never drawing content.
 */
export interface SavedView {
  name: string;
  layout: string;
  view: ViewState;
}

export interface SavedLayerState {
  name: string;
  layers: { name: string; on: boolean; frozen: boolean }[];
}

interface PerFile {
  views?: SavedView[];
  layerStates?: SavedLayerState[];
}

const key = (hash: string) => `dxfv.file.${hash}`;

function read(hash: string): PerFile {
  try {
    const raw = localStorage.getItem(key(hash));
    return raw ? (JSON.parse(raw) as PerFile) : {};
  } catch {
    return {};
  }
}

function write(hash: string, data: PerFile): void {
  try {
    if (!data.views?.length && !data.layerStates?.length) localStorage.removeItem(key(hash));
    else localStorage.setItem(key(hash), JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}

export function savedViews(hash: string | undefined): SavedView[] {
  return hash ? (read(hash).views ?? []) : [];
}

export function setSavedViews(hash: string, views: SavedView[]): void {
  write(hash, { ...read(hash), views });
}

export function savedLayerStates(hash: string | undefined): SavedLayerState[] {
  return hash ? (read(hash).layerStates ?? []) : [];
}

export function setSavedLayerStates(hash: string, layerStates: SavedLayerState[]): void {
  write(hash, { ...read(hash), layerStates });
}

/** Remove every per-file entry (used by "clear stored data"). */
export function clearPerFileData(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dxfv.file.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
