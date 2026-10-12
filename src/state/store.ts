import { create } from 'zustand';

import type { BuildInfo, DocSummary, FontOverrideInfo, LayerInfo, RenderSettings } from '../shared/docApi';

export type DockSide = 'left' | 'right' | 'bottom';

export interface DockState {
  open: boolean;
  size: number;
  active: string;
}

export interface TabState {
  id: string;
  name: string;
  status: 'loading' | 'ready' | 'error';
  phase: string;
  progress: number;
  error?: string;
  summary?: DocSummary;
  layers: LayerInfo[];
  build?: BuildInfo;
  frameMs?: number;
  /** manual encoding override */
  encoding?: string;
}

export interface ViewerSettings extends RenderSettings {
  /** decimals for coordinate display; -1 = from $LUPREC */
  coordPrecision: number;
  wheelZoomFactor: number;
  preferLocalFonts: boolean;
  /** keyed by lower-case requested font name */
  fontOverrides: Record<string, FontOverrideInfo>;
}

export interface UiState {
  tabs: TabState[];
  activeId: string | null;
  docks: Record<DockSide, DockState>;
  focusMode: boolean;
  cursor: { x: number; y: number } | null;
  /** CSS px per world unit of the active view */
  scale: number;
  settings: ViewerSettings;
  /** bumped whenever user fonts change */
  userFontsVersion: number;
  bumpUserFonts(): void;
  setTab(id: string, patch: Partial<TabState>): void;
  addTab(tab: TabState): void;
  removeTab(id: string): void;
  activate(id: string | null): void;
  moveTab(from: number, to: number): void;
  setDock(side: DockSide, patch: Partial<DockState>): void;
  toggleDock(side: DockSide, panel?: string): void;
  setFocusMode(on: boolean): void;
  setCursor(c: { x: number; y: number } | null): void;
  setScale(s: number): void;
  updateSettings(patch: Partial<ViewerSettings>): void;
}

const STORAGE_KEY = 'dxfv.ui.v1';

interface Persisted {
  docks: Record<DockSide, DockState>;
  settings: ViewerSettings;
}

const DEFAULT_SETTINGS: ViewerSettings = {
  background: 0x16181d,
  lineweights: 'file',
  lineweightScale: 1,
  linetypes: true,
  fills: true,
  texts: true,
  minTextPx: 1.5,
  monochrome: false,
  coordPrecision: -1,
  wheelZoomFactor: 1.2,
  preferLocalFonts: true,
  fontOverrides: {},
};

const DEFAULT_DOCKS: Record<DockSide, DockState> = {
  left: { open: true, size: 280, active: 'layers' },
  right: { open: false, size: 320, active: 'document' },
  bottom: { open: false, size: 240, active: 'texts' },
};

function load(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function save(state: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

const persisted = load();

export const useUi = create<UiState>((set, get) => ({
  tabs: [],
  activeId: null,
  docks: { ...DEFAULT_DOCKS, ...(persisted.docks ?? {}) },
  focusMode: false,
  cursor: null,
  scale: 1,
  settings: { ...DEFAULT_SETTINGS, ...(persisted.settings ?? {}) },
  userFontsVersion: 0,
  bumpUserFonts: () => set((s) => ({ userFontsVersion: s.userFontsVersion + 1 })),
  setTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id })),
  removeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (activeId === id) activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
      return { tabs, activeId };
    }),
  activate: (id) => set({ activeId: id, cursor: null }),
  moveTab: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs];
      const [t] = tabs.splice(from, 1);
      tabs.splice(to, 0, t);
      return { tabs };
    }),
  setDock: (side, patch) => {
    set((s) => ({ docks: { ...s.docks, [side]: { ...s.docks[side], ...patch } } }));
    save({ docks: get().docks, settings: get().settings });
  },
  toggleDock: (side, panel) => {
    const d = get().docks[side];
    if (panel && panel !== d.active) get().setDock(side, { open: true, active: panel });
    else get().setDock(side, { open: !d.open });
  },
  setFocusMode: (on) => set({ focusMode: on }),
  setCursor: (c) => set({ cursor: c }),
  setScale: (scale) => set({ scale }),
  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    save({ docks: get().docks, settings: get().settings });
  },
}));

export function activeTab(s: UiState): TabState | undefined {
  return s.tabs.find((t) => t.id === s.activeId);
}
