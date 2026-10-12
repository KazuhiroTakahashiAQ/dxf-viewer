import { useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Maximize,
  Minus,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCcw,
  RotateCw,
  Ruler,
  Scan,
} from 'lucide-react';

import { t } from '../../i18n';
import { ENCODING_CHOICES } from '../../dxf/reader/encoding';
import { openFiles, sessions } from '../../session/DocumentSession';
import { chooseFiles } from '../fileOpen';
import { RecentList } from '../RecentList';
import { ExportMenu } from './ExportMenu';
import { SettingsMenu } from './SettingsMenu';
import { normalizeAngle, rotateView, rotationForDirection, zoomAt } from '../../shared/view';
import { activeTab, useUi, type ViewerSettings } from '../../state/store';
import { rgbCss } from '../format';

const BACKGROUNDS = [0x16181d, 0x000000, 0x212830, 0xffffff, 0xf3f1ea];

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const tab = useUi(activeTab);
  const toggleDock = useUi((s) => s.toggleDock);
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const setFocusMode = useUi((s) => s.setFocusMode);
  const settings = useUi((s) => s.settings);
  const updateSettings = useUi((s) => s.updateSettings);
  const session = tab ? sessions.get(tab.id) : undefined;

  const zoom = (f: number) => {
    if (!session) return;
    session.setView(zoomAt(session.view, session.viewport, session.viewport.width / 2, session.viewport.height / 2, f));
  };

  const orient = tab?.viewOrient ?? { rotation: 0, mirrorX: false, mirrorY: false };
  const rotDeg = Number(((normalizeAngle(orient.rotation) * 180) / Math.PI).toFixed(4));
  const rotate = (delta: number) => session && session.setView(rotateView(session.view, delta));
  const setRotation = (rad: number) => session && session.setView({ ...session.view, rotation: normalizeAngle(rad) });
  const alignToSelection = async () => {
    const id = tab?.selection?.[0];
    if (!session || id === undefined) return;
    const a = await session.rpc.call('entityAngle', { id });
    if (a !== null) setRotation(rotationForDirection(a, session.view.mirrorX !== session.view.mirrorY));
  };
  const fileTwist = tab?.summary?.initialView?.twist ?? 0;

  const setSetting = (patch: Partial<ViewerSettings>) => {
    updateSettings(patch);
    const s = useUi.getState().settings;
    sessions.forEach((x) => x.sendSettings(s));
  };

  return (
    <div className="toolbar" role="toolbar">
      <input
        ref={fileRef}
        type="file"
        accept=".dxf,.DXF,application/dxf,image/vnd.dxf"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void openFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <button type="button" className="tb-btn" onClick={() => void chooseFiles(fileRef.current)} title={t('welcome.open')}>
        <FolderOpen size={16} />
        <span>{t('toolbar.open')}</span>
      </button>
      <details className="tb-menu recent-menu">
        <summary title={t('recent.title')}>▾</summary>
        <div className="menu-pop">
          <RecentList fileInput={fileRef} compact />
        </div>
      </details>
      <span className="tb-sep" />
      <button type="button" className="icon-btn" disabled={!session} onClick={() => session?.fit()} title={t('toolbar.fit')}>
        <Scan size={16} />
      </button>
      <button type="button" className="icon-btn" disabled={!session} onClick={() => zoom(1.5)} title={t('toolbar.zoomIn')}>
        <Plus size={16} />
      </button>
      <button type="button" className="icon-btn" disabled={!session} onClick={() => zoom(1 / 1.5)} title={t('toolbar.zoomOut')}>
        <Minus size={16} />
      </button>
      <button type="button" className="icon-btn" disabled={!tab?.viewNav?.back} onClick={() => void session?.historyGo(-1)} title={t('toolbar.viewBack')}>
        <ArrowLeft size={16} />
      </button>
      <button type="button" className="icon-btn" disabled={!tab?.viewNav?.forward} onClick={() => void session?.historyGo(1)} title={t('toolbar.viewForward')}>
        <ArrowRight size={16} />
      </button>
      <span className="tb-sep" />
      <button
        type="button"
        className={`icon-btn toggle ${tool === 'measure' ? 'on' : ''}`}
        aria-pressed={tool === 'measure'}
        disabled={!session}
        onClick={() => {
          const on = tool !== 'measure';
          setTool(on ? 'measure' : 'select');
          if (on) useUi.getState().setDock('right', { open: true, active: 'measure' });
        }}
        title={t('toolbar.measure')}
      >
        <Ruler size={16} />
      </button>
      <span className="tb-sep" />
      <button type="button" className="icon-btn" disabled={!session} onClick={() => rotate(Math.PI / 2)} title={t('toolbar.rotateCcw')}>
        <RotateCcw size={16} />
      </button>
      <button type="button" className="icon-btn" disabled={!session} onClick={() => rotate(-Math.PI / 2)} title={t('toolbar.rotateCw')}>
        <RotateCw size={16} />
      </button>
      <details className="tb-menu">
        <summary className={rotDeg !== 0 || orient.mirrorX || orient.mirrorY ? 'tb-active' : ''}>
          {t('toolbar.view')}
          {rotDeg !== 0 && <span className="muted small"> {rotDeg}°</span>}
          {(orient.mirrorX || orient.mirrorY) && <span className="muted small"> ⇋</span>}
        </summary>
        <div className="menu-pop">
          <label>
            {t('view.rotation')}
            <input
              type="number"
              step={1}
              className="num-input"
              disabled={!session}
              value={rotDeg}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setRotation((v * Math.PI) / 180);
              }}
            />
            °
          </label>
          <button type="button" className="menu-item" disabled={!tab?.selection?.length} onClick={() => void alignToSelection()}>
            {t('view.alignSelection')}
          </button>
          <button type="button" className="menu-item" disabled={!session || !fileTwist} onClick={() => setRotation((fileTwist * Math.PI) / 180)}>
            {t('view.alignFile', { deg: Number(fileTwist.toFixed(4)) })}
          </button>
          <label>
            <input type="checkbox" disabled={!session} checked={orient.mirrorX} onChange={(e) => session?.setView({ ...session.view, mirrorX: e.target.checked })} />
            <FlipHorizontal2 size={14} />
            {t('view.mirrorX')}
          </label>
          <label>
            <input type="checkbox" disabled={!session} checked={orient.mirrorY} onChange={(e) => session?.setView({ ...session.view, mirrorY: e.target.checked })} />
            <FlipVertical2 size={14} />
            {t('view.mirrorY')}
          </label>
          <button type="button" className="menu-item" disabled={!session} onClick={() => session?.setView({ ...session.view, rotation: 0, mirrorX: false, mirrorY: false })}>
            {t('view.resetOrientation')}
          </button>
          <p className="muted small">{t('view.wcsNote')}</p>
        </div>
      </details>
      <span className="tb-sep" />
      <label className="tb-field" title={t('toolbar.encoding')}>
        <span className="tb-label">{t('toolbar.encoding')}</span>
        <select
          disabled={!tab || tab.status === 'loading' || tab.summary?.binary}
          value={tab?.encoding ?? ''}
          onChange={(e) => {
            if (!session || !tab) return;
            const enc = e.target.value || undefined;
            void session.reopenWithEncoding(enc);
          }}
        >
          <option value="">{t('toolbar.encodingAuto', { detected: tab?.encoding ? '…' : (tab?.summary?.encoding ?? '…') })}</option>
          {ENCODING_CHOICES.map((enc) => (
            <option key={enc} value={enc}>
              {enc}
            </option>
          ))}
        </select>
      </label>
      <span className="tb-sep" />
      <div className="tb-group" title={t('toolbar.background')}>
        {BACKGROUNDS.map((bg) => (
          <button
            key={bg}
            type="button"
            className={`bg-swatch ${settings.background === bg ? 'active' : ''}`}
            style={{ background: rgbCss(bg) }}
            aria-label={`${t('toolbar.background')} ${rgbCss(bg)}`}
            onClick={() => setSetting({ background: bg })}
          />
        ))}
      </div>
      <details className="tb-menu">
        <summary>{t('toolbar.display')}</summary>
        <div className="menu-pop">
          <label>
            {t('display.lineweights')}
            <select value={settings.lineweights} onChange={(e) => setSetting({ lineweights: e.target.value as ViewerSettings['lineweights'] })}>
              <option value="file">{t('display.lineweights.file')}</option>
              <option value="on">{t('display.lineweights.on')}</option>
              <option value="off">{t('display.lineweights.off')}</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={settings.linetypes} onChange={(e) => setSetting({ linetypes: e.target.checked })} />
            {t('display.linetypes')}
          </label>
          <label>
            <input type="checkbox" checked={settings.fills} onChange={(e) => setSetting({ fills: e.target.checked })} />
            {t('display.fills')}
          </label>
          <label>
            <input type="checkbox" checked={settings.texts} onChange={(e) => setSetting({ texts: e.target.checked })} />
            {t('display.texts')}
          </label>
          <label>
            <input type="checkbox" checked={settings.monochrome} onChange={(e) => setSetting({ monochrome: e.target.checked })} />
            {t('display.monochrome')}
          </label>
          <label>
            <input type="checkbox" checked={settings.xray} onChange={(e) => setSetting({ xray: e.target.checked })} />
            {t('display.xray')}
          </label>
          <label>
            <input type="checkbox" checked={settings.ghostOff} onChange={(e) => setSetting({ ghostOff: e.target.checked })} />
            {t('display.ghostOff')}
          </label>
          <hr />
          <label>
            <input type="checkbox" checked={settings.showBBoxes} onChange={(e) => setSetting({ showBBoxes: e.target.checked })} />
            {t('display.bboxes')}
          </label>
          <label>
            <input type="checkbox" checked={settings.showInsertionPoints} onChange={(e) => setSetting({ showInsertionPoints: e.target.checked })} />
            {t('display.insertionPoints')}
          </label>
          <label>
            <input type="checkbox" checked={settings.showControlPoints} onChange={(e) => setSetting({ showControlPoints: e.target.checked })} />
            {t('display.controlPoints')}
          </label>
          <hr />
          <label>
            <input type="checkbox" checked={settings.showGrid} onChange={(e) => updateSettings({ showGrid: e.target.checked })} />
            {t('display.grid')}
          </label>
          <label>
            <input type="checkbox" checked={settings.showAxes} onChange={(e) => updateSettings({ showAxes: e.target.checked })} />
            {t('display.axes')}
          </label>
          <label>
            <input type="checkbox" checked={settings.showScaleBar} onChange={(e) => updateSettings({ showScaleBar: e.target.checked })} />
            {t('display.scaleBar')}
          </label>
        </div>
      </details>
      <span className="tb-spacer" />
      <ExportMenu />
      <SettingsMenu />
      <button type="button" className="icon-btn" onClick={() => toggleDock('left')} title={t('toolbar.leftDock')}>
        <PanelLeft size={16} />
      </button>
      <button type="button" className="icon-btn" onClick={() => toggleDock('bottom')} title={t('toolbar.bottomDock')}>
        <PanelBottom size={16} />
      </button>
      <button type="button" className="icon-btn" onClick={() => toggleDock('right')} title={t('toolbar.rightDock')}>
        <PanelRight size={16} />
      </button>
      <button type="button" className="icon-btn" onClick={() => setFocusMode(true)} title={t('toolbar.focus')}>
        <Maximize size={16} />
      </button>
    </div>
  );
}
