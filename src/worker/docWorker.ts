/// <reference lib="webworker" />
import { nameKey, type DxfDocument, type MTextEntity, type TextEntity } from '../dxf/model';
import { headerNumber, parseDxf } from '../dxf/parser';
import { plainText } from '../dxf/text/escapes';
import { mtextPlain } from '../dxf/text/mtext';
import { CanvasMeasurer, FontRegistry } from '../fonts/fontLoader';
import { resolveFont, type FontSpec } from '../fonts/resolve';
import { Renderer, type RenderOptions } from '../render/renderer';
import { SceneBuilder, type Scene } from '../scene/scene';
import type { BuildInfo, DocApi, DocSummary, LayerInfo, RenderSettings } from '../shared/docApi';
import { emit, serve } from '../shared/rpc';
import { DEFAULT_VIEW, type ViewState, type Viewport } from '../shared/view';

declare const self: DedicatedWorkerGlobalScope;

const BUILD_SLICE_MS = 30;
const PROGRESSIVE_RENDER_MS = 350;

let doc: DxfDocument | null = null;
let builder: SceneBuilder | null = null;
let scene: Scene | null = null;
let renderer: Renderer | null = null;
let fonts: FontRegistry | null = null;
const measurer = new CanvasMeasurer();
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let viewport: Viewport = { width: 1, height: 1, dpr: 1 };
let view: ViewState = DEFAULT_VIEW;
let viewId = 0;
let hasView = false;
let generation = 0;
let settings: RenderSettings = {
  background: 0x16181d,
  lineweights: 'file',
  lineweightScale: 1,
  linetypes: true,
  fills: true,
  texts: true,
  minTextPx: 1.5,
  monochrome: false,
};
let layerOn = new Uint8Array(0);
let layerFrozen = new Uint8Array(0);
let renderScheduled = false;
let lastProgressiveRender = 0;

function syncLayerArrays(): void {
  if (!scene) return;
  const n = scene.styles.layers.length;
  if (layerOn.length === n) return;
  const on = new Uint8Array(n);
  const fr = new Uint8Array(n);
  on.set(layerOn.subarray(0, Math.min(n, layerOn.length)));
  fr.set(layerFrozen.subarray(0, Math.min(n, layerFrozen.length)));
  for (let i = layerOn.length; i < n; i++) {
    on[i] = scene.styles.layers[i].fileOn ? 1 : 0;
    fr[i] = scene.styles.layers[i].fileFrozen ? 1 : 0;
  }
  layerOn = on;
  layerFrozen = fr;
}

function layerInfos(): LayerInfo[] {
  if (!scene) return [];
  syncLayerArrays();
  return scene.styles.layers.map((l, index) => ({
    index,
    name: l.name,
    rgb: l.rgb,
    fg: l.fg,
    aci: l.aci,
    trueColor: l.trueColor,
    linetype: l.linetype,
    lineweight: l.lineweight,
    on: layerOn[index] === 1,
    frozen: layerFrozen[index] === 1,
    fileOn: l.fileOn,
    fileFrozen: l.fileFrozen,
    locked: l.locked,
    plot: l.plot,
    count: l.count,
    undefinedInFile: l.undefinedInFile,
  }));
}

function buildInfo(): BuildInfo {
  return {
    done: builder?.done ?? false,
    progress: builder?.progress ?? 0,
    primitives: scene?.primitives ?? 0,
    budgetExceeded: scene?.budgetExceeded ?? 0,
    coverage: scene ? [...scene.coverage.values()].sort((a, b) => b.count - a.count) : [],
    diagnostics: (builder?.diagnostics ?? []).map((d) => ({ level: 'warning' as const, ...d })),
  };
}

function renderNow(): void {
  renderScheduled = false;
  if (!ctx || !canvas || !renderer || !scene || !doc || !hasView) return;
  syncLayerArrays();
  const opts: RenderOptions = {
    ...settings,
    layerOn,
    layerFrozen,
    pdmode: headerNumber(doc, '$PDMODE', 0),
    pdsize: headerNumber(doc, '$PDSIZE', 0),
    lwdisplay: headerNumber(doc, '$LWDISPLAY', 0) !== 0,
  };
  const stats = renderer.render(ctx, view, viewport, opts);
  emit(self, 'frame', { viewId, ms: stats.ms, tiles: stats.tiles, batches: stats.batches, texts: stats.texts });
}

function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(renderNow, 0);
}

function collectFonts(d: DxfDocument): { specs: FontSpec[]; text: string } {
  const specs = new Map<string, FontSpec>();
  const parts: string[] = [];
  const add = (spec: FontSpec) => specs.set(`${spec.family}|${spec.bold}|${spec.italic}`, spec);
  for (const st of d.styles.values()) add(resolveFont(st));
  add(resolveFont(undefined));
  const fontRe = /\\[fF]([^|;\\]*)((?:\|[^|;]*)*);/g;
  for (const e of d.entities) {
    if (e.type === 'TEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF') {
      const t = e as TextEntity;
      parts.push(t.mtext ? mtextPlain(t.mtext.text) : plainText(t.text), t.tag ?? '');
    } else if (e.type === 'MTEXT') {
      const m = e as MTextEntity;
      parts.push(mtextPlain(m.text));
      const style = d.styles.get(nameKey(m.style));
      for (const fm of m.text.matchAll(fontRe)) {
        add(resolveFont(style, { font: fm[1], bold: /\|b1/i.test(fm[2]), italic: /\|i1/i.test(fm[2]) }));
      }
    }
  }
  // digits/symbols commonly produced by dimensions
  parts.push('0123456789.,-+±°Ø%()');
  return { specs: [...specs.values()], text: parts.join('') };
}

