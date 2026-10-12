import { t } from '../../i18n';
import { activeTab, useUi } from '../../state/store';
import { formatBytes, unitName } from '../format';

export function DocumentPanel() {
  const tab = useUi(activeTab);
  const s = tab?.summary;
  if (!tab || !s) return <div className="panel-empty">—</div>;
  const ext = s.extents;
  const rows: [string, string][] = [
    [t('doc.file'), s.name],
    [t('doc.size'), formatBytes(s.size)],
    [t('doc.version'), `${s.version ?? '?'}${s.release ? ` (${s.release})` : ''}`],
    [t('doc.format'), s.binary ? t('doc.binary') : t('doc.ascii')],
    [t('doc.encoding'), `${s.encoding}${s.codepage ? ` / ${s.codepage}` : ''}`],
    [t('doc.encodingReason'), s.encodingReason],
    [t('doc.replacements'), String(s.replacements)],
    [t('doc.lines'), `${s.lineCount.toLocaleString()} / ${s.tagCount.toLocaleString()}`],
    [t('doc.entities'), s.entityCount.toLocaleString()],
    [t('doc.modelPaper'), `${s.modelSpaceCount.toLocaleString()} / ${s.paperSpaceCount.toLocaleString()}`],
    [t('doc.blocks'), s.blockCount.toLocaleString()],
    [t('doc.layers'), s.layerCount.toLocaleString()],
    [t('doc.layouts'), s.layoutNames.join(', ') || '—'],
    [t('doc.extents'), ext ? `(${ext.minX.toFixed(3)}, ${ext.minY.toFixed(3)}) – (${ext.maxX.toFixed(3)}, ${ext.maxY.toFixed(3)})` : '—'],
    [t('doc.units'), `${s.insUnits}${unitName(s.insUnits) ? ` (${unitName(s.insUnits)})` : ''}`],
    [t('doc.parseTime'), `${s.parseMs.toFixed(0)} ms`],
  ];
  const coverage = tab.build?.coverage ?? [];
  return (
    <div className="panel doc-panel panel-scroll">
      <table className="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {coverage.length > 0 && (
        <>
          <h4>{t('doc.coverage')}</h4>
          {!!tab.build?.budgetExceeded && <p className="warn-text">{t('doc.budget', { count: tab.build.budgetExceeded })}</p>}
          <table className="grid">
            <thead>
              <tr>
                <th>{t('doc.coverage.type')}</th>
                <th className="num">{t('doc.coverage.count')}</th>
                <th className="num">{t('doc.coverage.rendered')}</th>
                <th>{t('doc.coverage.method')}</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((c) => (
                <tr key={c.type} className={c.rendered < c.count ? 'warn-row' : ''}>
                  <td>{c.type}</td>
                  <td className="num">{c.count}</td>
                  <td className="num">{c.rendered}</td>
                  <td>{c.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
