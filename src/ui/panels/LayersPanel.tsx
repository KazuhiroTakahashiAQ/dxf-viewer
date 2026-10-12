import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Eye, EyeOff, Focus, Lock, RotateCcw, Snowflake, Sun, TriangleAlert } from 'lucide-react';

import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { DocApi } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { rgbCss } from '../format';

export function LayersPanel() {
  const tab = useUi(activeTab);
  const setTab = useUi((s) => s.setTab);
  const background = useUi((s) => s.settings.background);
  const [filter, setFilter] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  const layers = useMemo(() => {
    const all = tab?.layers ?? [];
    const f = filter.trim().toLowerCase();
    const list = f ? all.filter((l) => l.name.toLowerCase().includes(f)) : all;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [tab?.layers, filter]);

  const rowVirtualizer = useVirtualizer({
    count: layers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 12,
  });

  if (!tab) return <div className="panel-empty">{t('layers.empty')}</div>;
  const session = sessions.get(tab.id);

  const apply = async (p: Parameters<DocApi['setLayerState']>[0]) => {
    if (!session) return;
    const layers = await session.rpc.call('setLayerState', p);
    setTab(tab.id, { layers });
  };

  const fg = ((background >> 16) & 0xff) * 0.299 + ((background >> 8) & 0xff) * 0.587 + (background & 0xff) * 0.114 < 128 ? 0xffffff : 0x000000;

  return (
    <div className="panel layers-panel">
      <div className="panel-toolbar">
        <input className="search" type="search" placeholder={t('layers.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="icon-btn" title={t('layers.allOn')} onClick={() => apply({ all: { on: true, frozen: false } })}>
          <Eye size={15} />
        </button>
        <button type="button" className="icon-btn" title={t('layers.allOff')} onClick={() => apply({ all: { on: false } })}>
          <EyeOff size={15} />
        </button>
        <button type="button" className="icon-btn" title={t('layers.reset')} onClick={() => apply({ reset: true })}>
          <RotateCcw size={15} />
        </button>
      </div>
      <div className="panel-scroll" ref={parentRef}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const l = layers[vi.index];
            return (
              <div key={l.index} className={`layer-row ${l.on && !l.frozen ? '' : 'dim'}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}>
                <button type="button" className="icon-btn" title={t('layers.on')} aria-pressed={l.on} onClick={() => apply({ changes: [{ index: l.index, on: !l.on }] })}>
                  {l.on ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button type="button" className="icon-btn" title={t('layers.freeze')} aria-pressed={l.frozen} onClick={() => apply({ changes: [{ index: l.index, frozen: !l.frozen }] })}>
                  {l.frozen ? <Snowflake size={14} /> : <Sun size={14} />}
                </button>
                <span className="swatch" style={{ background: rgbCss(l.fg ? fg : l.rgb) }} title={l.trueColor !== undefined ? rgbCss(l.trueColor) : `ACI ${l.aci}`} />
                <span className="layer-name" title={l.name}>
                  {l.name}
                </span>
                {l.locked && <Lock size={12} className="muted" aria-label={t('layers.locked')} />}
                {l.undefinedInFile && <TriangleAlert size={12} className="warn" aria-label={t('layers.undefined')} />}
                <span className="layer-count" title={t('layers.count', { count: l.count })}>
                  {l.count}
                </span>
                <button
                  type="button"
                  className="icon-btn hover-only"
                  title={t('layers.isolate')}
                  onClick={() => apply({ changes: (tab.layers ?? []).map((x) => ({ index: x.index, on: x.index === l.index, frozen: x.index === l.index ? false : x.frozen })) })}
                >
                  <Focus size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
