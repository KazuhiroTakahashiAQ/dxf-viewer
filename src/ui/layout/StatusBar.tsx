import { Minimize } from 'lucide-react';

import { t, tx, type MessageKey } from '../../i18n';
import { activeTab, useUi } from '../../state/store';
import { formatNumber, formatScale, unitName } from '../format';
import { iconTip, termTip, tip } from '../Tooltip';

/** Localized name of a loading phase (unknown phases are shown as is). */
function phaseLabel(phase: string): string {
  const key = `phase.${phase}` as MessageKey;
  const text = t(key);
  return text === key ? phase : text;
}

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
      <span className="coord" {...tip(t('status.coordTip'), t('status.coordDesc'), undefined, { terms: 'wcs' })}>
        <b>{t('status.x')}</b> {cursor ? formatNumber(cursor.x, precision) : '—'}
      </span>
      <span className="coord" {...tip(t('status.coordTip'), t('status.coordDesc'), undefined, { terms: 'wcs' })}>
        <b>{t('status.y')}</b> {cursor ? formatNumber(cursor.y, precision) : '—'}
      </span>
      {unit && <span className="muted" {...termTip('units')}>{unit}</span>}
      {cursor && lastPoint && (
        <span className="coord muted" {...tip(t('status.delta'), t('status.deltaDesc'))}>
          Δ {formatNumber(cursor.x - lastPoint[0], precision)}, {formatNumber(cursor.y - lastPoint[1], precision)} · {formatNumber(Math.hypot(cursor.x - lastPoint[0], cursor.y - lastPoint[1]), precision)}
        </span>
      )}
      <span className="sb-sep" />
      {tab && <span className="muted" {...tip(t('status.scaleTip'), undefined, undefined, { terms: 'units' })}>{t('status.scale', { value: formatScale(1 / scale) + (unit ? ` ${unit}` : '') })}</span>}
      <span className="sb-spacer" />
      {tab?.status === 'loading' && <span>{t('status.loading', { phase: phaseLabel(tab.phase), percent: Math.round(tab.progress * 100) })}</span>}
      {tab?.status === 'error' && <span className="warn-text">{t('status.error', { message: tab.error ?? '' })}</span>}
      {s && <span className="muted" {...termTip('entity')}>{t('status.entities', { count: s.entityCount.toLocaleString() })}</span>}
      {s && (
        <span className="muted" {...tip(t('status.encodingTip'), tx(s.encodingReason), undefined, { terms: 'encoding' })}>
          {s.encoding}
        </span>
      )}
      {tab?.frameMs !== undefined && <span className="muted" {...tip(t('status.renderTip'))}>{t('status.render', { ms: tab.frameMs.toFixed(0) })}</span>}
      {focusMode && (
        <button type="button" className="icon-btn" onClick={() => setFocusMode(false)} {...iconTip(t('status.exitFocus'), undefined, 'Esc')}>
          <Minimize size={14} />
        </button>
      )}
    </div>
  );
}
