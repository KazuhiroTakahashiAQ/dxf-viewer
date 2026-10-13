import { useEffect, useRef, useState } from 'react';
import { BookOpen, CircleHelp, Download, Filter, FolderOpen, Layers, MousePointerClick, Ruler, ScrollText } from 'lucide-react';

import { resolveLocale, setLocale, t, tx, type MessageKey } from '../i18n';
import type { TermId } from '../i18n/glossary';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { openFiles, openHandles, openSources, sessions } from '../session/DocumentSession';
import { chooseFiles, droppedHandles } from './fileOpen';
import { RecentList } from './RecentList';
import { FontDownloadDialog } from './FontDownloadDialog';
import { HelpDialog } from './HelpDialog';
import { tip, TooltipLayer } from './Tooltip';
import { listRecent, loadRecent } from '../storage/recentFiles';
import { addFontFiles } from '../session/userFonts';
import { fontKind } from '../storage/userFonts';
import { decodeFilter } from '../shared/filterSpec';
import { zoomAt } from '../shared/view';
import { activeTab, useUi } from '../state/store';
import { CanvasHost } from './canvas/CanvasHost';
import { LayoutTabs } from './canvas/LayoutTabs';
import { Dock } from './layout/Dock';
import { StatusBar } from './layout/StatusBar';
import { Toolbar } from './layout/Toolbar';
import { PANELS } from './panels/registry';
import { DocTabs } from './tabs/DocTabs';

/** Sample drawings in public/samples (generated with ezdxf) */
const SAMPLES = [
  'basic_entities',
  'japanese_sjis_r2000',
  'jwcad_like_r12',
  'autocad_like_shx',
  'revit_archicad_like',
  'unicode_escapes_r2000',
  'binary',
  'large_offset',
  'minsert_budget',
  'layouts',
  'views_layerstates',
] as const;

/** CAD terms that the sample descriptions use */
const SAMPLE_TERMS: Record<(typeof SAMPLES)[number], TermId[]> = {
  basic_entities: ['entity', 'hatch'],
  japanese_sjis_r2000: ['encoding', 'dxfVersion'],
  jwcad_like_r12: ['dxfVersion'],
  autocad_like_shx: ['shx', 'bigFont'],
  revit_archicad_like: ['trueType'],
  unicode_escapes_r2000: ['formatCodes'],
  binary: ['binaryDxf'],
  large_offset: ['wcs'],
  minsert_budget: ['insert', 'expansionLimit'],
  layouts: ['paperSpace', 'viewport'],
  views_layerstates: ['namedView', 'layerState'],
};

/** [icon, title, description, CAD terms explained on hover] */
const FEATURES: [typeof Layers, MessageKey, MessageKey, TermId[]][] = [
  [MousePointerClick, 'feat.inspect', 'feat.inspect.desc', ['entity', 'groupCode']],
  [Layers, 'feat.layers', 'feat.layers.desc', ['layer', 'layerState', 'block']],
  [Filter, 'feat.filter', 'feat.filter.desc', []],
  [Ruler, 'feat.measure', 'feat.measure.desc', ['snap']],
  [ScrollText, 'feat.document', 'feat.document.desc', ['encoding', 'header']],
  [Download, 'feat.export', 'feat.export.desc', []],
];

const supported = typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

function Welcome() {
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useUi((s) => s.pendingFilter);
  const [loading, setLoading] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState('');
  const openSample = async (name: string) => {
    setLoading(name);
    setSampleError('');
    try {
      const res = await fetch(`samples/${name}.dxf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await openSources([{ name: `${name}.dxf`, bytes: await res.arrayBuffer() }]);
    } catch (e) {
      setSampleError(t('welcome.sampleError', { message: (e as Error).message }));
    } finally {
      setLoading(null);
    }
  };
  return (
    <div className="welcome">
      <h1>{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
      {!supported && <p className="warn-text">{t('welcome.unsupported')}</p>}
      <input
        ref={fileRef}
        type="file"
        accept=".dxf,.DXF,.dwg,.DWG"
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
      <div className="welcome-grid">
        <section>
          <h3>{t('welcome.features')}</h3>
          <div className="feature-list">
            {FEATURES.map(([Icon, title, desc, terms]) => (
              <div key={title} className="feature" {...(terms.length ? tip(t(title), undefined, undefined, { terms, side: true }) : {})}>
                <Icon size={18} />
                <span>
                  <b>{t(title)}</b>
                  <span className="muted small">{t(desc)}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="row-actions">
            <button type="button" className="tb-btn" onClick={() => useUi.getState().setHelpOpen(true)}>
              <CircleHelp size={15} />
              {t('welcome.help')}
            </button>
            <button type="button" className="tb-btn welcome-glossary" onClick={() => useUi.getState().setHelpOpen(true, 'glossary')}>
              <BookOpen size={15} />
              {t('welcome.glossary')}
            </button>
          </div>
        </section>
        {supported && (
          <section>
            <h3>{t('welcome.samples')}</h3>
            <div className="sample-list">
              {SAMPLES.map((name) => (
                <button key={name} type="button" className="sample" disabled={!!loading} onClick={() => void openSample(name)} {...tip(`${name}.dxf`, t(`sample.${name}`), undefined, { terms: SAMPLE_TERMS[name], side: true })}>
                  <span className="mono small">{name}.dxf</span>
                  <span className="muted small">{t(`sample.${name}`)}</span>
                </button>
              ))}
            </div>
            {sampleError && <p className="warn-text small">{sampleError}</p>}
          </section>
        )}
      </div>
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
      if (e.key === '?' || e.key === 'F1') {
        ui.setHelpOpen(!ui.helpOpen);
        e.preventDefault();
        return;
      }
      if (ui.helpOpen) return;
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
      const isDrawing = (name: string, type = '') => /\.(dxf|dwg)$/i.test(name) || /dxf|dwg/.test(type);
      const files = all.filter((f) => isDrawing(f.name, f.type));
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
        const fileHandles = hs.filter((h): h is FileSystemFileHandle => !!h && h.kind === 'file' && isDrawing(h.name));
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

/** UI language: the browser's language unless chosen in Settings. Re-renders the whole tree on change. */
function useLocale(): void {
  const pref = useUi((s) => s.settings.locale);
  const locale = resolveLocale(pref);
  // set before the children render so every t() call of this render uses it
  setLocale(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
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
  useLocale();
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
        {!focusMode && tab && <Dock side="left" panels={PANELS.left} />}
        <div className="center">
          <div className="canvas-area">
            {tab ? (
              <>
                <CanvasHost key={tab.id} tabId={tab.id} />
                <LayoutTabs />
                {tab.status === 'error' && (
                  <div className="canvas-message error">
                    <h3>{t('error.title')}</h3>
                    <p>{tx(tab.error ?? '')}</p>
                  </div>
                )}
              </>
            ) : (
              <Welcome />
            )}
          </div>
          {!focusMode && tab && <Dock side="bottom" panels={PANELS.bottom} />}
        </div>
        {!focusMode && tab && <Dock side="right" panels={PANELS.right} />}
      </div>
      <UrlOpenPrompt />
      <FontDownloadDialog />
      <HelpDialog />
      <TooltipLayer />
      <StatusBar />
      {dropping && <div className="drop-overlay">{t('welcome.drop')}</div>}
      <UpdatePrompt />
    </div>
  );
}
