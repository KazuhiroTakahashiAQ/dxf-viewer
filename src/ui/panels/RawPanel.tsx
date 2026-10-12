import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CaseSensitive, ChevronDown, ChevronUp, Crosshair, Regex } from 'lucide-react';

import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { RawRow } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { iconTip } from '../Tooltip';

const PAGE = 1000;

/** Virtualized view of every tag of the file (line, group code, value). */
export function RawPanel() {
  const tab = useUi(activeTab);
  const jump = useUi((s) => s.rawJump);
  const session = tab ? sessions.get(tab.id) : undefined;
  const total = tab?.summary?.tagCount ?? 0;
  const [pages, setPages] = useState<Map<number, RawRow[]>>(new Map());
  const [current, setCurrent] = useState<number | null>(null);
  const [owner, setOwner] = useState<{ entityId?: number; handle?: string; type: string } | null>(null);
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const [msg, setMsg] = useState('');
  const [lineInput, setLineInput] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: total, getScrollElement: () => parentRef.current, estimateSize: () => 20, overscan: 40 });
  const items = v.getVirtualItems();

  useEffect(() => {
    setPages(new Map());
    setCurrent(null);
    setOwner(null);
  }, [session, tab?.summary]);
  useEffect(() => {
    if (!session) return;
    for (const p of new Set(items.map((i) => Math.floor(i.index / PAGE)))) {
      if (pages.has(p)) continue;
      pages.set(p, []);
      void session.rpc.call('rawRows', { offset: p * PAGE, limit: PAGE }).then((rows) => setPages((prev) => new Map(prev).set(p, rows)));
    }
  }, [items, pages, session]);

  const goto = (index: number) => {
    setCurrent(index);
    v.scrollToIndex(index, { align: 'center' });
    void session?.rpc.call('tagOwner', { index }).then(setOwner);
  };

  useEffect(() => {
    if (!jump || !session) return;
    void session.rpc.call('tagAtLine', { line: jump.line }).then(goto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, session]);

  const search = async (dir: 1 | -1) => {
    if (!session) return;
    const c = code.trim() === '' ? undefined : Number(code);
    if (!q && c === undefined) return;
    const r = await session.rpc.call('rawSearch', { query: q, regex, caseSensitive: cs, code: Number.isFinite(c) ? c : undefined, from: current ?? -1, dir });
    if (!r) setMsg(t('raw.notFound'));
    else if ('error' in r) setMsg(r.error);
    else {
      setMsg('');
      goto(r.index);
    }
  };

  if (!tab || !session) return <div className="panel-empty">—</div>;
  return (
    <div className="panel raw-panel">
      <div className="panel-toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(lineInput);
            if (Number.isFinite(n) && n > 0) void session.rpc.call('tagAtLine', { line: n }).then(goto);
          }}
        >
          <input className="num-input" placeholder={t('raw.line')} value={lineInput} onChange={(e) => setLineInput(e.target.value)} aria-label={t('raw.line')} />
        </form>
        <input className="num-input code-input" placeholder={t('raw.code')} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('raw.code')} />
        <input
          className="search"
          type="search"
          placeholder={t('raw.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search(e.shiftKey ? -1 : 1);
          }}
        />
        <button type="button" className={`icon-btn toggle ${cs ? 'on' : ''}`} aria-pressed={cs} {...iconTip(t('texts.caseSensitive'))} onClick={() => setCs(!cs)}>
          <CaseSensitive size={15} />
        </button>
        <button type="button" className={`icon-btn toggle ${regex ? 'on' : ''}`} aria-pressed={regex} {...iconTip(t('texts.regex'))} onClick={() => setRegex(!regex)}>
          <Regex size={15} />
        </button>
        <button type="button" className="icon-btn" {...iconTip(t('raw.prev'), undefined, 'Shift+Enter')} onClick={() => void search(-1)}>
          <ChevronUp size={15} />
        </button>
        <button type="button" className="icon-btn" {...iconTip(t('raw.next'), undefined, 'Enter')} onClick={() => void search(1)}>
          <ChevronDown size={15} />
        </button>
        {msg && <span className="warn-text small nowrap">{msg}</span>}
        <span className="tb-spacer" />
        {owner && (
          <span className="small nowrap">
            {owner.type} <span className="mono">{owner.handle}</span>
            {owner.entityId !== undefined && (
              <button
                type="button"
                className="icon-btn"
                {...iconTip(t('raw.selectOwner'))}
                onClick={() => {
                  session.setSelection([owner.entityId!]);
                  void session.zoomToEntities([owner.entityId!]);
                }}
              >
                <Crosshair size={13} />
              </button>
            )}
            {owner.handle && owner.entityId === undefined && (
              <button
                type="button"
                className="link-inline"
                onClick={() => {
                  useUi.getState().setInspectHandle(owner.handle!);
                  useUi.getState().setDock('right', { open: true, active: 'document' });
                }}
              >
                {t('raw.inspect')}
              </button>
            )}
          </span>
        )}
      </div>
      <div className="panel-scroll mono raw-scroll" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((vi) => {
            const r = pages.get(Math.floor(vi.index / PAGE))?.[vi.index % PAGE];
            return (
              <div
                key={vi.key}
                className={`raw-row ${current === vi.index ? 'selected' : ''} ${r?.code === 0 ? 'rec-start' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}
                onClick={() => goto(vi.index)}
              >
                {r ? (
                  <>
                    <span className="muted">{r.line}</span>
                    <span className="raw-code">{r.code}</span>
                    <span className="raw-value">{r.value}</span>
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
