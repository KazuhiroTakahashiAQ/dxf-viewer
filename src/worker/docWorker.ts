/// <reference lib="webworker" />
import { nameKey, type DxfDocument, type MTextEntity, type TextEntity } from '../dxf/model';
import { headerNumber, parseDxf } from '../dxf/parser';
import { plainText } from '../dxf/text/escapes';
import { mtextPlain } from '../dxf/text/mtext';
import { CanvasMeasurer, FontRegistry } from '../fonts/fontLoader';
import { configureFonts, fontConfig, resolveFont, type FontSpec, type UserFontInfo } from '../fonts/resolve';
import { makeShxProvider } from '../fonts/shxProvider';
import { registerStrokeFont, unregisterStrokeFonts } from '../fonts/strokeFont';
import { fontKey, getAllUserFonts } from '../storage/userFonts';
import { Renderer, setPathFactory, type RenderOptions } from '../render/renderer';
import { SvgContext, SvgPath } from '../render/svgContext';
import { SceneBuilder, type Scene } from '../scene/scene';
import { StyleResolver, TOP_CTX, type LayerOverride } from '../scene/style';
import { LS_FROZEN, LS_OFF, LSR_COLOR, LSR_FROZEN, LSR_LINETYPE, LSR_LINEWEIGHT, LSR_ON, LSR_TRANSPARENCY, readLayerStates } from '../dxf/layerStates';
import { transparencyToAlpha } from '../dxf/colors';
import type { BuildInfo, DocApi, DocSummary, EntityMeasure, FontUsage, LayerInfo, LayoutInfo, RenderSettings } from '../shared/docApi';
import { TextIndex } from './textIndex';
import { entityInfo, rawTags } from './inspect';
import { Picker } from './picking';
import { snapAt } from './snap';
import { guessGenerator, headerVars, inspectHandle, objectChildren, rawRows, rawSearch, tableGroups, tagAtLine, tagOwner, typeStats } from './docInfo';
import { blockInfos, makeContains, referencedBlock, treeChildren } from './blocks';
import { FilterEngine, type CompiledFilter } from './filtering';
import { regexIssues } from '../shared/filterSpec';
import { fitView } from '../shared/view';
import { emit, serve } from '../shared/rpc';
import { DEFAULT_VIEW, worldToScreen, type BBox2, type ViewState, type Viewport } from '../shared/view';

declare const self: DedicatedWorkerGlobalScope;

const BUILD_SLICE_MS = 30;
const PROGRESSIVE_RENDER_MS = 350;

interface LayoutState {
  name: string;
  kind: 'model' | 'paper';
  items: number[];
  builder: SceneBuilder;
  scene: Scene;
  renderer: Renderer;
  gen: number;
  /** paper sheet rectangle (paper layouts) */
  sheet?: BBox2;
  picker?: Picker;
}

let doc: DxfDocument | null = null;
let styles: StyleResolver | null = null;
const layouts = new Map<string, LayoutState>();
let active = 'Model';
/** active layout's builder/scene (convenience) */
let builder: SceneBuilder | null = null;
let scene: Scene | null = null;
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
let textIndex: TextIndex | null = null;
let hlCanvas: OffscreenCanvas | null = null;
let hlCtx: OffscreenCanvasRenderingContext2D | null = null;
let selection: number[] = [];
let hoverId: number | null = null;
let hidden = new Set<number>();
let isolated: Set<number> | null = null;
let filterEngine: FilterEngine | null = null;
let activeFilter: CompiledFilter | null = null;
/** layer property replacements from an applied layer state */
let layerOverrides = new Map<string, LayerOverride>();
let fileHash = '';

function engine(): FilterEngine {
  filterEngine ??= new FilterEngine(doc!, styles!, measurer);
  return filterEngine;
}

/** Layout items after hide/isolate (before filtering). */
function visibleItems(name: string): number[] {
  const li = doc ? layoutItems(doc, name) : null;
  if (!li) return [];
  return isolated || hidden.size ? li.items.filter((id) => (isolated ? isolated.has(id) : true) && !hidden.has(id)) : li.items;
}

function pickerOf(ls: LayoutState): Picker {
  ls.picker ??= new Picker(doc!, ls.scene, styles!, measurer);
  return ls.picker;
}

function entityVisible(id: number): boolean {
  if (!doc || !styles) return false;
  const e = doc.entities[id];
  const li = styles.layerIdx(styles.effectiveLayer(e, { layer: null } as never));
  return layerOn[li] === 1 && layerFrozen[li] === 0;
}

/** Selection/hover overlay drawn on its own canvas (base canvas untouched). */
function drawHighlight(): void {
  if (!hlCtx || !hlCanvas) return;
  const c = hlCtx;
  const dpr = viewport.dpr;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, hlCanvas.width, hlCanvas.height);
  const ls = layouts.get(active);
  if (!ls || !doc || !hasView) return;
  const picker = pickerOf(ls);
  const toDev = (x: number, y: number): [number, number] => {
    const p = worldToScreen(view, viewport, x, y);
    return [p[0] * dpr, p[1] * dpr];
  };
  const draw = (ids: number[], color: string, width: number, glow: boolean) => {
    c.beginPath();
    let budget = 400_000;
    for (const id of ids) {
      const f = picker.flat(id);
      for (const pl of f.polylines) {
        if (budget <= 0) break;
        const p0 = toDev(pl[0], pl[1]);
        c.moveTo(p0[0], p0[1]);
        if (pl.length === 2) {
          c.arc(p0[0], p0[1], 3 * dpr, 0, Math.PI * 2);
          continue;
        }
        for (let i = 2; i < pl.length; i += 2) {
          const p = toDev(pl[i], pl[i + 1]);
          c.lineTo(p[0], p[1]);
        }
        budget -= pl.length;
      }
      for (const l of f.infinite) {
        const far = 1e7 / view.scale;
        const a = toDev(l.x - (l.ray ? 0 : l.dx * far), l.y - (l.ray ? 0 : l.dy * far));
        const b = toDev(l.x + l.dx * far, l.y + l.dy * far);
        c.moveTo(a[0], a[1]);
        c.lineTo(b[0], b[1]);
      }
    }
    c.lineJoin = 'round';
    c.lineCap = 'round';
    if (glow) {
      c.strokeStyle = color + '55';
      c.lineWidth = (width + 4) * dpr;
      c.stroke();
    }
    c.strokeStyle = color;
    c.lineWidth = width * dpr;
    c.stroke();
  };
  if (selection.length) draw(selection, '#4fc3f7', 1.5, true);
  if (hoverId !== null && !selection.includes(hoverId)) draw([hoverId], '#ffe082', 1.2, false);
}
let lastProgressiveRender = 0;

