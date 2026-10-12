import type { BBox2, ViewState, Viewport } from './view';
import type { CatalogProp, FacetKey, FilterSpec } from './filterSpec';

export interface OpenParams {
  bytes: ArrayBuffer;
  name: string;
  encoding?: string;
  /** absolute URL of the app base (for fonts/manifest.json) */
  baseUrl: string;
  fontOptions?: FontOptions;
}

export interface DiagnosticInfo {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  line?: number;
  handle?: string;
}

export interface CoverageInfo {
  type: string;
  count: number;
  rendered: number;
  method: string;
}

export interface DocSummary {
  name: string;
  size: number;
  binary: boolean;
  version?: string;
  release?: string;
  encoding: string;
  encodingReason: string;
  codepage?: string;
  replacements: number;
  encodingOverridden: boolean;
  lineCount: number;
  tagCount: number;
  entityCount: number;
  modelSpaceCount: number;
  paperSpaceCount: number;
  blockCount: number;
  layerCount: number;
  layoutNames: string[];
  extents: BBox2 | null;
  /** $INSUNITS */
  insUnits: number;
  /** $LUNITS / $LUPREC */
  lunits: number;
  luprec: number;
  /** initial view from VPORT *Active (if any) */
  initialView?: { cx: number; cy: number; height: number; twist: number };
  parseMs: number;
  diagnostics: DiagnosticInfo[];
}

export interface LayerInfo {
  index: number;
  name: string;
  rgb: number;
  fg: boolean;
  aci: number;
  trueColor?: number;
  linetype: string;
  lineweight: number;
  on: boolean;
  frozen: boolean;
  fileOn: boolean;
  fileFrozen: boolean;
  locked: boolean;
  plot: boolean;
  count: number;
  undefinedInFile: boolean;
}

export interface RenderSettings {
  background: number;
  lineweights: 'file' | 'on' | 'off';
  lineweightScale: number;
  linetypes: boolean;
  fills: boolean;
  texts: boolean;
  minTextPx: number;
  monochrome: boolean;
}

export interface BuildInfo {
  done: boolean;
  progress: number;
  primitives: number;
  budgetExceeded: number;
  coverage: CoverageInfo[];
  diagnostics: DiagnosticInfo[];
}

export interface FrameInfo {
  viewId: number;
  ms: number;
  tiles: number;
  batches: number;
  texts: number;
}

export interface TextQuery {
  text: string;
  regex: boolean;
  caseSensitive: boolean;
  field: 'plain' | 'raw';
  /** 'all' | 'Model' | 'Paper' | 'blocks' */
  container?: string;
  offset: number;
  limit: number;
}

export interface TextRow {
  id: number;
  handle: string;
  type: string;
  layer: string;
  style: string;
  height: number;
  raw: string;
  plain: string;
  container: string;
  tag?: string;
}

export interface FontOverrideInfo {
  target: string;
  widthScale: number;
  heightScale: number;
}

export interface FontUsage {
  /** font name as written in the drawing (key for overrides) */
  requested: string;
  kind: 'shx' | 'ttf';
  bigFont?: string;
  styles: string[];
  textCount: number;
  substitute: string;
  stroke?: string;
  /** null when not applicable (SHX) */
  localAvailable: boolean | null;
  localName?: string;
  override?: FontOverrideInfo;
}

export interface FontOptions {
  preferLocal: boolean;
  overrides: Record<string, FontOverrideInfo>;
}

export interface PropRow {
  group: string;
  key: string;
  label: string;
  value: string | number | boolean | null;
  kind?: 'handle' | 'color' | 'layer' | 'block' | 'text';
  /** css color swatch */
  color?: string;
  link?: { entity?: number; handle?: string };
}

export interface EntityInfo {
  id: number;
  handle: string;
  type: string;
  layer: string;
  rows: PropRow[];
  xdata: { app: string; tags: { code: number; value: string }[] }[];
  tagCount: number;
  line?: number;
}

export interface RawTagRow {
  index: number;
  line: number;
  code: number;
  value: string;
  desc: string;
}

export interface HoverInfo {
  id: number;
  handle: string;
  type: string;
  layer: string;
}

export interface SelectionSummary {
  count: number;
  byType: [string, number][];
  byLayer: [string, number][];
}

export interface BlockInfo {
  name: string;
  handle?: string;
  flags: number;
  anonymous: boolean;
  xref: boolean;
  xrefPath?: string;
  /** source block name of a dynamic block representation */
  dynamicSource?: string;
  base: [number, number, number];
  entityCount: number;
  /** INSERT/DIMENSION/TABLE references anywhere in the drawing */
  refCount: number;
  /** references directly in model/paper space */
  topRefCount: number;
  description?: string;
  attdefs: string[];
}

