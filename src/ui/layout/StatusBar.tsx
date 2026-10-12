import { Minimize } from 'lucide-react';

import { t } from '../../i18n';
import { activeTab, useUi } from '../../state/store';
import { formatNumber, formatScale, unitName } from '../format';

export function StatusBar() {
  const tab = useUi(activeTab);
  const cursor = useUi((s) => s.cursor);
  const lastPoint = useUi((s) => s.lastPoint);
  const scale = useUi((s) => s.scale);
  const focusMode = useUi((s) => s.focusMode);
  const setFocusMode = useUi((s) => s.setFocusMode);
  const coordPrecision = useUi((s) => s.settings.coordPrecision);
  const s = tab?.summary;
  const precision = coordPrecision >= 0 ? coordPrecision : Math.max(2, Math.min(8, s?.luprec ?? 4));
  const unit = unitName(s?.insUnits);
  return (
    <div className="status-bar" role="status">
      <span className="coord" aria-label="cursor coordinates">
        <b>{t('status.x')}</b> {cursor ? formatNumber(cursor.x, precision) : '—'}
      </span>
      <span className="coord">
        <b>{t('status.y')}</b> {cursor ? formatNumber(cursor.y, precision) : '—'}
      </span>
      {unit && <span className="muted">{unit}</span>}
      {cursor && lastPoint && (
        <span className="coord muted" title={t('status.delta')}>
          Δ {formatNumber(cursor.x - lastPoint[0], precision)}, {formatNumber(cursor.y - lastPoint[1], precision)} · {formatNumber(Math.hypot(cursor.x - lastPoint[0], cursor.y - lastPoint[1]), precision)}
        </span>
      )}
      <span className="sb-sep" />
      {tab && <span className="muted">{t('status.scale', { value: formatScale(1 / scale) + (unit ? ` ${unit}` : '') })}</span>}
      <span className="sb-spacer" />
      {tab?.status === 'loading' && <span>{t('status.loading', { phase: tab.phase, percent: Math.round(tab.progress * 100) })}</span>}
      {tab?.status === 'error' && <span className="warn-text">{t('status.error', { message: tab.error ?? '' })}</span>}
      {s && <span className="muted">{t('status.entities', { count: s.entityCount.toLocaleString() })}</span>}
      {s && (
        <span className="muted" title={s.encodingReason}>
          {s.encoding}
        </span>
      )}
      {tab?.frameMs !== undefined && <span className="muted">{t('status.render', { ms: tab.frameMs.toFixed(0) })}</span>}
      {focusMode && (
        <button type="button" className="icon-btn" onClick={() => setFocusMode(false)} title={t('toolbar.focus')}>
          <Minimize size={14} />
        </button>
      )}
    </div>
  );
}
