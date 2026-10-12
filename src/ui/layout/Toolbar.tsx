import { useRef } from 'react';
import {
  FolderOpen,
  Maximize,
  Minus,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  Scan,
} from 'lucide-react';

import { t } from '../../i18n';
import { ENCODING_CHOICES } from '../../dxf/reader/encoding';
import { openFiles, sessions } from '../../session/DocumentSession';
import { zoomAt } from '../../shared/view';
import { activeTab, useUi, type ViewerSettings } from '../../state/store';
import { rgbCss } from '../format';

const BACKGROUNDS = [0x16181d, 0x000000, 0x212830, 0xffffff, 0xf3f1ea];

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const tab = useUi(activeTab);
  const toggleDock = useUi((s) => s.toggleDock);
  const setFocusMode = useUi((s) => s.setFocusMode);
  const settings = useUi((s) => s.settings);
  const updateSettings = useUi((s) => s.updateSettings);
  const session = tab ? sessions.get(tab.id) : undefined;

  const zoom = (f: number) => {
    if (!session) return;
    session.setView(zoomAt(session.view, session.viewport, session.viewport.width / 2, session.viewport.height / 2, f));
  };

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
      <button type="button" className="tb-btn" onClick={() => fileRef.current?.click()} title={t('welcome.open')}>
        <FolderOpen size={16} />
        <span>{t('toolbar.open')}</span>
      </button>
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
        </div>
      </details>
      <span className="tb-spacer" />
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
