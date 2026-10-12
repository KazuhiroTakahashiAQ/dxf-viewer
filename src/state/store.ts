import { create } from 'zustand';

import type { BuildInfo, DocSummary, EntityMeasure, FilterResult, FontOverrideInfo, LayerInfo, LayoutInfo, RenderSettings, SnapKind } from '../shared/docApi';
import type { MeasureMode } from '../ui/measure';
import type { RecentMode } from '../storage/recentFiles';
import type { FilterSpec } from '../shared/filterSpec';
import type { LocalePref } from '../i18n';

export type DockSide = 'left' | 'right' | 'bottom';

export interface DockState {
  open: boolean;
  size: number;
  active: string;
}

export interface TabState {
  id: string;
  name: string;
  /** SHA-256 of the file content */
  hash?: string;
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
  layouts?: LayoutInfo[];
  layout?: string;
  /** selected entity ids */
  selection?: number[];
  hiddenCount?: number;
  isolatedCount?: number;
  /** filter being edited / applied */
  filter?: FilterSpec;
  filterApplied?: FilterSpec | null;
  filterResult?: FilterResult | null;
  /** view history availability */
  viewNav?: { back: boolean; forward: boolean };
  /** name of the last applied layer state (file or saved) */
  layerState?: string;
  /** view rotation (radians) and mirroring, mirrored for the toolbar */
  viewOrient?: { rotation: number; mirrorX: boolean; mirrorY: boolean };
}

export interface ViewerSettings extends RenderSettings {
  /** decimals for coordinate display; -1 = from $LUPREC */
  coordPrecision: number;
  wheelZoomFactor: number;
  /** two-finger trackpad scroll pans instead of zooming */
  trackpadPan: boolean;
  preferLocalFonts: boolean;
  /** keyed by lower-case requested font name */
  fontOverrides: Record<string, FontOverrideInfo>;
  /** UI color scheme */
  theme: 'system' | 'light' | 'dark';
  /** UI language ('auto' follows the browser) */
  locale: LocalePref;
  /** what "recent files" records: nothing, names only (default), or the drawings too */
  recentMode: RecentMode;
  /** reopen the previous tabs at startup (requires stored drawings) */
  restoreTabs: boolean;
  snap: boolean;
  snapKinds: SnapKind[];
  showGrid: boolean;
  showAxes: boolean;
  showScaleBar: boolean;
}

/** Measurement in progress or just finished (world coordinates). */
export interface MeasureState {
  tabId: string;
  layout: string;
  mode: MeasureMode;
  points: number[];
  done: boolean;
  entity?: EntityMeasure;
}

export interface MeasureRecord {
  mode: MeasureMode;
  file: string;
  points: number[];
  text: string;
}

export type Tool = 'select' | 'pan' | 'measure';

export interface UiState {
  tool: Tool;
  setTool(t: Tool): void;
  tabs: TabState[];
  activeId: string | null;
  docks: Record<DockSide, DockState>;
  focusMode: boolean;
  cursor: { x: number; y: number } | null;
  /** last clicked / measured world point (status bar shows the offset to it) */
  lastPoint: [number, number] | null;
  setLastPoint(p: [number, number] | null): void;
  /** CSS px per world unit of the active view */
  scale: number;
  settings: ViewerSettings;
  measureMode: MeasureMode;
  setMeasureMode(m: MeasureMode): void;
  measure: MeasureState | null;
  setMeasure(m: MeasureState | null): void;
  measureHistory: MeasureRecord[];
  addMeasureRecord(r: MeasureRecord): void;
  clearMeasureHistory(): void;
  /** drawing a spatial filter region on the canvas */
  regionPick: 'rect' | 'polygon' | null;
  setRegionPick(k: 'rect' | 'polygon' | null): void;
  /** filter received through a shared link (not applied until confirmed) */
  pendingFilter: FilterSpec | null;
  setPendingFilter(f: FilterSpec | null): void;
  /** offline font download dialog */
  fontDialog: boolean;
  setFontDialog(open: boolean): void;
  /** help dialog */
  helpOpen: boolean;
  setHelpOpen(open: boolean): void;
  /** request for the Raw panel to scroll to a line */
  rawJump: { line: number; seq: number } | null;
  setRawJump(j: { line: number; seq: number } | null): void;
  /** handle requested for inspection in the Document panel */
  inspectHandle: string | null;
  setInspectHandle(h: string | null): void;
  /** bumped when raster images are attached */
  imagesVersion: number;
  bumpImages(): void;
  /** bumped whenever the recent-files list changes */
  recentVersion: number;
  bumpRecent(): void;
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
  xray: false,
  ghostOff: false,
  showBBoxes: false,
  showInsertionPoints: false,
  showControlPoints: false,
  theme: 'system',
  locale: 'auto',
  coordPrecision: -1,
  wheelZoomFactor: 1.2,
  trackpadPan: true,
  preferLocalFonts: true,
  fontOverrides: {},
  recentMode: 'meta',
  restoreTabs: false,
  snap: true,
  snapKinds: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'insertion', 'node', 'nearest'],
  showGrid: false,
  showAxes: false,
  showScaleBar: true,
};

const DEFAULT_DOCKS: Record<DockSide, DockState> = {
  left: { open: true, size: 280, active: 'layers' },
  right: { open: true, size: 340, active: 'properties' },
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
  tool: 'select',
  setTool: (tool) => set((s) => ({ tool, measure: tool === 'measure' ? s.measure : null })),
  tabs: [],
  activeId: null,
  docks: { ...DEFAULT_DOCKS, ...(persisted.docks ?? {}) },
  focusMode: false,
  cursor: null,
  lastPoint: null,
  setLastPoint: (p) => set({ lastPoint: p }),
  scale: 1,
  settings: { ...DEFAULT_SETTINGS, ...(persisted.settings ?? {}) },
  measureMode: 'distance',
  setMeasureMode: (m) => set({ measureMode: m, measure: null }),
  measure: null,
  setMeasure: (m) => set({ measure: m }),
  measureHistory: [],
  addMeasureRecord: (r) => set((s) => ({ measureHistory: [r, ...s.measureHistory].slice(0, 50) })),
  clearMeasureHistory: () => set({ measureHistory: [] }),
  regionPick: null,
  setRegionPick: (k) => set({ regionPick: k }),
  pendingFilter: null,
  setPendingFilter: (f) => set({ pendingFilter: f }),
  fontDialog: false,
  setFontDialog: (open) => set({ fontDialog: open }),
  helpOpen: false,
  setHelpOpen: (open) => set({ helpOpen: open }),
  rawJump: null,
  setRawJump: (j) => set({ rawJump: j }),
  inspectHandle: null,
  setInspectHandle: (h) => set({ inspectHandle: h }),
  imagesVersion: 0,
  bumpImages: () => set((s) => ({ imagesVersion: s.imagesVersion + 1 })),
  recentVersion: 0,
  bumpRecent: () => set((s) => ({ recentVersion: s.recentVersion + 1 })),
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
  activate: (id) => set({ activeId: id, cursor: null, regionPick: null, measure: null, lastPoint: null }),
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
