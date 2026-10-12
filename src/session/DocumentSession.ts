import type { DocApi, DocEvents, DocSummary, RenderSettings } from '../shared/docApi';
import type { FilterSpec } from '../shared/filterSpec';
import { RpcClient } from '../shared/rpc';
import { DEFAULT_VIEW, fitView, sameView, screenDelta, type BBox2, type ViewState, type Viewport } from '../shared/view';
import { useUi } from '../state/store';

let seq = 0;

/**
 * One open document: owns its worker, its canvas (rendered by the worker via
 * OffscreenCanvas) and the authoritative view state.
 */
export class DocumentSession {
  readonly id: string;
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  readonly highlight: HTMLCanvasElement;
  private worker: Worker;
  readonly rpc: RpcClient<DocApi, DocEvents>;
  private bytes: ArrayBuffer;
  view: ViewState = DEFAULT_VIEW;
  viewport: Viewport = { width: 1, height: 1, dpr: 1 };
  summary: DocSummary | null = null;
  layout = 'Model';
  private layoutViews = new Map<string, ViewState>();
  private layoutExtents = new Map<string, BBox2 | null>();
  private viewSeq = 0;
  private sentViews = new Map<number, ViewState>();
  private renderedView: ViewState | null = null;
  private pendingSend = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  /** view history (back / forward), recorded after the view settles */
  private history: { layout: string; view: ViewState }[] = [];
  private historyIndex = -1;
  private historyTimer = 0;
  private navigating = false;

  constructor(name: string, bytes: ArrayBuffer) {
    this.id = `doc-${++seq}-${Date.now().toString(36)}`;
    this.name = name;
    this.bytes = bytes;
    this.worker = new Worker(new URL('../worker/docWorker.ts', import.meta.url), { type: 'module', name: `dxf:${name}` });
    this.rpc = new RpcClient<DocApi, DocEvents>(this.worker);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'doc-canvas';
    this.highlight = document.createElement('canvas');
    this.highlight.className = 'doc-canvas hl-canvas';
    const off = this.canvas.transferControlToOffscreen();
    const offHl = this.highlight.transferControlToOffscreen();
    void this.rpc.call('attachCanvas', { canvas: off, highlight: offHl }, [off, offHl]);

    this.rpc.on('progress', (p) => useUi.getState().setTab(this.id, { phase: p.phase, progress: p.fraction }));
    this.rpc.on('frame', (f) => {
      const v = this.sentViews.get(f.viewId);
      if (v) {
        this.renderedView = v;
        for (const k of this.sentViews.keys()) if (k < f.viewId) this.sentViews.delete(k);
      }
      useUi.getState().setTab(this.id, { frameMs: f.ms });
      this.applyPreview();
    });
    this.rpc.on('build', (b) => useUi.getState().setTab(this.id, { build: b }));
    this.rpc.on('layers', (layers) => useUi.getState().setTab(this.id, { layers }));
    this.worker.addEventListener('error', (e) => {
      useUi.getState().setTab(this.id, { status: 'error', error: e.message || 'Worker error' });
    });
  }

  async open(encoding?: string): Promise<void> {
    const ui = useUi.getState();
    ui.setTab(this.id, { status: 'loading', phase: 'parse', progress: 0, error: undefined, encoding });
    try {
      // copy so the original bytes stay available for re-decoding
      const copy = this.bytes.slice(0);
      const st = useUi.getState().settings;
      const summary = await this.rpc.call(
        'open',
        { bytes: copy, name: this.name, encoding, baseUrl: new URL('./', document.baseURI).href, fontOptions: { preferLocal: st.preferLocalFonts, overrides: st.fontOverrides } },
        [copy],
      );
      this.summary = summary;
      this.layout = 'Model';
      useUi.getState().setTab(this.id, { selection: [] });
      this.layoutViews.clear();
      this.layoutExtents.clear();
      this.layoutExtents.set('Model', summary.extents);
      ui.setTab(this.id, { status: 'ready', summary, layout: 'Model' });
      this.sendSettings(useUi.getState().settings);
      this.fit();
      const [layers, layouts] = await Promise.all([this.rpc.call('getLayers', undefined), this.rpc.call('getLayouts', undefined)]);
      useUi.getState().setTab(this.id, { layers, layouts });
    } catch (err) {
      if ((err as Error).message === 'superseded') return;
      ui.setTab(this.id, { status: 'error', error: (err as Error).message });
    }
  }

  sendSettings(s: RenderSettings): void {
    const { background, lineweights, lineweightScale, linetypes, fills, texts, minTextPx, monochrome } = s;
    this.rpc.notify('setRenderSettings', { background, lineweights, lineweightScale, linetypes, fills, texts, minTextPx, monochrome });
  }

  setViewport(vp: Viewport): void {
    if (vp.width === this.viewport.width && vp.height === this.viewport.height && vp.dpr === this.viewport.dpr) return;
    const first = this.viewport.width <= 1;
    this.viewport = vp;
    this.rpc.notify('resize', vp);
    if (first && this.summary) this.fit();
    else this.setView(this.view);
  }

  /** Switch between model space and paper space layouts (views are remembered per layout). */
  async setLayout(name: string): Promise<void> {
    if (name === this.layout) return;
    this.layoutViews.set(this.layout, this.view);
    const res = await this.rpc.call('setLayout', { name });
    if (!res) return;
    this.layout = name;
    this.layoutExtents.set(name, res.extents);
    this.renderedView = null;
    useUi.getState().setTab(this.id, { layout: name });
    this.setSelection([]);
    const saved = this.layoutViews.get(name);
    if (saved) this.setView(saved);
    else this.fit();
  }