function syncLayerArrays(): void {
  if (!styles) return;
  const n = styles.layers.length;
  if (layerOn.length === n) return;
  const on = new Uint8Array(n);
  const fr = new Uint8Array(n);
  on.set(layerOn.subarray(0, Math.min(n, layerOn.length)));
  fr.set(layerFrozen.subarray(0, Math.min(n, layerFrozen.length)));
  for (let i = layerOn.length; i < n; i++) {
    on[i] = styles.layers[i].fileOn ? 1 : 0;
    fr[i] = styles.layers[i].fileFrozen ? 1 : 0;
  }
  layerOn = on;
  layerFrozen = fr;
}

function layerInfos(): LayerInfo[] {
  if (!styles) return [];
  syncLayerArrays();
  return styles.layers.map((l, index) => ({
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
    propsOverridden: l.overridden,
  }));
}

/** VPORT *Active as a plan view: DCS center → world (p = target + R(−twist)·center). */
function initialViewOf(vport: Record<string, unknown>): DocSummary['initialView'] {
  const c = (vport.center as number[]) ?? [0, 0, 0];
  const tgt = (vport.target as number[]) ?? [0, 0, 0];
  const twist = Number(vport.twist) || 0;
  const r = (-twist * Math.PI) / 180;
  return {
    cx: tgt[0] + c[0] * Math.cos(r) - c[1] * Math.sin(r),
    cy: tgt[1] + c[0] * Math.sin(r) + c[1] * Math.cos(r),
    height: Number(vport.height) || 0,
    aspect: Number(vport.aspect) || 1,
    twist,
  };
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

function renderOptions(d: DxfDocument): RenderOptions {
  return {
    ...settings,
    layerOn,
    layerFrozen,
    pdmode: headerNumber(d, '$PDMODE', 0),
    pdsize: headerNumber(d, '$PDSIZE', 0),
    lwdisplay: headerNumber(d, '$LWDISPLAY', 0) !== 0,
  };
}

/** Paper layout: sheet, model space through viewports, then paper space entities. */
function renderPaper(c: OffscreenCanvasRenderingContext2D, ls: LayoutState, opts: RenderOptions, view = currentView(), viewport = currentViewport(), renderers?: { model: Renderer | null; paper: Renderer }) {
  const dpr = viewport.dpr;
  const W = viewport.width * dpr;
  const H = viewport.height * dpr;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  const bg = settings.background;
  const lum = ((bg >> 16) & 0xff) * 0.299 + ((bg >> 8) & 0xff) * 0.587 + (bg & 0xff) * 0.114;
  const shade = (k: number) => {
    const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + k)));
    return `rgb(${ch((bg >> 16) & 0xff)},${ch((bg >> 8) & 0xff)},${ch(bg & 0xff)})`;
  };
  c.fillStyle = shade(lum < 128 ? -8 : -24);
  c.fillRect(0, 0, W, H);
  const toDev = (x: number, y: number): [number, number] => {
    const p = worldToScreen(view, viewport, x, y);
    return [p[0] * dpr, p[1] * dpr];
  };
  if (ls.sheet) {
    const s = ls.sheet;
    const pts = [toDev(s.minX, s.minY), toDev(s.maxX, s.minY), toDev(s.maxX, s.maxY), toDev(s.minX, s.maxY)];
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath();
    c.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
    c.fill();
    c.strokeStyle = shade(lum < 128 ? 40 : -60);
    c.lineWidth = dpr;
    c.stroke();
  }
  const modelRenderer = renderers ? renderers.model : (layouts.get('Model')?.renderer ?? null);
  let stats = { tiles: 0, batches: 0, texts: 0, ms: 0 };
  if (modelRenderer && styles) {
    for (const vp of ls.scene.viewports) {
      const s = vp.height / (vp.viewHeight || vp.height);
      const tw = vp.twist;
      const cmx = vp.target[0] + Math.cos(-tw) * vp.viewCx - Math.sin(-tw) * vp.viewCy;
      const cmy = vp.target[1] + Math.sin(-tw) * vp.viewCx + Math.cos(-tw) * vp.viewCy;
      const modelView: ViewState = {
        cx: cmx,
        cy: cmy,
        scale: view.scale * s,
        rotation: view.rotation + (view.mirrorX !== view.mirrorY ? -tw : tw),
        mirrorX: view.mirrorX,
        mirrorY: view.mirrorY,
      };
      const rect = [toDev(vp.cx - vp.width / 2, vp.cy - vp.height / 2), toDev(vp.cx + vp.width / 2, vp.cy - vp.height / 2), toDev(vp.cx + vp.width / 2, vp.cy + vp.height / 2), toDev(vp.cx - vp.width / 2, vp.cy + vp.height / 2)];
      const box = {
        minX: Math.max(0, Math.min(...rect.map((p) => p[0]))),
        minY: Math.max(0, Math.min(...rect.map((p) => p[1]))),
        maxX: Math.min(W, Math.max(...rect.map((p) => p[0]))),
        maxY: Math.min(H, Math.max(...rect.map((p) => p[1]))),
      };
      if (box.minX >= box.maxX || box.minY >= box.maxY) continue;
      const frozen = new Uint8Array(styles.layers.length);
      for (const name of vp.frozenLayers) frozen[styles.layerIdx(name)] = 1;
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.beginPath();
      rect.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.closePath();
      c.clip();
      if (vp.clip) {
        // non-rectangular viewport: clip with the boundary entity (paper coordinates)
        const o = toDev(0, 0);
        const ex = toDev(1, 0);
        const ey = toDev(0, 1);
        c.setTransform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
        c.clip(vp.clip as Path2D);
        c.setTransform(1, 0, 0, 1, 0, 0);
      }
      const r = modelRenderer.render(c, modelView, viewport, { ...opts, layerOn, layerFrozen }, { clear: false, origin: toDev(vp.cx, vp.cy), rect: box, extraFrozen: frozen });
      c.restore();
      stats = { tiles: stats.tiles + r.tiles, batches: stats.batches + r.batches, texts: stats.texts + r.texts, ms: stats.ms };
    }
  }
  const r = (renderers?.paper ?? ls.renderer).render(c, view, viewport, opts, { clear: false });
  return { tiles: stats.tiles + r.tiles, batches: stats.batches + r.batches, texts: stats.texts + r.texts, ms: r.ms };
}