export interface TreeNode {
  key: string;
  label: string;
  count?: number;
  id?: number;
  type?: string;
  hasChildren: boolean;
}

export interface FilterCatalog {
  props: CatalogProp[];
  gcCodes: number[];
  xdataApps: string[];
  attrTags: string[];
  fields: string[];
}

export interface FilterResult {
  count: number;
  /** matching leaves (leaf level) */
  leafCount?: number;
  truncated?: boolean;
  ids?: number[];
  /** regular expressions that were not evaluated (invalid / risky) */
  rejected?: { pattern: string; reason: 'invalid' | 'risky' }[];
}

export interface ResultRow {
  id: number;
  handle: string;
  type: string;
  layer: string;
  label: string;
}

export interface SearchHit {
  id: number;
  handle: string;
  type: string;
  layer: string;
  field: string;
  text: string;
}

export interface LayoutInfo {
  name: string;
  kind: 'model' | 'paper';
  count: number;
}

/** Methods exposed by the document worker. */
export type DocApi = {
  open(p: OpenParams): Promise<DocSummary>;
  attachCanvas(p: { canvas: OffscreenCanvas; highlight?: OffscreenCanvas }): void;
  resize(p: Viewport): void;
  setView(p: { view: ViewState; viewId: number }): void;
  setRenderSettings(p: RenderSettings): void;
  setLayerState(p: { changes: { index: number; on?: boolean; frozen?: boolean }[] } | { reset: true } | { all: { on?: boolean; frozen?: boolean } }): LayerInfo[];
  getLayers(p: void): LayerInfo[];
  getBuildInfo(p: void): BuildInfo;
  queryTexts(p: TextQuery): { total: number; rows: TextRow[]; error?: string };
  entityBounds(p: { ids: number[] }): BBox2 | null;
  getFonts(p: void): FontUsage[];
  getLayouts(p: void): LayoutInfo[];
  hover(p: { x: number; y: number } | null): HoverInfo | null;
  pick(p: { x: number; y: number; tolerance?: number }): number[];
  selectRect(p: { x0: number; y0: number; x1: number; y1: number; crossing: boolean }): number[];
  setSelection(p: { ids: number[] }): void;
  entityInfo(p: { id: number }): EntityInfo | null;
  rawTags(p: { id: number; offset: number; limit: number }): { total: number; rows: RawTagRow[] };
  findHandle(p: { handle: string }): { kind: string; id: number } | null;
  selectSimilar(p: { id: number; by: 'type' | 'layer' | 'block' | 'color' }): number[];
  selectionSummary(p: { ids: number[] }): SelectionSummary;
  selectAll(p: void): number[];
  setVisibility(p: { mode: 'hide' | 'isolate' | 'show'; ids?: number[] }): { hidden: number; isolated: number };
  hoverInfo(p: { id: number }): HoverInfo | null;
  describeIds(p: { ids: number[] }): HoverInfo[];
  getBlocks(p: void): BlockInfo[];
  blockRefs(p: { name: string; nested: boolean }): number[];
  blockPreview(p: { name: string; size: number; background: number }): ImageBitmap | null;
  treeChildren(p: { key: string; offset: number; limit: number }): { total: number; nodes: TreeNode[] };
  filterCatalog(p: void): FilterCatalog;
  filterFacets(p: { level: 'top' | 'leaf' }): Partial<Record<FacetKey, [string, number][]>>;
  filterValues(p: { prop: string; level: 'top' | 'leaf'; limit: number }): [string, number][];
  applyFilter(p: { spec: FilterSpec | null }): FilterResult;
  filterResults(p: { offset: number; limit: number }): { total: number; rows: ResultRow[] };
  search(p: { query: string; regex: boolean; caseSensitive: boolean; limit: number }): { total: number; hits: SearchHit[]; error?: string };
  setLayout(p: { name: string }): { extents: BBox2 | null; kind: 'model' | 'paper' } | null;
  setFontOptions(p: FontOptions): Promise<void>;
  /** re-read user fonts from IndexedDB; returns load errors */
  reloadUserFonts(p: void): Promise<string[]>;
};

export type DocEvents = {
  progress: { phase: string; fraction: number };
  frame: FrameInfo;
  build: BuildInfo;
  layers: LayerInfo[];
};
