import { Settings } from 'lucide-react';

import { t } from '../../i18n';
import { clearRecent, dropStoredContent, type RecentMode } from '../../storage/recentFiles';
import { clearPerFileData } from '../../storage/perFile';
import { useUi } from '../../state/store';

/** Privacy and input settings. */
export function SettingsMenu() {
  const settings = useUi((s) => s.settings);
  const update = useUi((s) => s.updateSettings);
  const bump = useUi((s) => s.bumpRecent);
  const setMode = async (mode: RecentMode) => {
    if (mode === settings.recentMode) return;
    if (mode === 'content' && !window.confirm(t('settings.storeWarning', { origin: location.origin }))) return;
    if (settings.recentMode === 'content') await dropStoredContent();
    if (mode === 'off') await clearRecent();
    update({ recentMode: mode, restoreTabs: mode === 'content' ? settings.restoreTabs : false });
    bump();
  };
  return (
    <details className="tb-menu">
      <summary title={t('settings.title')} aria-label={t('settings.title')}>
        <Settings size={16} />
      </summary>
      <div className="menu-pop settings-pop">
        <b>{t('settings.recent')}</b>
        {(['off', 'meta', 'content'] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="recent-mode" checked={settings.recentMode === m} onChange={() => void setMode(m)} />
            {t(`settings.recent.${m}` as never)}
          </label>
        ))}
        <label className={settings.recentMode !== 'content' ? 'disabled' : ''}>
          <input type="checkbox" disabled={settings.recentMode !== 'content'} checked={settings.restoreTabs} onChange={(e) => update({ restoreTabs: e.target.checked })} />
          {t('settings.restoreTabs')}
        </label>
        <p className="muted small">{t('settings.recentHelp')}</p>
        <button
          type="button"
          className="menu-item"
          onClick={async () => {
            if (!window.confirm(t('settings.clearConfirm'))) return;
            await clearRecent();
            clearPerFileData();
            bump();
          }}
        >
          {t('settings.clear')}
        </button>
        <hr />
        <b>{t('settings.input')}</b>
        <label>
          <input type="checkbox" checked={settings.trackpadPan} onChange={(e) => update({ trackpadPan: e.target.checked })} />
          {t('settings.trackpadPan')}
        </label>
        <label>
          {t('settings.precision')}
          <select value={settings.coordPrecision} onChange={(e) => update({ coordPrecision: Number(e.target.value) })}>
            <option value={-1}>{t('settings.precision.auto')}</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
