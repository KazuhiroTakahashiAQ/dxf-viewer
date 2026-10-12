import { useState } from 'react';
import { EyeOff, Filter, Focus, FlipHorizontal2, RotateCw, Boxes, X } from 'lucide-react';

import { t } from '../../i18n';
import type { TermId } from '../../i18n/glossary';
import { sessions } from '../../session/DocumentSession';
import { normalizeAngle } from '../../shared/view';
import { useUi } from '../../state/store';
import { termTip } from '../Tooltip';

/**
 * Bar at the top of the drawing that names every state which hides or changes
 * what is drawn (isolation, hidden entities, "show only" filters, a block shown
 * alone, a rotated / mirrored view), each with a button that undoes it.
 */
export function CanvasStateBar({ tabId }: { tabId: string }) {
  const tab = useUi((s) => s.tabs.find((x) => x.id === tabId));
  const session = sessions.get(tabId);
  if (!tab || !session || tab.status !== 'ready') return null;
  const chips: { key: string; icon: typeof Focus; text: string; action: string; run: () => void; term?: TermId }[] = [];
  const showAll = () => void session.setVisibility('show');
  if (tab.isolatedCount) chips.push({ key: 'iso', icon: Focus, text: t('state.isolated', { count: tab.isolatedCount.toLocaleString() }), action: t('state.showAll'), run: showAll, term: 'isolate' });
  if (tab.hiddenCount) chips.push({ key: 'hid', icon: EyeOff, text: t('state.hidden', { count: tab.hiddenCount.toLocaleString() }), action: t('state.showAll'), run: showAll });
  const f = tab.filterApplied;
  if (f && tab.filterResult && (f.mode === 'show' || f.mode === 'highlight')) {
    chips.push({
      key: 'filter',
      icon: Filter,
      text: t(f.mode === 'show' ? 'state.filterShow' : 'state.filterHighlight', { count: tab.filterResult.count.toLocaleString() }),
      action: t('state.clearFilter'),
      run: () => void session.applyFilter(null),
    });
  }
  if (tab.layout?.startsWith('§')) chips.push({ key: 'block', icon: Boxes, text: t('state.blockView', { name: tab.layout.slice(1) }), action: t('state.backToModel'), run: () => void session.setLayout('Model'), term: 'block' });
  const o = tab.viewOrient;
  if (o && (normalizeAngle(o.rotation) !== 0 || o.mirrorX || o.mirrorY)) {
    const deg = Number(((normalizeAngle(o.rotation) * 180) / Math.PI).toFixed(2));
    const parts = [deg ? t('state.rotated', { deg }) : '', o.mirrorX || o.mirrorY ? t('state.mirrored') : ''].filter(Boolean);
    chips.push({
      key: 'orient',
      icon: o.mirrorX || o.mirrorY ? FlipHorizontal2 : RotateCw,
      text: parts.join(' · '),
      action: t('state.resetView'),
      run: () => session.setView({ ...session.view, rotation: 0, mirrorX: false, mirrorY: false }),
      term: 'wcs',
    });
  }
  if (!chips.length) return null;
  return (
    <div className="canvas-state" role="status">
      {chips.map((c) => (
        <div key={c.key} className={`state-chip state-${c.key}`}>
          <c.icon size={13} />
          <span className={c.term ? 'term' : undefined} {...(c.term ? termTip(c.term) : {})}>
            {c.text}
          </span>
          <button type="button" className="tb-btn small-btn" onClick={c.run}>
            {c.action}
          </button>
        </div>
      ))}
    </div>
  );
}

const HINT_KEY = 'dxfv.hintSeen.v1';

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** One-time card with the basic mouse operations, shown with the first drawing. */
export function CanvasHints() {
  const [open, setOpen] = useState(() => !hintSeen());
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="canvas-hints" role="note">
      <div className="canvas-hints-head">
        <b>{t('hint.title')}</b>
        <button type="button" className="icon-btn" aria-label={t('hint.dismiss')} onClick={close}>
          <X size={13} />
        </button>
      </div>
      <p>{t('hint.navigate')}</p>
      <p>{t('hint.select')}</p>
      <p className="muted">{t('hint.more')}</p>
      <div className="row-actions">
        <button type="button" className="tb-btn small-btn" onClick={() => useUi.getState().setHelpOpen(true)}>
          {t('toolbar.help')}
        </button>
        <button type="button" className="primary-btn small" onClick={close}>
          {t('hint.dismiss')}
        </button>
      </div>
    </div>
  );
}
