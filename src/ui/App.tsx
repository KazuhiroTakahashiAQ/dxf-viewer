import { useEffect, useRef, useState } from 'react';
import { Activity, Boxes, Camera, Ruler, ScrollText, FileText, Filter, FolderOpen, Layers, ListChecks, ListTree, Search, SlidersHorizontal, Table2, Type, TextSearch } from 'lucide-react';

import { t } from '../i18n';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { openFiles, openHandles, openSources, sessions } from '../session/DocumentSession';
import { chooseFiles, droppedHandles } from './fileOpen';
import { RecentList } from './RecentList';
import { FontDownloadDialog } from './FontDownloadDialog';
import { listRecent, loadRecent } from '../storage/recentFiles';
import { addFontFiles } from '../session/userFonts';
import { fontKind } from '../storage/userFonts';
import { decodeFilter } from '../shared/filterSpec';
import { zoomAt } from '../shared/view';
import { activeTab, useUi } from '../state/store';
import { CanvasHost } from './canvas/CanvasHost';
import { LayoutTabs } from './canvas/LayoutTabs';
import { Dock, type PanelDef } from './layout/Dock';
import { StatusBar } from './layout/StatusBar';
import { Toolbar } from './layout/Toolbar';
import { DiagnosticsPanel } from './panels/DiagnosticsPanel';
import { DocumentPanel } from './panels/DocumentPanel';
import { FilterPanel } from './panels/FilterPanel';
import { FontsPanel } from './panels/FontsPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { RawPanel } from './panels/RawPanel';
import { ResultsPanel } from './panels/ResultsPanel';
import { SearchPanel } from './panels/SearchPanel';
import { BlocksPanel } from './panels/BlocksPanel';
import { StructurePanel } from './panels/StructurePanel';
import { SelectionPanel } from './panels/SelectionPanel';
import { TextsPanel } from './panels/TextsPanel';
import { ViewsPanel } from './panels/ViewsPanel';
import { LayersPanel } from './panels/LayersPanel';
import { MeasurePanel } from './panels/MeasurePanel';
import { DocTabs } from './tabs/DocTabs';

const LEFT: PanelDef[] = [
  { id: 'layers', title: 'panel.layers', icon: Layers, component: LayersPanel },
  { id: 'blocks', title: 'panel.blocks', icon: Boxes, component: BlocksPanel },
  { id: 'filter', title: 'panel.filter', icon: Filter, component: FilterPanel },
  { id: 'search', title: 'panel.search', icon: Search, component: SearchPanel },
  { id: 'views', title: 'panel.views', icon: Camera, component: ViewsPanel },
  { id: 'structure', title: 'panel.structure', icon: ListTree, component: StructurePanel },
];
const RIGHT: PanelDef[] = [
  { id: 'properties', title: 'panel.properties', icon: SlidersHorizontal, component: PropertiesPanel },
  { id: 'selection', title: 'panel.selection', icon: ListChecks, component: SelectionPanel },
  { id: 'measure', title: 'panel.measure', icon: Ruler, component: MeasurePanel },
  { id: 'document', title: 'panel.document', icon: FileText, component: DocumentPanel },
  { id: 'fonts', title: 'panel.fonts', icon: Type, component: FontsPanel },
];
const BOTTOM: PanelDef[] = [
  { id: 'results', title: 'panel.results', icon: Table2, component: ResultsPanel },
  { id: 'texts', title: 'panel.texts', icon: TextSearch, component: TextsPanel },
  { id: 'raw', title: 'panel.raw', icon: ScrollText, component: RawPanel },
  { id: 'diagnostics', title: 'panel.diagnostics', icon: Activity, component: DiagnosticsPanel },
];

const supported = typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

