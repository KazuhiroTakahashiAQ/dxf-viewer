import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, MousePointerClick } from 'lucide-react';

import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { ResultRow } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { downloadText, toCsv } from '../download';
import { iconTip } from '../Tooltip';

const PAGE = 500;

export function ResultsPanel() {
  const tab = useUi(activeTab);
  const session = tab ? sessions.get(tab.id) : undefined;
  const result = tab?.filterResult;
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState<Map<number, ResultRow[]>>(new Map());
  const parentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPages(new Map());
    if (!session || !result) {
      setTotal(0);
      return;
    }
    void session.rpc.call('filterResults', { offset: 0, limit: PAGE }).then((r) => {
      setTotal(r.total);
      setPages(new Map([[0, r.rows]]));
    });
  }, [session, result]);
  const v = useVirtualizer({ count: total, getScrollElement: () => parentRef.current, estimateSize: () => 24, overscan: 30 });
  const items = v.getVirtualItems();
  useEffect(() => {
    if (!session) return;
    for (const p of new Set(items.map((i) => Math.floor(i.index / PAGE)))) {
      if (pages.has(p)) continue;
      void session.rpc.call('filterResults', { offset: p * PAGE, limit: PAGE }).then((r) => setPages((prev) => new Map(prev).set(p, r.rows)));
    }
  }, [items, pages, session]);
  if (!tab || !session) return <div className="panel-empty">—</div>;
  if (!result) return <div className="panel-empty">{t('results.none')}</div>;
  const all = async () => (await session.rpc.call('filterResults', { offset: 0, limit: 10_000_000 })).rows;
  return (
    <div className="panel">
      <div className="panel-toolbar">
        <span className="muted nowrap">{t('filter.result', { count: total.toLocaleString() })}</span>
        <span className="tb-spacer" />
        <button type="button" className="icon-btn" {...iconTip(t('results.selectAll'))} onClick={async () => session.setSelection((await all()).map((r) => r.id))}>
          <MousePointerClick size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          {...iconTip(t('texts.exportCsv'))}
          onClick={async () => downloadText('filter-results.csv', toCsv(['handle', 'type', 'layer', 'label'], (await all()).map((r) => [r.handle, r.type, r.layer, r.label])), 'text/csv;charset=utf-8')}
        >
          <Download size={14} />
        </button>
        <button
          type="button"
          className="tb-btn small-btn"
          onClick={async () => downloadText('filter-results.json', JSON.stringify({ filter: tab.filterApplied, results: await all() }, null, 1), 'application/json')}
        >
          JSON
        </button>
      </div>
      <div className="grid-header result-row">
        <span>{t('texts.col.type')}</span>
        <span>{t('texts.col.layer')}</span>
        <span>{t('texts.col.handle')}</span>
        <span>{t('results.label')}</span>
      </div>
      <div className="panel-scroll" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((vi) => {
            const r = pages.get(Math.floor(vi.index / PAGE))?.[vi.index % PAGE];
            return (
              <div
                key={vi.key}
                className={`result-row ${r && tab.selection?.includes(r.id) ? 'selected' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}
                onClick={() => {
                  if (!r) return;
                  session.setSelection([r.id]);
                  void session.zoomToEntities([r.id]);
                }}
              >
                {r ? (
                  <>
                    <span>{r.type}</span>
                    <span title={r.layer}>{r.layer}</span>
                    <span className="mono">{r.handle}</span>
                    <span title={r.label}>{r.label}</span>
                  </>
                ) : (
                  <span className="muted">…</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
