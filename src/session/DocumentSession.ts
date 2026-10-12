import type { DocApi, DocEvents, DocSummary, RenderSettings } from '../shared/docApi';
import { RpcClient } from '../shared/rpc';
import { DEFAULT_VIEW, fitView, screenDelta, type ViewState, type Viewport } from '../shared/view';
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
  private worker: Worker;
  readonly rpc: RpcClient<DocApi, DocEvents>;
  private bytes: ArrayBuffer;
  view: ViewState = DEFAULT_VIEW;
  viewport: Viewport = { width: 1, height: 1, dpr: 1 };
  summary: DocSummary | null = null;
  private viewSeq = 0;
  private sentViews = new Map<number, ViewState>();
  private renderedView: ViewState | null = null;
  private pendingSend = false;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(name: string, bytes: ArrayBuffer) {
    this.id = `doc-${++seq}-${Date.now().toString(36)}`;
    this.name = name;
    this.bytes = bytes;
    this.worker = new Worker(new URL('../worker/docWorker.ts', import.meta.url), { type: 'module', name: `dxf:${name}` });
    this.rpc = new RpcClient<DocApi, DocEvents>(this.worker);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'doc-canvas';
    const off = this.canvas.transferControlToOffscreen();
    void this.rpc.call('attachCanvas', { canvas: off }, [off]);

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
      const summary = await this.rpc.call('open', { bytes: copy, name: this.name, encoding, baseUrl: new URL('./', document.baseURI).href }, [copy]);
      this.summary = summary;
      ui.setTab(this.id, { status: 'ready', summary });
      this.sendSettings(useUi.getState().settings);
      this.fit();
      const layers = await this.rpc.call('getLayers', undefined);
      useUi.getState().setTab(this.id, { layers });
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

  fit(): void {
    const ext = this.summary?.extents;
    if (!ext) {
      this.setView({ ...DEFAULT_VIEW, rotation: this.view.rotation, mirrorX: this.view.mirrorX, mirrorY: this.view.mirrorY });
      return;
    }
    this.setView(fitView(ext, this.viewport, this.view));
  }

  setView(v: ViewState): void {
    this.view = v;
    useUi.getState().setScale(v.scale);
    this.applyPreview();
    this.listeners.forEach((fn) => fn());
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

  onViewChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Transform the last rendered frame to the current view until the worker catches up. */
  private applyPreview(): void {
    const from = this.renderedView;
    if (!from) {
      this.canvas.style.transform = '';
      return;
    }
    const m = screenDelta(from, this.view, this.viewport);
    const identity = Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[4]) < 0.01 && Math.abs(m[5]) < 0.01;
    this.canvas.style.transform = identity ? '' : `matrix(${m.join(',')})`;
  }

  async reopenWithEncoding(encoding: string | undefined): Promise<void> {
    this.renderedView = null;
    await this.open(encoding);
  }

  dispose(): void {
    this.disposed = true;
    this.rpc.rejectAll('disposed');
    this.worker.terminate();
    this.canvas.remove();
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