function Welcome() {
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useUi((s) => s.pendingFilter);
  return (
    <div className="welcome">
      <h1>{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
      {!supported && <p className="warn-text">{t('welcome.unsupported')}</p>}
      <input
        ref={fileRef}
        type="file"
        accept=".dxf,.DXF"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void openFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <button type="button" className="primary-btn" disabled={!supported} onClick={() => void chooseFiles(fileRef.current)}>
        <FolderOpen size={18} />
        {t('welcome.open')}
      </button>
      <p className="muted">{t('welcome.drop')}</p>
      <p className="muted small">{t('welcome.privacy')}</p>
      {pending && <p className="notice small">{t('welcome.pendingFilter')}</p>}
      {supported && <RecentList fileInput={fileRef} />}
    </div>
  );
}

function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const ui = useUi.getState();
      const tab = activeTab(ui);
      const session = tab ? sessions.get(tab.id) : undefined;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          if (session) void session.historyGo(e.code === 'ArrowLeft' ? -1 : 1);
          e.preventDefault();
          return;
        }
        if (e.code === 'Digit1') ui.toggleDock('left');
        else if (e.code === 'Digit2') ui.toggleDock('bottom');
        else if (e.code === 'Digit3') ui.toggleDock('right');
        else return;
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyF') {
        ui.setFocusMode(!ui.focusMode);
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA' && session) {
        e.preventDefault();
        void session.rpc.call('selectAll', undefined).then((ids) => session.setSelection(ids));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && ui.focusMode) ui.setFocusMode(false);
      if (!session) return;
      const { width, height } = session.viewport;
      if (e.key === 'm' || e.key === 'M') {
        const on = ui.tool !== 'measure';
        ui.setTool(on ? 'measure' : 'select');
        if (on) ui.setDock('right', { open: true, active: 'measure' });
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'Home') session.fit();
      else if (e.key === '+' || e.key === '=') session.setView(zoomAt(session.view, session.viewport, width / 2, height / 2, 1.25));
      else if (e.key === '-' || e.key === '_') session.setView(zoomAt(session.view, session.viewport, width / 2, height / 2, 0.8));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const handlesP = droppedHandles(e.dataTransfer);
      const all = Array.from(e.dataTransfer.files ?? []);
      const isDxf = (name: string, type = '') => /\.dxf$/i.test(name) || type.includes('dxf');
      const files = all.filter((f) => isDxf(f.name, f.type));
      const fontFiles = all.filter((f) => fontKind(f.name));
      if (fontFiles.length) void addFontFiles(fontFiles);
      const imageFiles = all.filter((f) => /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name));
      const active = sessions.get(useUi.getState().activeId ?? '');
      if (imageFiles.length && active) {
        void active.attachImageFiles(imageFiles);
        useUi.getState().setDock('right', { open: true, active: 'document' });
      }
      if (!files.length) return;
      void handlesP.then((hs) => {
        const fileHandles = hs.filter((h): h is FileSystemFileHandle => !!h && h.kind === 'file' && isDxf(h.name));
        // handles allow reopening from "recent files" later (Chromium)
        if (fileHandles.length === files.length) void openHandles(fileHandles);
        else void openFiles(files);
      });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return over;
}

/**
 * `#filter=…` links carry a filter definition. It is only staged as a proposal
 * (shown in the Filter panel) and never evaluated until the user loads and applies it.
 */
function useSharedFilterLink(): void {
  useEffect(() => {
    const read = () => {
      const m = /^#filter=([A-Za-z0-9_-]+)$/.exec(location.hash);
      if (!m) return;
      history.replaceState(null, '', location.pathname + location.search);
      const f = decodeFilter(m[1]);
      if (!f) return;
      const ui = useUi.getState();
      ui.setPendingFilter(f);
      ui.setDock('left', { open: true, active: 'filter' });
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
}

/** UI theme: system (default), light or dark. */
function useTheme(): void {
  const theme = useUi((s) => s.settings.theme);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
}

/** Close open toolbar menus (<details>) when clicking elsewhere or pressing Escape. */
function useMenuDismiss(): void {
  useEffect(() => {
    const close = (except?: EventTarget | null) => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>('details.tb-menu[open]')) if (!(except instanceof Node && d.contains(except))) d.open = false;
    };
    const onDown = (e: PointerEvent) => close(e.target);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
}

/** PWA file handling (Chromium): files opened with the installed app. */
function useLaunchQueue(): void {
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer(fn: (p: { files?: FileSystemFileHandle[] }) => void): void } }).launchQueue;
    lq?.setConsumer((p) => {
      if (p.files?.length) void openHandles(p.files);
    });
  }, []);
}

const OPEN_TABS_KEY = 'dxfv.openTabs';