// module-level view state accessors (defaults for renderPaper)
function currentView(): ViewState {
  return view;
}
function currentViewport(): Viewport {
  return viewport;
}

/** Finish building a layout synchronously (exports need the complete scene). */
function finishBuild(b: SceneBuilder): void {
  let guard = 0;
  while (!b.done && guard++ < 1e6) b.step(Infinity, () => 0);
}

/** Render the active layout to PNG or SVG (current view or the whole extents). */
async function exportLayout(p: { format: 'png' | 'svg'; area: 'view' | 'extents'; scale: number }): Promise<{ png?: Blob; svg?: string; width: number; height: number }> {
  const ls = layouts.get(active);
  if (!ls || !doc || !styles) throw new Error('No drawing');
  finishBuild(ls.builder);
  if (ls.kind === 'paper') {
    const model = layouts.get('Model');
    if (model) finishBuild(model.builder);
  }
  let v = view;
  let vpX: Viewport = { width: viewport.width, height: viewport.height, dpr: 1 };
  if (p.area === 'extents') {
    const ext = ls.kind === 'paper' && ls.sheet ? ls.sheet : ls.scene.extents;
    if (!(ext.minX <= ext.maxX)) throw new Error('Empty layout');
    const cos = Math.abs(Math.cos(view.rotation));
    const sin = Math.abs(Math.sin(view.rotation));
    const w = (ext.maxX - ext.minX) * cos + (ext.maxY - ext.minY) * sin;
    const h = (ext.maxX - ext.minX) * sin + (ext.maxY - ext.minY) * cos;
    const longest = 2000;
    const k = longest / Math.max(w, h, 1e-12);
    vpX = { width: Math.max(16, Math.round(w * k * 1.04)), height: Math.max(16, Math.round(h * k * 1.04)), dpr: 1 };
    v = fitView(ext, vpX, view, 0.02);
  }
  syncLayerArrays();
  const opts = renderOptions(doc);
  if (p.format === 'png') {
    const dpr = Math.max(0.25, Math.min(8, p.scale));
    const vpp = { ...vpX, dpr };
    const W = Math.round(vpp.width * dpr);
    const H = Math.round(vpp.height * dpr);
    if (W * H > 16384 * 16384 || W > 32767 || H > 32767) throw new Error('Image too large');
    const cv = new OffscreenCanvas(W, H);
    const c = cv.getContext('2d', { alpha: false })!;
    if (ls.kind === 'model') ls.renderer.render(c, v, vpp, opts);
    else renderPaper(c, ls, opts, v, vpp);
    return { png: await cv.convertToBlob({ type: 'image/png' }), width: W, height: H };
  }
  // SVG: rebuild the scenes with recording paths and render through the recording context
  const svgScene = (src: LayoutState) => {
    const b = new SceneBuilder(doc!, src.items, measurer, () => new SvgPath() as unknown as Path2D, undefined, styles!);
    b.filter = src.builder.filter;
    b.prepare();
    finishBuild(b);
    return new Renderer(b.scene);
  };
  setPathFactory(() => new SvgPath() as unknown as Path2D);
  try {
    const sc = new SvgContext(vpX.width, vpX.height);
    const c = sc as unknown as OffscreenCanvasRenderingContext2D;
    if (ls.kind === 'model') svgScene(ls).render(c, v, vpX, opts);
    else {
      const model = layouts.get('Model');
      renderPaper(c, ls, opts, v, vpX, { model: model ? svgScene(model) : null, paper: svgScene(ls) });
    }
    return { svg: sc.toSvg(`${doc.source.name} — ${active}`), width: vpX.width, height: vpX.height };
  } finally {
    setPathFactory(null);
  }
}