  fit(): void {
    const ext = this.layoutExtents.get(this.layout) ?? (this.layout === 'Model' ? this.summary?.extents : null);
    if (!ext) {
      this.setView({ ...DEFAULT_VIEW, rotation: this.view.rotation, mirrorX: this.view.mirrorX, mirrorY: this.view.mirrorY });
      return;
    }
    this.setView(fitView(ext, this.viewport, this.view));
  }

  setView(v: ViewState): void {
    const prev = this.view;
    this.view = v;
    useUi.getState().setScale(v.scale);
    if (prev.rotation !== v.rotation || prev.mirrorX !== v.mirrorX || prev.mirrorY !== v.mirrorY || !useUi.getState().tabs.find((t) => t.id === this.id)?.viewOrient)
      useUi.getState().setTab(this.id, { viewOrient: { rotation: v.rotation, mirrorX: v.mirrorX, mirrorY: v.mirrorY } });
    this.applyPreview();
    this.listeners.forEach((fn) => fn());
    this.scheduleHistory();
    if (this.pendingSend) return;
    this.pendingSend = true;
    requestAnimationFrame(() => {
      this.pendingSend = false;
      if (this.disposed) return;
      const id = ++this.viewSeq;
      this.sentViews.set(id, this.view);
      this.rpc.notify('setView', { view: this.view, viewId: id });
    });
  }

  private scheduleHistory(): void {
    if (this.navigating || !this.summary) return;
    clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => this.recordHistory(), 500);
  }

  private recordHistory(): void {
    clearTimeout(this.historyTimer);
    this.historyTimer = 0;
    const last = this.history[this.historyIndex];
    if (last && last.layout === this.layout && sameView(last.view, this.view)) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push({ layout: this.layout, view: this.view });
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.publishNav();
  }

  private publishNav(): void {
    useUi.getState().setTab(this.id, { viewNav: { back: this.historyIndex > 0, forward: this.historyIndex < this.history.length - 1 } });
  }

  /** Go back (-1) or forward (+1) in the view history. */
  async historyGo(delta: number): Promise<void> {
    if (this.historyTimer) this.recordHistory();
    const idx = this.historyIndex + delta;
    const entry = this.history[idx];
    if (!entry) return;
    this.navigating = true;
    try {
      if (entry.layout !== this.layout) await this.setLayout(entry.layout);
      this.setView(entry.view);
      this.historyIndex = idx;
    } finally {
      this.navigating = false;
    }
    this.publishNav();
  }

  onViewChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Transform the last rendered frame to the current view until the worker catches up. */
  private applyPreview(): void {
    const from = this.renderedView;
    if (!from) {
      this.canvas.style.transform = '';
      this.highlight.style.transform = '';
      return;
    }
    const m = screenDelta(from, this.view, this.viewport);
    const identity = Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[4]) < 0.01 && Math.abs(m[5]) < 0.01;
    const tf = identity ? '' : `matrix(${m.join(',')})`;
    this.canvas.style.transform = tf;
    this.highlight.style.transform = tf;
  }

  async reopenWithEncoding(encoding: string | undefined): Promise<void> {
    this.renderedView = null;
    await this.open(encoding);
  }

  /** Fit the view to the given entities (with a sensible minimum size). */
  async zoomToEntities(ids: number[]): Promise<boolean> {
    const b = await this.rpc.call('entityBounds', { ids });
    if (!b) return false;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const pad = Math.max(w, h) * 0.6 + 1e-9;
    this.setView(fitView({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, this.viewport, this.view, 0.05));
    return true;
  }

  /** Apply (or clear with null) a declarative filter. */
  async applyFilter(spec: FilterSpec | null): Promise<void> {
    const res = await this.rpc.call('applyFilter', { spec });
    useUi.getState().setTab(this.id, { filterApplied: spec, filterResult: spec ? res : null });
    if (spec?.mode === 'select' && res.ids) useUi.getState().setTab(this.id, { selection: res.ids });
    else if (spec) this.setSelection([]);
  }

  /** Hide / isolate / show top-level entities (scenes are rebuilt in the worker). */
  async setVisibility(mode: 'hide' | 'isolate' | 'show', ids?: number[]): Promise<void> {
    const r = await this.rpc.call('setVisibility', { mode, ids });
    useUi.getState().setTab(this.id, { hiddenCount: r.hidden, isolatedCount: r.isolated });
    if (mode !== 'show') this.setSelection([]);
  }

  /** Replace the selection (entity ids) and update the highlight overlay. */
  setSelection(ids: number[]): void {
    const unique = [...new Set(ids)];
    useUi.getState().setTab(this.id, { selection: unique });
    this.rpc.notify('setSelection', { ids: unique });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.historyTimer);
    this.rpc.rejectAll('disposed');
    this.worker.terminate();
    this.canvas.remove();
    this.highlight.remove();
  }
}

/** Live sessions by tab id (kept outside React state; not serializable). */
export const sessions = new Map<string, DocumentSession>();

export async function openFiles(files: Iterable<File>): Promise<void> {
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    openBytes(file.name, bytes);
  }
}

export function openBytes(name: string, bytes: ArrayBuffer): DocumentSession {
  const session = new DocumentSession(name, bytes);
  sessions.set(session.id, session);
  useUi.getState().addTab({ id: session.id, name, status: 'loading', phase: 'parse', progress: 0, layers: [] });
  void session.open();
  return session;
}

export function closeSession(id: string): void {
  sessions.get(id)?.dispose();
  sessions.delete(id);
  useUi.getState().removeTab(id);
}