/** Remember open tabs and reopen them at startup (only with stored drawings). */
function useTabRestore(): void {
  const tabs = useUi((s) => s.tabs);
  const { recentMode, restoreTabs } = useUi((s) => s.settings);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (recentMode !== 'content' || !restoreTabs) return;
    let hashes: string[] = [];
    try {
      hashes = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) ?? '[]');
    } catch {
      /* ignore */
    }
    if (!hashes.length) return;
    void listRecent().then(async (list) => {
      for (const h of hashes) {
        const e = list.find((x) => x.hash === h && x.stored);
        const data = e && (await loadRecent({ ...e, handle: undefined }));
        if (data) await openSources([{ name: data.name, bytes: data.bytes }]);
      }
    });
  }, [recentMode, restoreTabs]);
  useEffect(() => {
    if (!restored.current) return;
    try {
      if (recentMode === 'content' && restoreTabs) localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs.map((t) => t.hash).filter(Boolean)));
      else localStorage.removeItem(OPEN_TABS_KEY);
    } catch {
      /* ignore */
    }
  }, [tabs, recentMode, restoreTabs]);
}

/** `?url=` asks before downloading a drawing from another site. */
function UrlOpenPrompt() {
  const [url, setUrl] = useState<string | null>(() => {
    const u = new URLSearchParams(location.search).get('url');
    return u && /^https:\/\//i.test(u) ? u : null;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!url) return null;
  const done = () => {
    const params = new URLSearchParams(location.search);
    params.delete('url');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
    setUrl(null);
  };
  return (
    <div className="url-prompt" role="dialog" aria-label={t('url.title')}>
      <b>{t('url.title')}</b>
      <p className="mono small url-text">{url}</p>
      <p className="muted small">{t('url.help')}</p>
      {error && <p className="warn-text small">{error}</p>}
      <div className="row-actions">
        <button
          type="button"
          className="primary-btn small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const bytes = await res.arrayBuffer();
              const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'drawing.dxf');
              await openSources([{ name, bytes }]);
              done();
            } catch (e) {
              setError(t('url.error', { message: (e as Error).message }));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('url.open')}
        </button>
        <button type="button" className="tb-btn" onClick={done}>
          {t('url.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Re-send render and font settings when they change. */
function useSettingsSync(): void {
  const settings = useUi((s) => s.settings);
  const { preferLocalFonts, fontOverrides } = settings;
  const first = useRef(true);
  useEffect(() => {
    sessions.forEach((s) => s.sendSettings(settings));
  }, [settings]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      sessions.forEach((s) => {
        if (s.summary) void s.rpc.call('setFontOptions', { preferLocal: preferLocalFonts, overrides: fontOverrides });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [preferLocalFonts, fontOverrides]);
}

export function App() {
  const tab = useUi(activeTab);
  const focusMode = useUi((s) => s.focusMode);
  const dropping = useFileDrop();
  useGlobalShortcuts();
  useSettingsSync();
  useSharedFilterLink();
  useLaunchQueue();
  useMenuDismiss();
  useTheme();
  useTabRestore();

  return (
    <div className={`app ${focusMode ? 'focus-mode' : ''}`}>
      {!focusMode && <Toolbar />}
      {!focusMode && <DocTabs />}
      <div className="workspace">
        {!focusMode && tab && <Dock side="left" panels={LEFT} />}
        <div className="center">
          <div className="canvas-area">
            {tab ? (
              <>
                <CanvasHost key={tab.id} tabId={tab.id} />
                <LayoutTabs />
                {tab.status === 'error' && (
                  <div className="canvas-message error">
                    <h3>{t('error.title')}</h3>
                    <p>{tab.error}</p>
                  </div>
                )}
              </>
            ) : (
              <Welcome />
            )}
          </div>
          {!focusMode && tab && <Dock side="bottom" panels={BOTTOM} />}
        </div>
        {!focusMode && tab && <Dock side="right" panels={RIGHT} />}
      </div>
      <UrlOpenPrompt />
      <FontDownloadDialog />
      <StatusBar />
      {dropping && <div className="drop-overlay">{t('welcome.drop')}</div>}
      <UpdatePrompt />
    </div>
  );
}