function renderNow(): void {
  renderScheduled = false;
  const ls = layouts.get(active);
  if (!ctx || !canvas || !ls || !doc || !hasView) return;
  syncLayerArrays();
  const t0 = performance.now();
  const opts = renderOptions(doc);
  const stats = ls.kind === 'model' ? ls.renderer.render(ctx, view, viewport, opts) : renderPaper(ctx, ls, opts);
  drawHighlight();
  emit(self, 'frame', { viewId, ms: performance.now() - t0, tiles: stats.tiles, batches: stats.batches, texts: stats.texts });
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

function continueBuild(ls: LayoutState, gen: number): void {
  if (gen !== generation || layouts.get(ls.name) !== ls) return;
  const start = performance.now();
  const done = ls.builder.step(start + BUILD_SLICE_MS, () => performance.now());
  if (ls.name === active) emit(self, 'progress', { phase: done ? 'ready' : 'building', fraction: 0.6 + 0.4 * ls.builder.progress });
  if (done) {
    if (ls.name === active) emit(self, 'build', buildInfo());
    emit(self, 'layers', layerInfos());
    scheduleRender();
    return;
  }
  if (start - lastProgressiveRender > PROGRESSIVE_RENDER_MS && (ls.name === active || ls.kind === 'model')) {
    lastProgressiveRender = start;
    renderNow();
  }
  setTimeout(() => continueBuild(ls, gen), 0);
}

/** Entities of a layout (model space or a paper space layout). */
function layoutItems(d: DxfDocument, name: string): { kind: 'model' | 'paper'; items: number[]; sheet?: BBox2 } | null {
  if (name === 'Model') return { kind: 'model', items: d.modelSpace };
  if (name.startsWith('\u00A7')) {
    // "§NAME": a block definition shown on its own
    const b = d.blocks.get(nameKey(name.slice(1)));
    return b ? { kind: 'model', items: b.entities } : null;
  }
  const layout = d.layouts.find((l) => l.name === name);
  if (!layout && name === 'Paper' && d.paperSpace.length) return { kind: 'paper', items: d.paperSpace };
  if (!layout) return null;
  const bn = layout.blockName ?? '';
  let items: number[] = [];
  if (/^\*paper_space$/i.test(bn)) items = d.paperSpace;
  else {
    const block = d.blocks.get(nameKey(bn));
    items = block ? block.entities : [];
  }
  let sheet: BBox2 | undefined;
  if (layout.paper) {
    const k = layout.paper.units === 0 ? 1 / 25.4 : 1;
    const rot = layout.paper.rotation === 1 || layout.paper.rotation === 3;
    const w = (rot ? layout.paper.height : layout.paper.width) * k;
    const h = (rot ? layout.paper.width : layout.paper.height) * k;
    const lim = layout.limits;
    const x0 = lim ? lim.minX : 0;
    const y0 = lim ? lim.minY : 0;
    sheet = { minX: x0, minY: y0, maxX: x0 + w, maxY: y0 + h };
  } else if (layout.limits && layout.limits.maxX > layout.limits.minX) sheet = layout.limits;
  return { kind: 'paper', items, sheet };
}

function startLayout(name: string): LayoutState | null {
  if (!doc || !styles) return null;
  const existing = layouts.get(name);
  if (existing) return existing;
  const li = layoutItems(doc, name);
  if (!li) return null;
  let items = visibleItems(name);
  const f = activeFilter;
  let sceneFilter: SceneBuilder['filter'] = null;
  if (f && f.spec.mode !== 'select') {
    const matched = engine().match(f, name, items);
    if (f.spec.mode === 'show') {
      items = items.filter((id) => matched.has(id));
      if (f.spec.level === 'leaf') sceneFilter = { leaf: f.pred, leafMode: 'skip' };
    } else {
      sceneFilter = f.spec.level === 'leaf' ? { leaf: f.pred, leafMode: 'dim' } : { dimTop: new Set(items.filter((id) => !matched.has(id))) };
    }
  }
  const b = new SceneBuilder(doc, items, measurer, () => new Path2D(), undefined, styles);
  b.filter = sceneFilter;
  const ls: LayoutState = { name, kind: li.kind, items, builder: b, scene: b.scene, renderer: new Renderer(b.scene), gen: generation, sheet: li.sheet };
  layouts.set(name, ls);
  b.prepare();
  syncLayerArrays();
  setTimeout(() => continueBuild(ls, generation), 0);
  return ls;
}

function activate(name: string): void {
  active = name;
  const ls = layouts.get(name);
  builder = ls?.builder ?? null;
  scene = ls?.scene ?? null;
}

/** Rebuild all scenes (after font option changes) keeping layer states. */
function rebuild(): void {
  if (!doc) return;
  ++generation;
  const names = [...layouts.keys()];
  layouts.clear();
  styles = new StyleResolver(doc, layerOverrides);
  filterEngine = null;
  if (activeFilter) activeFilter = engine().compile(activeFilter.spec);
  for (const n of ['Model', ...names.filter((x) => x !== 'Model')]) startLayout(n);
  activate(active);
  lastProgressiveRender = performance.now();
}

function layoutList(d: DxfDocument): LayoutInfo[] {
  const out: LayoutInfo[] = [{ name: 'Model', kind: 'model', count: d.modelSpace.length }];
  const paper = d.layouts.filter((l) => !/^\*model_space$/i.test(l.blockName ?? '') && l.name.toLowerCase() !== 'model');
  if (!paper.length && d.paperSpace.length) out.push({ name: 'Paper', kind: 'paper', count: d.paperSpace.length });
  for (const l of paper) {
    const li = layoutItems(d, l.name);
    out.push({ name: l.name, kind: 'paper', count: li?.items.length ?? 0 });
  }
  return out;
}

const userFontFaces: FontFace[] = [];
const userFontErrors: string[] = [];

/** Register fonts the user added (IndexedDB) for text resolution in this worker. */
async function loadUserFonts(): Promise<void> {
  for (const f of userFontFaces) self.fonts.delete(f);
  userFontFaces.length = 0;
  userFontErrors.length = 0;
  unregisterStrokeFonts('shx:');
  const map = new Map<string, UserFontInfo>();
  for (const f of await getAllUserFonts()) {
    const key = fontKey(f.name);
    try {
      if (f.kind === 'ttf') {
        const family = `dxfv-user ${key}`;
        const face = new FontFace(family, f.bytes);
        await face.load();
        self.fonts.add(face);
        userFontFaces.push(face);
        map.set(key, { kind: 'ttf', family });
      } else {
        const { provider, type } = makeShxProvider(f.name, f.bytes);
        registerStrokeFont(`shx:${key}`, provider);
        map.set(key, { kind: 'shx', strokeId: `shx:${key}`, shxType: type });
      }
    } catch (err) {
      userFontErrors.push(`${f.name}: ${(err as Error).message}`);
    }
  }
  configureFonts({ userFonts: map });
}

const localCache = new Map<string, boolean>();
/** Whether a font family is installed locally (width comparison against generic fallbacks). */
function localAvailable(name: string): boolean {
  let v = localCache.get(name);
  if (v !== undefined) return v;
  const c = new OffscreenCanvas(8, 8).getContext('2d')!;
  const sample = 'mmmmmmmmmmlli1WW あア漢';
  let differs = false;
  for (const generic of ['monospace', 'serif', 'sans-serif']) {
    c.font = `40px ${generic}`;
    const w0 = c.measureText(sample).width;
    c.font = `40px "${name.replace(/"/g, '')}", ${generic}`;
    if (Math.abs(c.measureText(sample).width - w0) > 0.5) differs = true;
  }
  v = differs;
  localCache.set(name, v);
  return v;
}

function fontUsage(d: DxfDocument): FontUsage[] {
  textIndex ??= new TextIndex(d);
  const usage = textIndex.styleUsage();
  const map = new Map<string, FontUsage>();
  const add = (spec: FontSpec, kind: 'shx' | 'ttf', styleName: string | null, count: number, bigFont?: string) => {
    const key = spec.requested.toLowerCase();
    let u = map.get(key);
    if (!u) {
      const localName = kind === 'ttf' ? (/^"([^"]+)"/.exec(spec.family)?.[1] ?? undefined) : undefined;
      u = {
        requested: spec.requested,
        kind,
        bigFont,
        styles: [],
        textCount: 0,
        substitute: spec.primary,
        stroke: spec.stroke,
        localAvailable: kind === 'ttf' && localName && !localName.startsWith('dxfv ') ? localAvailable(localName) : null,
        localName: localName && !localName.startsWith('dxfv ') ? localName : undefined,
        override: fontConfig().overrides[key],
      };
      map.set(key, u);
    }
    if (styleName && !u.styles.includes(styleName)) u.styles.push(styleName);
    u.textCount += count;
  };
  for (const st of d.styles.values()) {
    const spec = resolveFont(st);
    const kind = spec.stroke || /\.shx$/i.test(st.font) || (!st.family && !/\.(ttf|ttc|otf)$/i.test(st.font)) ? 'shx' : 'ttf';
    add(spec, kind, st.name, usage.get(nameKey(st.name)) ?? 0, st.bigFont || undefined);
  }
  const fontRe = /\\([fF])([^|;\\]*)((?:\|[^|;]*)*);/g;
  for (const e of d.entities) {
    if (e.type !== 'MTEXT') continue;
    const m = e as MTextEntity;
    for (const fm of m.text.matchAll(fontRe)) {
      if (!fm[2]) continue;
      const spec = resolveFont(d.styles.get(nameKey(m.style)), { font: fm[2], shx: fm[1] === 'F' });
      add(spec, spec.stroke ? 'shx' : 'ttf', null, 1);
    }
  }
  return [...map.values()].sort((a, b) => b.textCount - a.textCount);
}

