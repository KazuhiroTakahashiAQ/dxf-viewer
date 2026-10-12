import { Copy, Trash2 } from 'lucide-react';

import { t } from '../../i18n';
import { iconTip, tip } from '../Tooltip';
import { sessions } from '../../session/DocumentSession';
import type { SnapKind } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { measureFormat } from '../format';
import { measureText, measureValues, type MeasureMode } from '../measure';

const MODES: MeasureMode[] = ['distance', 'path', 'area', 'angle', 'entity', 'point'];
const SNAPS: SnapKind[] = ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'insertion', 'node', 'nearest'];

export function MeasurePanel() {
  const tab = useUi(activeTab);
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const mode = useUi((s) => s.measureMode);
  const setMode = useUi((s) => s.setMeasureMode);
  const m = useUi((s) => s.measure);
  const history = useUi((s) => s.measureHistory);
  const clearHistory = useUi((s) => s.clearMeasureHistory);
  const settings = useUi((s) => s.settings);
  const update = useUi((s) => s.updateSettings);
  const f = measureFormat(tab?.summary?.insUnits, tab?.summary?.luprec, settings.coordPrecision);
  const session = tab ? sessions.get(tab.id) : undefined;
  const cur = m && m.tabId === tab?.id ? m : null;
  const v = cur ? measureValues(cur.mode, cur.points) : {};
  const pts = cur?.points ?? [];

  const rows: [string, string][] = [];
  if (cur) {
    if (v.length !== undefined) rows.push([cur.mode === 'area' ? t('measure.perimeter') : t('measure.length'), f.len(v.length)]);
    if (v.dx !== undefined) rows.push(['ΔX', f.coord(v.dx)], ['ΔY', f.coord(v.dy!)], [t('measure.direction'), `${v.direction!.toFixed(4)}°`]);
    if (v.area !== undefined) rows.push([t('measure.area'), f.area(v.area)]);
    if (v.angle !== undefined) rows.push([t('measure.angle'), `${v.angle.toFixed(4)}°`], [t('measure.reflex'), `${(360 - v.angle).toFixed(4)}°`]);
    if (v.segments !== undefined) rows.push([t('measure.segments'), String(v.segments)]);
    if (cur.mode === 'point' && pts.length >= 2) rows.push(['X', f.coord(pts[0])], ['Y', f.coord(pts[1])]);
    const e = cur.entity;
    if (e) {
      rows.push([t('measure.entity'), `${e.type} ${e.handle}`]);
      if (e.radius !== undefined) rows.push([t('measure.radius'), f.len(e.radius)], [t('measure.diameter'), f.len(e.radius * 2)]);
      if (e.center) rows.push([t('measure.center'), `${f.coord(e.center[0])}, ${f.coord(e.center[1])}`]);
      if (e.length !== undefined) rows.push([t('measure.length'), f.len(e.length)]);
      if (e.area !== undefined && e.area > 0) rows.push([e.closed ? t('measure.area') : t('measure.areaOpen'), f.area(e.area)]);
    }
  }

  return (
    <div className="panel panel-scroll measure-panel">
      <div className="panel-section">
        <label className="check">
          <input type="checkbox" checked={tool === 'measure'} disabled={!session} onChange={(e) => setTool(e.target.checked ? 'measure' : 'select')} />
          <b>{t('measure.active')}</b>
        </label>
        <div className="seg measure-modes" role="radiogroup" aria-label={t('measure.mode')}>
          {MODES.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={mode === x}
              className={mode === x ? 'on' : ''}
              onClick={() => {
                setMode(x);
                setTool('measure');
              }}
              {...tip(t(`measure.mode.${x}`), t(`measure.help.${x}`))}
            >
              {t(`measure.mode.${x}`)}
            </button>
          ))}
        </div>
        <p className="muted small">{t(`measure.help.${mode}` as never)}</p>
      </div>
      <div className="panel-section">
        <div className="section-head">
          <b>{t('measure.result')}</b>
          {cur && (
            <button type="button" className="icon-btn" {...iconTip(t('measure.copy'))} onClick={() => void navigator.clipboard?.writeText(measureText(cur.mode, cur.points, f, cur.entity))}>
              <Copy size={13} />
            </button>
          )}
        </div>
        {rows.length ? (
          <table className="kv">
            <tbody>
              {rows.map(([k, val]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td className="mono">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">{t('measure.none')}</p>
        )}
        {cur && !cur.done && (cur.mode === 'path' || cur.mode === 'area') && <p className="muted small">{t('measure.finishHint')}</p>}
      </div>
      <div className="panel-section">
        <label className="check">
          <input type="checkbox" checked={settings.snap} onChange={(e) => update({ snap: e.target.checked })} />
          <b>{t('measure.snap')}</b>
        </label>
        <div className="snap-kinds">
          {SNAPS.map((k) => (
            <label key={k} className="check small">
              <input
                type="checkbox"
                disabled={!settings.snap}
                checked={settings.snapKinds.includes(k)}
                onChange={(e) => update({ snapKinds: e.target.checked ? [...settings.snapKinds, k] : settings.snapKinds.filter((x) => x !== k) })}
              />
              {t(`snap.${k}` as never)}
            </label>
          ))}
        </div>
      </div>
      {history.length > 0 && (
        <div className="panel-section">
          <div className="section-head">
            <b>{t('measure.history')}</b>
            <button type="button" className="icon-btn" {...iconTip(t('measure.clearHistory'))} onClick={clearHistory}>
              <Trash2 size={13} />
            </button>
          </div>
          {history.map((h, i) => (
            <div key={i} className="measure-hist">
              <span className="muted small">{t(`measure.mode.${h.mode}` as never)}</span>
              <span className="mono small" title={h.file}>
                {h.text}
              </span>
              <button type="button" className="icon-btn" {...iconTip(t('measure.copy'))} onClick={() => void navigator.clipboard?.writeText(h.text)}>
                <Copy size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
