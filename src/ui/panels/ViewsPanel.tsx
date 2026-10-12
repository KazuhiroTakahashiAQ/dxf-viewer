import { useEffect, useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { NamedView } from '../../shared/docApi';
import { normalizeAngle } from '../../shared/view';
import { savedViews, setSavedViews, type SavedView } from '../../storage/perFile';
import { activeTab, useUi } from '../../state/store';
import { iconTip, Term, tip } from '../Tooltip';

const fmt = (v: number) => String(Number(v.toPrecision(6)));

/** Show a world-space window (center, width × height in view axes) with the given twist. */
function showWindow(s: DocumentSession, cx: number, cy: number, width: number, height: number, rotation: number): void {
  const { width: W, height: H } = s.viewport;
  const sx = width > 0 ? W / width : Infinity;
  const sy = height > 0 ? H / height : Infinity;
  let scale = Math.min(sx, sy);
  if (!Number.isFinite(scale) || scale <= 0) scale = s.view.scale;
  s.setView({ ...s.view, cx, cy, scale, rotation: normalizeAngle(rotation) });
}

export function ViewsPanel() {
  const tab = useUi(activeTab);
  const session = tab ? sessions.get(tab.id) : undefined;
  const hash = tab?.summary?.hash;
  const [named, setNamed] = useState<NamedView[]>([]);
  const [saved, setSaved] = useState<SavedView[]>([]);
  const ready = tab?.status === 'ready';

  useEffect(() => {
    if (!session || !ready) return;
    let alive = true;
    void session.rpc.call('namedViews', undefined).then((v) => alive && setNamed(v));
    return () => {
      alive = false;
    };
  }, [session, ready]);
  useEffect(() => setSaved(savedViews(hash)), [hash]);

  if (!tab || !session) return <div className="panel-empty">—</div>;
  const iv = tab.summary?.initialView;
  const paperLayout = tab.layouts?.find((l) => l.kind === 'paper')?.name;

  const goNamed = async (v: NamedView) => {
    if (v.paperSpace && session.layout === 'Model' && paperLayout) await session.setLayout(paperLayout);
    else if (!v.paperSpace && session.layout !== 'Model') await session.setLayout('Model');
    showWindow(session, v.cx, v.cy, v.width, v.height, v.twist);
  };
  const goSaved = async (v: SavedView) => {
    if (v.layout !== session.layout && tab.layouts?.some((l) => l.name === v.layout)) await session.setLayout(v.layout);
    session.setView(v.view);
  };
  const save = () => {
    if (!hash) return;
    const name = prompt(t('views.saveName'), t('views.defaultName', { n: saved.length + 1 }));
    if (!name) return;
    const next = [...saved.filter((x) => x.name !== name), { name, layout: session.layout, view: session.view }];
    setSaved(next);
    setSavedViews(hash, next);
  };

  return (
    <div className="panel panel-scroll">
      <div className="panel-section">
        <div className="section-head">
          <b>
            <Term id="namedView">{t('views.file')}</Term>
          </b>
          <span className="muted small">VIEW</span>
        </div>
        {iv && (
          <div className="view-row">
            <button type="button" className="link-inline" onClick={() => (session.layout !== 'Model' ? session.setLayout('Model') : Promise.resolve()).then(() => showWindow(session, iv.cx, iv.cy, iv.height * iv.aspect, iv.height, (iv.twist * Math.PI) / 180))} {...tip(t('views.initial'), t('views.initialDesc'), undefined, { side: true })}>
              {t('views.initial')}
            </button>
            <span className="muted small">
              {fmt(iv.height * iv.aspect)} × {fmt(iv.height)}
              {iv.twist ? ` · ${fmt(iv.twist)}°` : ''}
            </span>
          </div>
        )}
        {named.map((v) => (
          <div key={v.name} className="view-row">
            <button type="button" className="link-inline" onClick={() => void goNamed(v)}>
              {v.name}
            </button>
            <span className="muted small">
              {fmt(v.width)} × {fmt(v.height)}
              {v.twist ? ` · ${fmt((v.twist * 180) / Math.PI)}°` : ''}
              {v.paperSpace ? ` · ${t('views.paper')}` : ''}
            </span>
            {v.nonPlan && (
              <span {...iconTip(t('views.nonPlan'), undefined, undefined, { terms: 'wcs' })}>
                <TriangleAlert size={12} className="warn" />
              </span>
            )}
          </div>
        ))}
        {!named.length && !iv && <p className="muted small">{t('views.none')}</p>}
      </div>
      <div className="panel-section">
        <div className="section-head">
          <b>{t('views.saved')}</b>
          <button type="button" className="tb-btn small-btn" disabled={!hash} onClick={save}>
            <Plus size={12} />
            {t('views.saveCurrent')}
          </button>
        </div>
        {saved.map((v) => (
          <div key={v.name} className="view-row">
            <button type="button" className="link-inline" onClick={() => void goSaved(v)}>
              {v.name}
            </button>
            <span className="muted small">
              {v.layout}
              {v.view.rotation ? ` · ${fmt((v.view.rotation * 180) / Math.PI)}°` : ''}
            </span>
            <button
              type="button"
              className="icon-btn"
              {...iconTip(t('filter.remove'))}
              onClick={() => {
                if (!hash) return;
                const next = saved.filter((x) => x.name !== v.name);
                setSaved(next);
                setSavedViews(hash, next);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <p className="muted small">{t('views.savedHelp')}</p>
      </div>
    </div>
  );
}