function summarize(d: DxfDocument, s: Scene, parseMs: number): DocSummary {
  const ext = s.extents;
  const vport = d.tableRecords.find((r) => r.table === 'VPORT' && /^\*active$/i.test(r.name));
  return {
    name: d.source.name,
    size: d.source.size,
    hash: fileHash,
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
    layoutNames: layoutList(d).map((l) => l.name),
    extents: ext.minX <= ext.maxX ? { minX: ext.minX, minY: ext.minY, maxX: ext.maxX, maxY: ext.maxY } : null,
    insUnits: headerNumber(d, '$INSUNITS', 0),
    lunits: headerNumber(d, '$LUNITS', 2),
    luprec: headerNumber(d, '$LUPREC', 4),
    initialView: vport ? initialViewOf(vport) : undefined,
    parseMs,
    diagnostics: d.diagnostics.slice(0, 2000),
  };
}

const api: DocApi = {
  async open(p) {
    const gen = ++generation;
    if (p.fontOptions) configureFonts({ preferLocal: p.fontOptions.preferLocal, overrides: Object.fromEntries(Object.entries(p.fontOptions.overrides).map(([k, v]) => [k.toLowerCase(), v])) });
    if (p.hash) fileHash = p.hash;
    else {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', p.bytes));
      fileHash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    }
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
      await Promise.all([fonts.init(), loadUserFonts()]);
    }
    const { specs, text } = collectFonts(d);
    await fonts.ensure(specs, text);
    if (gen !== generation) throw new Error('superseded');

    doc = d;
    textIndex = null;
    selection = [];
    hoverId = null;
    hidden = new Set();
    isolated = null;
    filterEngine = null;
    activeFilter = null;
    layouts.clear();
    layerOverrides = new Map();
    styles = new StyleResolver(d, layerOverrides);
    layerOn = new Uint8Array(0);
    layerFrozen = new Uint8Array(0);
    emit(self, 'progress', { phase: 'layout', fraction: 0.55 });
    lastProgressiveRender = performance.now();
    const ls = startLayout('Model')!;
    activate('Model');
    return summarize(d, ls.scene, parseMs);
  },

  attachCanvas(p) {
    canvas = p.canvas;
    ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
    canvas.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
    canvas.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
    if (p.highlight) {
      hlCanvas = p.highlight;
      hlCtx = hlCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      hlCanvas.width = canvas.width;
      hlCanvas.height = canvas.height;
    }
    scheduleRender();
  },

  resize(p) {
    viewport = p;
    for (const cv of [canvas, hlCanvas]) {
      if (!cv) continue;
      cv.width = Math.max(1, Math.round(p.width * p.dpr));
      cv.height = Math.max(1, Math.round(p.height * p.dpr));
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
      styles?.layers.forEach((l, i) => {
        layerOn[i] = l.fileOn ? 1 : 0;
        layerFrozen[i] = l.fileFrozen ? 1 : 0;
      });
      if (layerOverrides.size) {
        layerOverrides = new Map();
        rebuild();
      }
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

  layerStates() {
    if (!doc) return [];
    return readLayerStates(doc).map((d) => ({ name: d.name, description: d.description, layerCount: d.layers.length, restoreFlags: d.restoreFlags, paperSpace: d.paperSpace }));
  },

  applyLayerState(p) {
    if (!doc || !styles) return [];
    syncLayerArrays();
    if ('custom' in p) {
      for (const c of p.custom) {
        const idx = styles.layers.findIndex((l) => nameKey(l.name) === nameKey(c.name));
        if (idx < 0) continue;
        layerOn[idx] = c.on ? 1 : 0;
        layerFrozen[idx] = c.frozen ? 1 : 0;
      }
      scheduleRender();
      return layerInfos();
    }
    const def = readLayerStates(doc).find((d) => d.name === p.name);
    if (!def) return layerInfos();
    const rf = def.restoreFlags;
    const next = new Map<string, LayerOverride>();
    for (const l of def.layers) {
      const key = nameKey(l.name);
      const idx = styles.layers.findIndex((x) => nameKey(x.name) === key);
      const file = doc.layers.get(key);
      if (idx < 0 || !file) continue;
      if (rf & LSR_ON) layerOn[idx] = l.flags & LS_OFF ? 0 : 1;
      if (rf & LSR_FROZEN) layerFrozen[idx] = l.flags & LS_FROZEN ? 1 : 0;
      const o: LayerOverride = {};
      if (rf & LSR_COLOR && l.color !== undefined) {
        const differs = l.trueColor !== undefined ? l.trueColor !== file.trueColor : file.trueColor !== undefined || l.color !== Math.abs(file.color);
        if (differs) {
          o.color = l.color || 7;
          o.trueColor = l.trueColor ?? null;
        }
      }
      if (rf & LSR_LINETYPE && l.linetype && nameKey(l.linetype) !== nameKey(file.linetype)) o.linetype = l.linetype;
      if (rf & LSR_LINEWEIGHT && l.lineweight !== undefined && l.lineweight !== file.lineweight) o.lineweight = l.lineweight;
      if (rf & LSR_TRANSPARENCY && l.transparency !== undefined) {
        const a = l.transparency ? (transparencyToAlpha(l.transparency) ?? 1) : 1;
        if (a !== (transparencyToAlpha(file.transparency) ?? 1)) o.alpha = a;
      }
      if (Object.keys(o).length) next.set(key, o);
    }
    const changed = JSON.stringify([...next]) !== JSON.stringify([...layerOverrides]);
    layerOverrides = next;
    if (changed) rebuild();
    scheduleRender();
    return layerInfos();
  },

  namedViews() {
    if (!doc) return [];
    return doc.tableRecords
      .filter((r) => r.table === 'VIEW')
      .map((r) => {
        const c = (r.center as number[]) ?? [0, 0, 0];
        const tgt = (r.target as number[]) ?? [0, 0, 0];
        const dir = (r.direction as number[]) ?? [0, 0, 1];
        const tw = ((Number(r.twist) || 0) * Math.PI) / 180;
        // DCS = R(twist)·(p − target)  →  p = target + R(−twist)·center
        const cos = Math.cos(-tw);
        const sin = Math.sin(-tw);
        return {
          name: r.name,
          cx: tgt[0] + c[0] * cos - c[1] * sin,
          cy: tgt[1] + c[0] * sin + c[1] * cos,
          width: Number(r.width) || 0,
          height: Number(r.height) || 0,
          twist: tw,
          paperSpace: ((Number(r.flags) || 0) & 1) !== 0,
          nonPlan: Math.hypot(dir[0], dir[1]) > 1e-9 * Math.max(1, Math.abs(dir[2])) || dir[2] < 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  },

  entityAngle(p) {
    if (!doc) return null;
    const g = engine().reader.geometry(doc.entities[p.id]);
    if (!g) return null;
    if (g.infinite.length) return Math.atan2(g.infinite[0].dy, g.infinite[0].dx);
    let best = 0;
    let angle: number | null = null;
    for (const pl of g.polylines)
      for (let i = 0; i + 3 < pl.length; i += 2) {
        const dx = pl[i + 2] - pl[i];
        const dy = pl[i + 3] - pl[i + 1];
        const len = Math.hypot(dx, dy);
        if (len > best * (1 + 1e-9)) {
          best = len;
          angle = Math.atan2(dy, dx);
        }
      }
    return angle;
  },

  getBuildInfo() {
    return buildInfo();
  },

  queryTexts(q) {
    if (!doc) return { total: 0, rows: [] };
    textIndex ??= new TextIndex(doc);
    return textIndex.query(q);
  },

  entityBounds(p) {
    if (!builder) return null;
    let b: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (const id of p.ids) {
      const e = builder.boundsOf(id);
      if (!e) continue;
      if (!b) b = { ...e };
      else {
        b.minX = Math.min(b.minX, e.minX);
        b.minY = Math.min(b.minY, e.minY);
        b.maxX = Math.max(b.maxX, e.maxX);
        b.maxY = Math.max(b.maxY, e.maxY);
      }
    }
    return b;
  },

  getFonts() {
    return doc ? fontUsage(doc) : [];
  },

  getLayouts() {
    return doc ? layoutList(doc) : [];
  },

  hover(p) {
    const ls = layouts.get(active);
    if (!p || !ls || !doc || !hasView) {
      if (hoverId !== null) {
        hoverId = null;
        drawHighlight();
      }
      return null;
    }
    const ids = pickerOf(ls).pick(view, viewport, p.x, p.y, 5, entityVisible);
    const id = ids[0] ?? null;
    if (id !== hoverId) {
      hoverId = id;
      drawHighlight();
    }
    if (id === null) return null;
    const e = doc.entities[id];
    return { id, handle: e.handle, type: e.type, layer: e.layer };
  },

  getBlocks() {
    return doc ? blockInfos(doc) : [];
  },

  blockRefs(p) {
    const ls = layouts.get(active);
    if (!ls || !doc) return [];
    const target = nameKey(p.name);
    const contains = makeContains(doc);
    return ls.items.filter((id) => {
      const n = referencedBlock(doc!.entities[id]);
      if (!n) return false;
      return p.nested ? contains(nameKey(n), target) : nameKey(n) === target;
    });
  },

  blockPreview(p) {
    if (!doc) return null;
    const block = doc.blocks.get(nameKey(p.name));
    if (!block || !block.entities.length || block.entities.length > 20000) return null;
    const previewStyles = new StyleResolver(doc, layerOverrides);
    const b = new SceneBuilder(doc, block.entities, measurer, () => new Path2D(), undefined, previewStyles);
    b.prepare();
    b.step(Infinity, () => 0);
    const e = b.scene.extents;
    if (!(e.minX <= e.maxX)) return null;
    const canvasP = new OffscreenCanvas(p.size, p.size);
    const c = canvasP.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const vp = { width: p.size, height: p.size, dpr: 1 };
    const v = fitView(e, vp, DEFAULT_VIEW, 0.08);
    const n = previewStyles.layers.length;
    new Renderer(b.scene).render(c, v, vp, {
      ...settings,
      background: p.background,
      minTextPx: 3,
      layerOn: new Uint8Array(n).fill(1),
      layerFrozen: new Uint8Array(n),
      pdmode: 0,
      pdsize: 0,
      lwdisplay: false,
    });
    const bmp = canvasP.transferToImageBitmap();
    return bmp;
  },

  treeChildren(p) {
    if (!doc) return { total: 0, nodes: [] };
    const d = doc;
    const items = (name: string) => layoutItems(d, name)?.items ?? null;
    return treeChildren(d, items, layoutList(d).map((l) => l.name), p.key, p.offset, p.limit);
  },

  filterCatalog() {
    if (!doc) return { props: [], gcCodes: [], xdataApps: [], attrTags: [], fields: [] };
    return engine().catalog(visibleItems(active));
  },

  filterFacets(p) {
    if (!doc) return {};
    return engine().facets(visibleItems(active), p.level);
  },

  filterValues(p) {
    if (!doc) return [];
    return engine().values(visibleItems(active), p.prop, p.level, p.limit);
  },

  applyFilter(p) {
    if (!doc) return { count: 0 };
    if (!p.spec) {
      activeFilter = null;
      rebuild();
      return { count: 0 };
    }
    const f = engine().compile(p.spec);
    const matched = engine().match(f, active, visibleItems(active));
    const ids = [...matched];
    const rejected = regexIssues(p.spec);
    const base = { count: ids.length, leafCount: f.leafCount, truncated: f.truncated, rejected: rejected.length ? rejected : undefined };
    if (p.spec.mode === 'select') {
      // select only; the scene changes only when it was filtered before
      const wasFiltering = activeFilter && activeFilter.spec.mode !== 'select';
      activeFilter = f;
      if (wasFiltering) rebuild();
      selection = ids;
      drawHighlight();
      return { ...base, ids };
    }
    activeFilter = f;
    rebuild();
    return base;
  },

  filterResults(p) {
    if (!doc || !activeFilter) return { total: 0, rows: [] };
    const ids = [...engine().match(activeFilter, active, visibleItems(active))];
    return { total: ids.length, rows: engine().rows(ids, p.offset, p.limit) };
  },

  search(p) {
    if (!doc) return { total: 0, hits: [] };
    textIndex ??= new TextIndex(doc);
    return engine().search(visibleItems(active), textIndex, p);
  },

  describeIds(p) {
    if (!doc) return [];
    return p.ids.slice(0, 100_000).map((id) => {
      const e = doc!.entities[id];
      return { id, handle: e?.handle ?? '', type: e?.type ?? '?', layer: e?.layer ?? '' };
    });
  },

  hoverInfo(p) {
    const e = doc?.entities[p.id];
    return e ? { id: p.id, handle: e.handle, type: e.type, layer: e.layer } : null;
  },

  pick(p) {
    const ls = layouts.get(active);
    if (!ls || !doc || !hasView) return [];
    return pickerOf(ls).pick(view, viewport, p.x, p.y, p.tolerance ?? 5, entityVisible);
  },

  headerVars() {
    return doc ? headerVars(doc) : [];
  },
  tableGroups() {
    return doc ? tableGroups(doc) : [];
  },
  classes() {
    return doc ? doc.classes.map((c) => ({ name: c.name, cppName: c.cppName, app: c.app, flags: c.flags, line: doc!.tags.line(c.tag) })) : [];
  },
  objectChildren(p) {
    return doc ? objectChildren(doc, p.handle) : [];
  },
  inspectHandle(p) {
    return doc ? inspectHandle(doc, p.handle) : null;
  },
  thumbnail() {
    return doc?.thumbnail ?? null;
  },
  typeStats() {
    return doc ? typeStats(doc) : [];
  },
  generator() {
    return doc ? guessGenerator(doc) : { guess: [], reasons: [], evidence: [] };
  },
  rawRows(p) {
    return doc ? rawRows(doc, p.offset, p.limit) : [];
  },
  rawSearch(p) {
    return doc ? rawSearch(doc, p) : null;
  },
  tagAtLine(p) {
    return doc ? tagAtLine(doc, p.line) : 0;
  },
  tagOwner(p) {
    return doc ? tagOwner(doc, p.index) : null;
  },

  exportImage(p) {
    return exportLayout(p);
  },

  snap(p) {
    const ls = layouts.get(active);
    if (!ls || !doc || !hasView) return null;
    return snapAt(doc, pickerOf(ls), view, viewport, p.x, p.y, p.tolerance, p.kinds, entityVisible);
  },

  measureAt(p) {
    const ls = layouts.get(active);
    if (!ls || !doc || !hasView) return null;
    const id = pickerOf(ls).pick(view, viewport, p.x, p.y, 6, entityVisible)[0];
    if (id === undefined) return null;
    const e = doc.entities[id];
    const r = engine().reader;
    const num = (k: string) => {
      const v = r.get(e, k, TOP_CTX, []);
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    };
    const out: EntityMeasure = { type: e.type, handle: e.handle, length: num('length'), area: num('area'), radius: num('radius'), closed: r.get(e, 'closed', TOP_CTX, []) === true };
    if (out.radius !== undefined) {
      // center from the flattened curve (handles OCS / extrusion)
      const g = r.geometry(e);
      const pl = g?.polylines.find((x) => x.length >= 8);
      if (pl) {
        const n = pl.length / 2;
        const i1 = Math.floor(n / 3) * 2;
        const i2 = Math.floor((2 * n) / 3) * 2;
        const [ax, ay, bx, by, cx, cy] = [pl[0], pl[1], pl[i1], pl[i1 + 1], pl[i2], pl[i2 + 1]];
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (d !== 0) {
          const a2 = ax * ax + ay * ay;
          const b2 = bx * bx + by * by;
          const c2 = cx * cx + cy * cy;
          out.center = [(a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d];
        }
      }
    }
    return out;
  },

  selectRect(p) {
    const ls = layouts.get(active);
    if (!ls || !doc || !hasView) return [];
    return pickerOf(ls).rect(view, viewport, p.x0, p.y0, p.x1, p.y1, p.crossing, entityVisible);
  },

  setSelection(p) {
    selection = p.ids;
    drawHighlight();
  },

  selectAll() {
    const ls = layouts.get(active);
    if (!ls) return [];
    return ls.items.filter((id) => entityVisible(id));
  },

  entityInfo(p) {
    if (!doc || !styles) return null;
    return entityInfo(doc, p.id, styles, measurer);
  },

  rawTags(p) {
    if (!doc) return { total: 0, rows: [] };
    return rawTags(doc, p.id, p.offset, p.limit);
  },

  findHandle(p) {
    const r = doc?.handles.get(p.handle.trim().toUpperCase());
    return r ? { kind: r.kind, id: r.index } : null;
  },

  selectSimilar(p) {
    const ls = layouts.get(active);
    if (!ls || !doc || !styles) return [];
    const e = doc.entities[p.id];
    const key = (x: typeof e): string => {
      switch (p.by) {
        case 'type':
          return x.type;
        case 'layer':
          return nameKey(x.layer);
        case 'block':
          return x.type === 'INSERT' ? nameKey(String(x.name)) : '\u0000';
        case 'color': {
          const st = styles!.resolve(x, { layer: null } as never);
          return st.fg ? 'fg' : String(st.rgb);
        }
      }
    };
    const k = key(e);
    return ls.items.filter((id) => entityVisible(id) && key(doc!.entities[id]) === k);
  },

  selectionSummary(p) {
    const byType = new Map<string, number>();
    const byLayer = new Map<string, number>();
    for (const id of p.ids) {
      const e = doc?.entities[id];
      if (!e) continue;
      byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
      byLayer.set(e.layer, (byLayer.get(e.layer) ?? 0) + 1);
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { count: p.ids.length, byType: sort(byType), byLayer: sort(byLayer) };
  },

  setVisibility(p) {
    if (p.mode === 'show') {
      hidden = new Set();
      isolated = null;
    } else if (p.mode === 'hide') {
      for (const id of p.ids ?? []) hidden.add(id);
    } else {
      isolated = new Set(p.ids ?? []);
    }
    selection = selection.filter((id) => !hidden.has(id) && (!isolated || isolated.has(id)));
    rebuild();
    return { hidden: hidden.size, isolated: isolated?.size ?? 0 };
  },

  setLayout(p) {
    const ls = startLayout(p.name);
    if (!ls) return null;
    activate(p.name);
    emit(self, 'build', buildInfo());
    scheduleRender();
    const e = ls.scene.extents;
    const ext = e.minX <= e.maxX ? { minX: e.minX, minY: e.minY, maxX: e.maxX, maxY: e.maxY } : null;
    return { extents: ls.sheet ?? ext, kind: ls.kind };
  },

  async reloadUserFonts() {
    await loadUserFonts();
    if (doc) rebuild();
    return userFontErrors;
  },

  async setFontOptions(p) {
    configureFonts({ preferLocal: p.preferLocal, overrides: Object.fromEntries(Object.entries(p.overrides).map(([k, v]) => [k.toLowerCase(), v])) });
    if (!doc || !fonts) return;
    const { specs, text } = collectFonts(doc);
    await fonts.ensure(specs, text);
    rebuild();
  },
};

serve(self, api);
