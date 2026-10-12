import type { BBox2, ViewState, Viewport } from './view';

export interface OpenParams {
  bytes: ArrayBuffer;
  name: string;
  encoding?: string;
  /** absolute URL of the app base (for fonts/manifest.json) */
  baseUrl: string;
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

/** Methods exposed by the document worker. */
export type DocApi = {
  open(p: OpenParams): Promise<DocSummary>;
  attachCanvas(p: { canvas: OffscreenCanvas }): void;
  resize(p: Viewport): void;
  setView(p: { view: ViewState; viewId: number }): void;
  setRenderSettings(p: RenderSettings): void;
  setLayerState(p: { changes: { index: number; on?: boolean; frozen?: boolean }[] } | { reset: true } | { all: { on?: boolean; frozen?: boolean } }): LayerInfo[];
  getLayers(p: void): LayerInfo[];
  getBuildInfo(p: void): BuildInfo;
};

export type DocEvents = {
  progress: { phase: string; fraction: number };
  frame: FrameInfo;
  build: BuildInfo;
  layers: LayerInfo[];
};
