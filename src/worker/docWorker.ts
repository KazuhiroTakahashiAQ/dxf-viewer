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
import { Renderer, type RenderOptions } from '../render/renderer';
import { SceneBuilder, type Scene } from '../scene/scene';
import type { BuildInfo, DocApi, DocSummary, FontUsage, LayerInfo, RenderSettings } from '../shared/docApi';
import { TextIndex } from './textIndex';
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
let textIndex: TextIndex | null = null;
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

/** Rebuild the scene (after font option changes) keeping layer states. */
function rebuild(): void {
  if (!doc) return;
  const gen = ++generation;
  builder = new SceneBuilder(doc, doc.modelSpace, measurer, () => new Path2D());
  scene = builder.scene;
  renderer = new Renderer(scene);
  builder.prepare();
  syncLayerArrays();
  lastProgressiveRender = performance.now();
  setTimeout(() => continueBuild(gen), 0);
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
    if (p.fontOptions) configureFonts({ preferLocal: p.fontOptions.preferLocal, overrides: Object.fromEntries(Object.entries(p.fontOptions.overrides).map(([k, v]) => [k.toLowerCase(), v])) });
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
