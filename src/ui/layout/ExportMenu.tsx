import { useState } from 'react';
import { Download } from 'lucide-react';

import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import { activeTab, useUi } from '../../state/store';
import { downloadBlob, downloadText, fileStem, toCsv } from '../download';

/** PNG / SVG of the drawing, CSV tables and JSON of the selection or the document. */
export function ExportMenu() {
  const tab = useUi(activeTab);
  const session = tab ? sessions.get(tab.id) : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = !!session && tab?.status === 'ready';
  const stem = tab ? `${fileStem(tab.name)}${tab.layout && tab.layout !== 'Model' ? `-${fileStem(tab.layout)}` : ''}` : 'drawing';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const image = (format: 'png' | 'svg', area: 'view' | 'extents', scale = 2) =>
    run(async () => {
      const r = await session!.rpc.call('exportImage', { format, area, scale });
      if (r.png) downloadBlob(`${stem}.png`, r.png);
      else if (r.svg) downloadText(`${stem}.svg`, r.svg, 'image/svg+xml;charset=utf-8');
    });

  return (
    <details className="tb-menu">
      <summary title={t('export.title')} aria-label={t('export.title')} className={!ready ? 'disabled' : ''}>
        <Download size={16} />
      </summary>
      <div className="menu-pop">
        <b>{t('export.image')}</b>
        <button type="button" className="menu-item" disabled={!ready || busy} onClick={() => void image('png', 'view', window.devicePixelRatio || 1)}>
          {t('export.pngView')}
        </button>
        <button type="button" className="menu-item" disabled={!ready || busy} onClick={() => void image('png', 'extents', 2)}>
          {t('export.pngExtents')}
        </button>
        <button type="button" className="menu-item" disabled={!ready || busy} onClick={() => void image('svg', 'view')}>
          {t('export.svgView')}
        </button>
        <button type="button" className="menu-item" disabled={!ready || busy} onClick={() => void image('svg', 'extents')}>
          {t('export.svgExtents')}
        </button>
        <hr />
        <b>{t('export.data')}</b>
        <button
          type="button"
          className="menu-item"
          disabled={!ready}
          onClick={() =>
            downloadText(
              `${stem}-layers.csv`,
              toCsv(
                ['name', 'on', 'frozen', 'locked', 'plot', 'color', 'linetype', 'lineweight', 'entities', 'defined'],
                (tab!.layers ?? []).map((l) => [l.name, l.on ? 1 : 0, l.frozen ? 1 : 0, l.locked ? 1 : 0, l.plot ? 1 : 0, l.trueColor !== undefined ? `#${l.trueColor.toString(16).padStart(6, '0')}` : `ACI ${l.aci}`, l.linetype, l.lineweight, l.count, l.undefinedInFile ? 0 : 1]),
              ),
              'text/csv;charset=utf-8',
            )
          }
        >
          {t('export.layersCsv')}
        </button>
        <button
          type="button"
          className="menu-item"
          disabled={!ready}
          onClick={() =>
            void run(async () => {
              const blocks = await session!.rpc.call('getBlocks', undefined);
              downloadText(
                `${stem}-blocks.csv`,
                toCsv(
                  ['name', 'entities', 'references', 'top-level references', 'anonymous', 'xref', 'xref path', 'dynamic source', 'attributes'],
                  blocks.map((b) => [b.name, b.entityCount, b.refCount, b.topRefCount, b.anonymous ? 1 : 0, b.xref ? 1 : 0, b.xrefPath ?? '', b.dynamicSource ?? '', b.attdefs.join(' ')]),
                ),
                'text/csv;charset=utf-8',
              );
            })
          }
        >
          {t('export.blocksCsv')}
        </button>
        <button
          type="button"
          className="menu-item"
          disabled={!ready}
          onClick={() =>
            void run(async () => {
              const stats = await session!.rpc.call('typeStats', undefined);
              downloadText(`${stem}-entity-types.csv`, toCsv(['type', 'model space', 'paper space', 'in blocks'], stats.map((r) => [r.type, r.model, r.paper, r.blocks])), 'text/csv;charset=utf-8');
            })
          }
        >
          {t('export.typesCsv')}
        </button>
        <button
          type="button"
          className="menu-item"
          disabled={!ready || !tab?.selection?.length}
          onClick={() =>
            void run(async () => {
              const ids = (tab!.selection ?? []).slice(0, 5000);
              const infos = await Promise.all(ids.map((id) => session!.rpc.call('entityInfo', { id })));
              const out = infos.filter(Boolean).map((e) => ({
                handle: e!.handle,
                type: e!.type,
                layer: e!.layer,
                line: e!.line,
                properties: Object.fromEntries(e!.rows.map((r) => [r.key, r.value])),
                xdata: e!.xdata,
              }));
              downloadText(`${stem}-selection.json`, JSON.stringify({ file: tab!.name, layout: tab!.layout, count: out.length, entities: out }, null, 1), 'application/json');
            })
          }
        >
          {t('export.selectionJson', { count: tab?.selection?.length ?? 0 })}
        </button>
        <button
          type="button"
          className="menu-item"
          disabled={!ready}
          onClick={() =>
            void run(async () => {
              const [header, generator, stats, blocks] = await Promise.all([
                session!.rpc.call('headerVars', undefined),
                session!.rpc.call('generator', undefined),
                session!.rpc.call('typeStats', undefined),
                session!.rpc.call('getBlocks', undefined),
              ]);
              const { diagnostics, ...summary } = tab!.summary!;
              downloadText(
                `${stem}-document.json`,
                JSON.stringify(
                  {
                    summary,
                    generator,
                    header: Object.fromEntries(header.map((h) => [h.name, h.value])),
                    layers: tab!.layers,
                    blocks: blocks.map(({ name, entityCount, refCount, xref, anonymous }) => ({ name, entityCount, refCount, xref, anonymous })),
                    entityTypes: stats,
                    coverage: tab!.build?.coverage,
                    diagnostics: diagnostics.slice(0, 500),
                  },
                  null,
                  1,
                ),
                'application/json',
              );
            })
          }
        >
          {t('export.documentJson')}
        </button>
        {busy && <p className="muted small">{t('export.busy')}</p>}
        {error && <p className="warn-text small">{error}</p>}
      </div>
    </details>
  );
}
