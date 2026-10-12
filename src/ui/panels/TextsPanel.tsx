import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CaseSensitive, Download, Regex } from 'lucide-react';

import { t, tx } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { TextQuery, TextRow } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { downloadText, toCsv } from '../download';
import { iconTip, tip } from '../Tooltip';

const PAGE = 400;

export function TextsPanel() {
  const tab = useUi(activeTab);
  const session = tab ? sessions.get(tab.id) : undefined;
  const [text, setText] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [field, setField] = useState<'plain' | 'raw'>('plain');
  const [container, setContainer] = useState('all');
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [pages, setPages] = useState<Map<number, TextRow[]>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);
  const ready = tab?.status === 'ready';

  const baseQuery = useCallback(
    (offset: number, limit: number): TextQuery => ({ text, regex, caseSensitive, field, container, offset, limit }),
    [text, regex, caseSensitive, field, container],
  );

  // reload first page whenever the query changes (debounced)
  useEffect(() => {
    if (!session || !ready) return;
    const id = ++reqRef.current;
    const timer = setTimeout(async () => {
      const r = await session.rpc.call('queryTexts', baseQuery(0, PAGE));
      if (id !== reqRef.current) return;
      setTotal(r.total);
      setError(r.error);
      setPages(new Map([[0, r.rows]]));
    }, 150);
    return () => clearTimeout(timer);
  }, [session, ready, baseQuery]);

  const v = useVirtualizer({ count: total, getScrollElement: () => parentRef.current, estimateSize: () => 24, overscan: 30 });
  const items = v.getVirtualItems();

  // fetch missing pages for visible rows
  useEffect(() => {
    if (!session || !items.length) return;
    const need = new Set(items.map((i) => Math.floor(i.index / PAGE)));
    for (const p of need) {
      if (pages.has(p)) continue;
      const id = reqRef.current;
      void session.rpc.call('queryTexts', baseQuery(p * PAGE, PAGE)).then((r) => {
        if (id !== reqRef.current) return;
        setPages((prev) => new Map(prev).set(p, r.rows));
      });
    }
  }, [items, pages, session, baseQuery]);

  const rowAt = (i: number): TextRow | undefined => pages.get(Math.floor(i / PAGE))?.[i % PAGE];

  const exportCsv = async () => {
    if (!session) return;
    const r = await session.rpc.call('queryTexts', baseQuery(0, 1_000_000));
    const csv = toCsv(
      ['handle', 'type', 'layer', 'style', 'height', 'container', 'tag', 'plain', 'raw'],
      r.rows.map((x) => [x.handle, x.type, x.layer, x.style, x.height, x.container, x.tag, x.plain, x.raw]),
    );
    downloadText(`${tab?.name.replace(/\.dxf$/i, '') ?? 'texts'}-texts.csv`, csv, 'text/csv;charset=utf-8');
  };

  if (!tab) return <div className="panel-empty">—</div>;

  return (
    <div className="panel texts-panel">
      <div className="panel-toolbar">
        <input className="search" type="search" placeholder={t('texts.search')} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!error} />
        <button type="button" className={`icon-btn toggle ${caseSensitive ? 'on' : ''}`} aria-pressed={caseSensitive} {...iconTip(t('texts.caseSensitive'))} onClick={() => setCaseSensitive(!caseSensitive)}>
          <CaseSensitive size={15} />
        </button>
        <button type="button" className={`icon-btn toggle ${regex ? 'on' : ''}`} aria-pressed={regex} {...iconTip(t('texts.regex'))} onClick={() => setRegex(!regex)}>
          <Regex size={15} />
        </button>
        <select value={field} onChange={(e) => setField(e.target.value as 'plain' | 'raw')} {...iconTip(t('texts.field'))}>
          <option value="plain">{t('texts.field.plain')}</option>
          <option value="raw">{t('texts.field.raw')}</option>
        </select>
        <select value={container} onChange={(e) => setContainer(e.target.value)} {...iconTip(t('texts.container'))}>
          <option value="all">{t('texts.container.all')}</option>
          <option value="Model">{t('texts.container.model')}</option>
          <option value="Paper">{t('texts.container.paper')}</option>
          <option value="blocks">{t('texts.container.blocks')}</option>
        </select>
        <span className="muted nowrap">{error ? <span className="warn-text">{error}</span> : t('texts.count', { count: total.toLocaleString() })}</span>
        <button type="button" className="icon-btn" {...iconTip(t('texts.exportCsv'))} onClick={() => void exportCsv()} disabled={!total}>
          <Download size={15} />
        </button>
      </div>
      <div className="grid-header text-row">
        <span>{t('texts.col.type')}</span>
        <span>{t('texts.col.layer')}</span>
        <span>{t('texts.col.style')}</span>
        <span className="num">{t('texts.col.height')}</span>
        <span>{t('texts.col.text')}</span>
        <span>{t('texts.col.container')}</span>
        <span>{t('texts.col.handle')}</span>
      </div>
      <div className="panel-scroll" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((vi) => {
            const r = rowAt(vi.index);
            return (
              <div
                key={vi.key}
                className={`text-row ${r && r.id === selected ? 'selected' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}
                onClick={() => {
                  if (!r || !session) return;
                  setSelected(r.id);
                  void session.zoomToEntities([r.id]);
                }}
              >
                {r ? (
                  <>
                    <span>{r.type}</span>
                    <span title={r.layer}>{r.layer}</span>
                    <span title={r.style}>{r.style}</span>
                    <span className="num">{r.height ? Number(r.height.toPrecision(6)) : ''}</span>
                    <span className="text-cell" title={field === 'raw' ? r.raw : r.plain}>
                      {r.tag ? <b className="muted">{r.tag}: </b> : null}
                      {(field === 'raw' ? r.raw : r.plain).replace(/\n/g, ' ⏎ ')}
                    </span>
                    <span {...tip(tx(r.container))}>{tx(r.container)}</span>
                    <span className="mono">{r.handle}</span>
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