function continueBuild(gen: number): void {
  if (gen !== generation || !builder) return;
  const start = performance.now();
  const done = builder.step(start + BUILD_SLICE_MS, () => performance.now());
  emit(self, 'progress', { phase: done ? 'ready' : 'building', fraction: 0.6 + 0.4 * builder.progress });
  if (done) {
    emit(self, 'build', buildInfo());
    emit(self, 'layers', layerInfos());
    scheduleRender();
    return;
  }
  if (start - lastProgressiveRender > PROGRESSIVE_RENDER_MS) {
    lastProgressiveRender = start;
    renderNow();
  }
  setTimeout(() => continueBuild(gen), 0);
}

function summarize(d: DxfDocument, s: Scene, parseMs: number): DocSummary {
  const ext = s.extents;
  const vport = d.tableRecords.find((r) => r.table === 'VPORT' && /^\*active$/i.test(r.name));
  return {
    name: d.source.name,
    size: d.source.size,
    binary: d.source.binary,
    version: d.source.version,
    release: d.source.release,
    encoding: d.source.encoding.encoding,
    encodingReason: d.source.encoding.reason,
    codepage: d.source.encoding.codepage,
    replacements: d.source.encoding.replacements,
    encodingOverridden: d.source.encoding.overridden,
    lineCount: d.source.lineCount,
    tagCount: d.tags.count,
    entityCount: d.entities.length,
    modelSpaceCount: d.modelSpace.length,
    paperSpaceCount: d.paperSpace.length,
    blockCount: d.blocks.size,
    layerCount: d.layers.size,
    layoutNames: d.layouts.map((l) => l.name),
    extents: ext.minX <= ext.maxX ? { minX: ext.minX, minY: ext.minY, maxX: ext.maxX, maxY: ext.maxY } : null,
    insUnits: headerNumber(d, '$INSUNITS', 0),
    lunits: headerNumber(d, '$LUNITS', 2),
    luprec: headerNumber(d, '$LUPREC', 4),
    initialView: vport
      ? {
          cx: (vport.center as number[])[0],
          cy: (vport.center as number[])[1],
          height: Number(vport.height) || 0,
          twist: Number(vport.twist) || 0,
        }
      : undefined,
    parseMs,
    diagnostics: d.diagnostics.slice(0, 2000),
  };
}

const api: DocApi = {
  async open(p) {
    const gen = ++generation;
    const t0 = performance.now();
    const d = parseDxf(new Uint8Array(p.bytes), {
      name: p.name,
      encoding: p.encoding,
      onProgress: (phase, fraction) => emit(self, 'progress', { phase, fraction: fraction * 0.5 }),
    });
    const parseMs = performance.now() - t0;
    emit(self, 'progress', { phase: 'fonts', fraction: 0.5 });
    if (!fonts) {
      fonts = new FontRegistry(self.fonts, p.baseUrl);
      await fonts.init();
    }
    const { specs, text } = collectFonts(d);
    await fonts.ensure(specs, text);
    if (gen !== generation) throw new Error('superseded');

    doc = d;
    builder = new SceneBuilder(d, d.modelSpace, measurer, () => new Path2D());
    scene = builder.scene;
    renderer = new Renderer(scene);
    layerOn = new Uint8Array(0);
    layerFrozen = new Uint8Array(0);
    emit(self, 'progress', { phase: 'layout', fraction: 0.55 });
    builder.prepare();
    syncLayerArrays();
    lastProgressiveRender = performance.now();
    setTimeout(() => continueBuild(gen), 0);
    return summarize(d, scene, parseMs);
  },

  attachCanvas(p) {
    canvas = p.canvas;
    ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
    canvas.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
    canvas.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
    scheduleRender();
  },

  resize(p) {
    viewport = p;
    if (canvas) {
      canvas.width = Math.max(1, Math.round(p.width * p.dpr));
      canvas.height = Math.max(1, Math.round(p.height * p.dpr));
    }
    renderNow();
  },

  setView(p) {
    view = p.view;
    viewId = p.viewId;
    hasView = true;
    scheduleRender();
  },

  setRenderSettings(p) {
    settings = p;
    scheduleRender();
  },

  setLayerState(p) {
    syncLayerArrays();
    if ('reset' in p) {
      scene?.styles.layers.forEach((l, i) => {
        layerOn[i] = l.fileOn ? 1 : 0;
        layerFrozen[i] = l.fileFrozen ? 1 : 0;
      });
    } else if ('all' in p) {
      for (let i = 0; i < layerOn.length; i++) {
        if (p.all.on !== undefined) layerOn[i] = p.all.on ? 1 : 0;
        if (p.all.frozen !== undefined) layerFrozen[i] = p.all.frozen ? 1 : 0;
      }
    } else {
      for (const c of p.changes) {
        if (c.index < 0 || c.index >= layerOn.length) continue;
        if (c.on !== undefined) layerOn[c.index] = c.on ? 1 : 0;
        if (c.frozen !== undefined) layerFrozen[c.index] = c.frozen ? 1 : 0;
      }
    }
    scheduleRender();
    return layerInfos();
  },

  getLayers() {
    return layerInfos();
  },

  getBuildInfo() {
    return buildInfo();
  },
};

serve(self, api);
