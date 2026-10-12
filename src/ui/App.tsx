import { useEffect, useRef, useState } from 'react';
import { Activity, FileText, FolderOpen, Layers } from 'lucide-react';

import { t } from '../i18n';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { openFiles, sessions } from '../session/DocumentSession';
import { zoomAt } from '../shared/view';
import { activeTab, useUi } from '../state/store';
import { CanvasHost } from './canvas/CanvasHost';
import { Dock, type PanelDef } from './layout/Dock';
import { StatusBar } from './layout/StatusBar';
import { Toolbar } from './layout/Toolbar';
import { DiagnosticsPanel } from './panels/DiagnosticsPanel';
import { DocumentPanel } from './panels/DocumentPanel';
import { LayersPanel } from './panels/LayersPanel';
import { DocTabs } from './tabs/DocTabs';

const LEFT: PanelDef[] = [{ id: 'layers', title: 'panel.layers', icon: Layers, component: LayersPanel }];
const RIGHT: PanelDef[] = [{ id: 'document', title: 'panel.document', icon: FileText, component: DocumentPanel }];
const BOTTOM: PanelDef[] = [{ id: 'diagnostics', title: 'panel.diagnostics', icon: Activity, component: DiagnosticsPanel }];

const supported = typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

function Welcome() {
  const fileRef = useRef<HTMLInputElement>(null);
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
      <button type="button" className="primary-btn" disabled={!supported} onClick={() => fileRef.current?.click()}>
        <FolderOpen size={18} />
        {t('welcome.open')}
      </button>
      <p className="muted">{t('welcome.drop')}</p>
      <p className="muted small">{t('welcome.privacy')}</p>
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && ui.focusMode) ui.setFocusMode(false);
      if (!session) return;
      const { width, height } = session.viewport;
      if (e.key === 'f' || e.key === 'F' || e.key === 'Home') session.fit();
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
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /\.dxf$/i.test(f.name) || f.type.includes('dxf'));
      if (files.length) void openFiles(files);
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

/** Re-send render settings when they change. */
function useSettingsSync(): void {
  const settings = useUi((s) => s.settings);
  useEffect(() => {
    sessions.forEach((s) => s.sendSettings(settings));
  }, [settings]);
}

export function App() {
  const tab = useUi(activeTab);
  const focusMode = useUi((s) => s.focusMode);
  const dropping = useFileDrop();
  useGlobalShortcuts();
  useSettingsSync();

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
      <StatusBar />
      {dropping && <div className="drop-overlay">{t('welcome.drop')}</div>}
      <UpdatePrompt />
    </div>
  );
}
