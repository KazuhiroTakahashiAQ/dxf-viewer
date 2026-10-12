import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Copy, Crosshair } from 'lucide-react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { EntityInfo, PropRow, RawTagRow, SelectionSummary } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';

const RAW_PAGE = 500;

async function followHandle(session: DocumentSession, handle: string): Promise<void> {
  const r = await session.rpc.call('findHandle', { handle });
  if (r?.kind === 'entity') {
    session.setSelection([r.id]);
    void session.zoomToEntities([r.id]);
  } else if (r) {
    useUi.getState().setDock('bottom', { open: true, active: 'document' });
    useUi.getState().setInspectHandle(handle);
  }
}

function Value({ row, session }: { row: PropRow; session: DocumentSession }) {
  if (row.value === null) return <span className="muted">—</span>;
  if (row.kind === 'handle' && typeof row.value === 'string') {
    return (
      <span className="handles">
        {row.value.split(/,\s*/).map((h) => (
          <button key={h} type="button" className="link-inline mono" onClick={() => void followHandle(session, h)}>
            {h}
          </button>
        ))}
      </span>
    );
  }
  if (row.link?.entity !== undefined) {
    return (
      <button type="button" className="link-inline" onClick={() => session.setSelection([row.link!.entity!])}>
        {String(row.value)}
      </button>
    );
  }
  if (row.kind === 'color') {
    return (
      <span className="color-value">
        {row.color && <span className="swatch" style={{ background: row.color }} />}
        {String(row.value)}
      </span>
    );
  }
  if (row.kind === 'text') return <span className="text-value">{String(row.value)}</span>;
  return <span>{String(row.value)}</span>;
}

function RawTags({ session, id, total }: { session: DocumentSession; id: number; total: number }) {
  const [pages, setPages] = useState<Map<number, RawTagRow[]>>(new Map());
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: total, getScrollElement: () => parentRef.current, estimateSize: () => 22, overscan: 20 });
  const items = v.getVirtualItems();
  useEffect(() => setPages(new Map()), [id]);
  useEffect(() => {
    const need = new Set(items.map((i) => Math.floor(i.index / RAW_PAGE)));
    for (const p of need) {
      if (pages.has(p)) continue;
      void session.rpc.call('rawTags', { id, offset: p * RAW_PAGE, limit: RAW_PAGE }).then((r) => setPages((prev) => new Map(prev).set(p, r.rows)));
    }
  }, [items, pages, id, session]);
  const copy = async () => {
    const r = await session.rpc.call('rawTags', { id, offset: 0, limit: total });
    void navigator.clipboard?.writeText(r.rows.map((x) => `${String(x.code).padStart(3, ' ')}\n${x.value}`).join('\n') + '\n');
  };
  return (
    <div className="raw-tags">
      <div className="raw-head">
        <span className="muted">{t('props.rawCount', { count: total })}</span>
        <button type="button" className="icon-btn" title={t('props.copyDxf')} onClick={() => void copy()}>
          <Copy size={13} />
        </button>
      </div>
      <div className="raw-row grid-header">
        <span className="num">{t('props.line')}</span>
        <span className="num">{t('props.code')}</span>
        <span>{t('props.value')}</span>
        <span>{t('props.meaning')}</span>
      </div>
      <div className="raw-scroll" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((vi) => {
            const r = pages.get(Math.floor(vi.index / RAW_PAGE))?.[vi.index % RAW_PAGE];
            return (
              <div key={vi.key} className={`raw-row ${r?.code === 0 ? 'rec' : ''} ${r && r.code >= 1000 ? 'xd' : ''}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}>
                {r ? (
                  <>
                    <span className="num muted">{r.line || ''}</span>
                    <span className="num mono">{r.code}</span>
                    <span className="mono" title={r.value}>
                      {r.value}
                    </span>
                    <span className="muted" title={r.desc}>
                      {r.desc}
                    </span>
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

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="prop-section">
      <button type="button" className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
      </button>
      {open && children}
    </section>
  );
}

function Single({ session, id }: { session: DocumentSession; id: number }) {
  const [info, setInfo] = useState<EntityInfo | null>(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    void session.rpc.call('entityInfo', { id }).then((r) => alive && setInfo(r));
    return () => {
      alive = false;
    };
  }, [session, id]);
  const groups = useMemo(() => {
    const m = new Map<string, PropRow[]>();
    for (const r of info?.rows ?? []) {
      if (!m.has(r.group)) m.set(r.group, []);
      m.get(r.group)!.push(r);
    }
    return [...m.entries()];
  }, [info]);
  if (!info) return <div className="panel-empty">…</div>;
  return (
    <div className="props">
      <div className="props-title">
        <b>{info.type}</b>
        <span className="mono muted">{info.handle}</span>
        {info.line !== undefined && <span className="muted small">{t('props.atLine', { line: info.line })}</span>}
        <button type="button" className="icon-btn" title={t('menu.zoomTo')} onClick={() => void session.zoomToEntities([id])}>
          <Crosshair size={14} />
        </button>
      </div>
      {groups.map(([g, rows]) => (
        <Section key={g} title={t(`props.group.${g}` as never) || g}>
          <table className="kv">
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th title={r.key}>{r.label}</th>
                  <td>
                    <Value row={r} session={session} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ))}
      {info.xdata.length > 0 && (
        <Section title={t('props.xdata')}>
          {info.xdata.map((x, i) => (
            <div key={i} className="xdata">
              <div className="mono">{x.app}</div>
              <table className="kv">
                <tbody>
                  {x.tags.map((tg, k) => (
                    <tr key={k}>
                      <th className="mono">{tg.code}</th>
                      <td className="mono">{tg.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Section>
      )}
      <Section title={t('props.raw')} defaultOpen={false}>
        <RawTags session={session} id={id} total={info.tagCount} />
      </Section>
    </div>
  );
}

function Multi({ session, ids }: { session: DocumentSession; ids: number[] }) {
  const [sum, setSum] = useState<SelectionSummary | null>(null);
  useEffect(() => {
    let alive = true;
    void session.rpc.call('selectionSummary', { ids }).then((r) => alive && setSum(r));
    return () => {
      alive = false;
    };
  }, [session, ids]);
  if (!sum) return <div className="panel-empty">…</div>;
  return (
    <div className="props">
      <div className="props-title">
        <b>{t('props.selected', { count: sum.count })}</b>
        <button type="button" className="icon-btn" title={t('menu.zoomTo')} onClick={() => void session.zoomToEntities(ids)}>
          <Crosshair size={14} />
        </button>
      </div>
      <Section title={t('props.byType')}>
        <table className="kv">
          <tbody>
            {sum.byType.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td className="num">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title={t('props.byLayer')}>
        <table className="kv">
          <tbody>
            {sum.byLayer.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td className="num">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export function PropertiesPanel() {
  const tab = useUi(activeTab);
  const session = tab ? sessions.get(tab.id) : undefined;
  const sel = tab?.selection ?? [];
  if (!tab || !session) return <div className="panel-empty">—</div>;
  if (!sel.length) return <div className="panel-empty">{t('props.none')}</div>;
  return <div className="panel panel-scroll">{sel.length === 1 ? <Single session={session} id={sel[0]} /> : <Multi session={session} ids={sel} />}</div>;
}
