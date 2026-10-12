import { useEffect, useRef } from 'react';
import { BookOpen, Download, Eye, FolderOpen, Monitor, Ruler, Settings, X, type LucideIcon } from 'lucide-react';

import { t, type MessageKey } from '../i18n';
import { term, TERM_GROUPS } from '../i18n/glossary';
import { useUi, type DockSide } from '../state/store';
import { DOCK_KEYS, PANELS } from './panels/registry';
import { Keys, tip } from './Tooltip';

/** [what, how]: `how` is either a message (mouse gestures) or literal shortcut keys */
const OPERATIONS: [MessageKey, { text: MessageKey } | { keys: string }][] = [
  ['help.op.fit', { text: 'help.op.fit.keys' }],
  ['help.op.zoom', { text: 'help.op.zoom.keys' }],
  ['help.op.pan', { text: 'help.op.pan.keys' }],
  ['help.op.select', { text: 'help.op.select.keys' }],
  ['help.op.window', { text: 'help.op.window.keys' }],
  ['help.op.addSel', { text: 'help.op.addSel.keys' }],
  ['help.op.selectAll', { keys: 'Ctrl+A' }],
  ['help.op.menu', { text: 'help.op.menu.keys' }],
  ['help.op.measure', { keys: 'M' }],
  ['help.op.history', { keys: 'Alt+← / Alt+→' }],
  ['help.op.panels', { keys: 'Alt+1 / Alt+2 / Alt+3' }],
  ['help.op.focus', { keys: 'Ctrl+Shift+F' }],
  ['help.op.escape', { keys: 'Esc' }],
  ['help.op.help', { keys: '? / F1' }],
];

const TOOLBAR: [LucideIcon, MessageKey, MessageKey][] = [
  [FolderOpen, 'toolbar.open', 'tip.open'],
  [Ruler, 'toolbar.measure', 'tip.measure'],
  [Eye, 'toolbar.view', 'tip.view'],
  [Monitor, 'toolbar.display', 'tip.display'],
  [Download, 'export.title', 'tip.export'],
  [Settings, 'settings.title', 'tip.settings'],
];

const TIPS: MessageKey[] = ['help.tip.hidden', 'help.tip.handles', 'help.tip.encoding', 'help.tip.drop', 'help.tip.share'];
const SIDES: DockSide[] = ['left', 'right', 'bottom'];

/** Overview of features, panels and operations (toolbar “?”, the ? key or F1). */
export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const section = useUi((s) => s.helpSection);
  const setOpen = useUi((s) => s.setHelpOpen);
  const hasTab = useUi((s) => !!s.activeId);
  const glossaryRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open && section === 'glossary') glossaryRef.current?.scrollIntoView({ block: 'start' });
  }, [open, section]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open) return null;
  const openPanel = (side: DockSide, id: string) => {
    const ui = useUi.getState();
    ui.setFocusMode(false);
    ui.setDock(side, { open: true, active: id });
    setOpen(false);
  };
  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal help-modal" role="dialog" aria-modal="true" aria-label={t('help.title')}>
        <div className="modal-head">
          <b>{t('help.title')}</b>
          <span className="tb-spacer" />
          <button type="button" className="icon-btn" aria-label={t('help.close')} onClick={() => setOpen(false)} autoFocus>
            <X size={16} />
          </button>
        </div>
        <p className="muted small">{t('help.intro')}</p>
        <button type="button" className="link-inline small help-jump" onClick={() => glossaryRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
          <BookOpen size={13} />
          {t('help.glossaryJump')}
        </button>

        <h3>{t('help.mouse')}</h3>
        <table className="kv help-ops">
          <tbody>
            {OPERATIONS.map(([what, how]) => (
              <tr key={what}>
                <th>{t(what)}</th>
                <td>{'keys' in how ? <Keys keys={how.keys} /> : t(how.text)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>{t('help.panels')}</h3>
        {hasTab && <p className="muted small">{t('help.panelsHint')}</p>}
        <div className="help-docks">
          {SIDES.map((side) => (
            <div key={side} className="help-dock">
              <div className="help-dock-head">
                <b>{t(`help.side.${side}` as MessageKey)}</b>
                <Keys keys={DOCK_KEYS[side]} />
              </div>
              {PANELS[side].map((p) => (
                <button key={p.id} type="button" className="help-item" disabled={!hasTab} onClick={() => openPanel(side, p.id)} {...(p.terms ? tip(t(p.title), undefined, undefined, { terms: p.terms, side: true }) : {})}>
                  <p.icon size={15} />
                  <span>
                    <b>{t(p.title)}</b>
                    <span className="muted small">{t(p.desc)}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <h3>{t('help.menus')}</h3>
        <div className="help-docks">
          {TOOLBAR.map(([Icon, title, desc]) => (
            <div key={title} className="help-item static">
              <Icon size={15} />
              <span>
                <b>{t(title)}</b>
                <span className="muted small">{t(desc)}</span>
              </span>
            </div>
          ))}
        </div>

        <h3>{t('help.tips')}</h3>
        <ul className="help-tips small">
          {TIPS.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>

        <h3 id="help-glossary" ref={glossaryRef}>
          {t('help.glossary')}
        </h3>
        <p className="muted small">{t('help.glossaryIntro')}</p>
        {TERM_GROUPS.map(([group, ids]) => (
          <div key={group} className="glossary-group">
            <h4>{t(`glossary.group.${group}`)}</h4>
            <dl className="glossary small">
              {ids.map((id) => {
                const tm = term(id);
                return (
                  <div key={id} className="glossary-entry">
                    <dt>{tm.name}</dt>
                    <dd>{tm.desc}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
