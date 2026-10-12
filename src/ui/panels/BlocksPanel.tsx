import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Eye, Focus, MousePointerClick, Network } from 'lucide-react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { BlockInfo } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { iconTip } from '../Tooltip';

function Preview({ session, name, background }: { session: DocumentSession; name: string; background: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void session.rpc.call('blockPreview', { name, size: 64, background }).then((bmp) => {
      if (!alive || !bmp || !ref.current) return;
      const c = ref.current.getContext('2d');
      c?.drawImage(bmp, 0, 0, 40, 40);
      bmp.close();
    });
    return () => {
      alive = false;
    };
  }, [session, name, background]);
  return <canvas ref={ref} width={40} height={40} className="block-preview" />;
}

export function BlocksPanel() {
  const tab = useUi(activeTab);
  const background = useUi((s) => s.settings.background);
  const session = tab ? sessions.get(tab.id) : undefined;
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [anon, setAnon] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!session || tab?.status !== 'ready') return;
    let alive = true;
    void session.rpc.call('getBlocks', undefined).then((b) => alive && setBlocks(b));
    return () => {
      alive = false;
    };
  }, [session, tab?.status, tab?.summary]);
  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return blocks.filter((b) => (anon || !b.anonymous) && (!f || b.name.toLowerCase().includes(f) || b.dynamicSource?.toLowerCase().includes(f)));
  }, [blocks, filter, anon]);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => parentRef.current, estimateSize: () => 50, overscan: 8 });
  if (!tab || !session) return <div className="panel-empty">—</div>;
  const select = async (name: string, nested: boolean) => session.setSelection(await session.rpc.call('blockRefs', { name, nested }));
  return (
    <div className="panel">
      <div className="panel-toolbar">
        <input className="search" type="search" placeholder={t('blocks.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <label className="check panel-sub">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
        {t('blocks.showAnonymous')}
      </label>
      <div className="panel-scroll" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const b = list[vi.index];
            return (
              <div key={b.name} className="block-row" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}>
                <Preview session={session} name={b.name} background={background} />
                <div className="block-meta">
                  <div className="block-name" title={b.description || b.name}>
                    {b.name}
                  </div>
                  <div className="muted small">
                    {t('blocks.refs', { count: b.refCount })} · {t('blocks.entities', { count: b.entityCount })}
                    {b.refCount === 0 && <span className="warn-text"> · {t('blocks.unused')}</span>}
                    {b.xref && <span> · {t('blocks.xref')}</span>}
                    {b.dynamicSource && <span> · {t('blocks.dynamic', { name: b.dynamicSource })}</span>}
                  </div>
                  {b.attdefs.length > 0 && <div className="muted small ellipsis">{t('blocks.attdefs', { tags: b.attdefs.join(', ') })}</div>}
                </div>
                <div className="block-actions">
                  <button type="button" className="icon-btn" {...iconTip(t('blocks.selectRefs'), t('blocks.selectRefsDesc'))} onClick={() => void select(b.name, false)}>
                    <MousePointerClick size={14} />
                  </button>
                  <button type="button" className="icon-btn" {...iconTip(t('blocks.selectNested'), t('blocks.selectNestedDesc'))} onClick={() => void select(b.name, true)}>
                    <Network size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    {...iconTip(t('blocks.isolate'), t('blocks.isolateDesc'))}
                    onClick={async () => {
                      const ids = await session.rpc.call('blockRefs', { name: b.name, nested: true });
                      void session.setVisibility('isolate', ids);
                    }}
                  >
                    <Focus size={14} />
                  </button>
                  <button type="button" className="icon-btn" {...iconTip(t('blocks.view'), t('blocks.viewDesc'))} onClick={() => void session.setLayout('§' + b.name)}>
                    <Eye size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
