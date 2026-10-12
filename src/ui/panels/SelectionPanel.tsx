import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, EyeOff, Focus, X } from 'lucide-react';

import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { HoverInfo } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { downloadText, toCsv } from '../download';
import { iconTip, TypeName } from '../Tooltip';

export function SelectionPanel() {
  const tab = useUi(activeTab);
  const session = tab ? sessions.get(tab.id) : undefined;
  const sel = tab?.selection ?? [];
  const [rows, setRows] = useState<HoverInfo[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    void session.rpc.call('describeIds', { ids: sel }).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [session, sel]);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 24, overscan: 20 });
  if (!tab || !session) return <div className="panel-empty">—</div>;
  return (
    <div className="panel">
      <div className="panel-toolbar">
        <span className="muted nowrap">{t('props.selected', { count: sel.length })}</span>
        <span className="tb-spacer" />
        <button type="button" className="icon-btn" disabled={!sel.length} {...iconTip(t('menu.isolate'), t('blocks.isolateDesc'), undefined, { terms: 'isolate' })} onClick={() => void session.setVisibility('isolate', sel)}>
          <Focus size={14} />
        </button>
        <button type="button" className="icon-btn" disabled={!sel.length} {...iconTip(t('menu.hide'), t('help.tip.hidden'))} onClick={() => void session.setVisibility('hide', sel)}>
          <EyeOff size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={!rows.length}
          {...iconTip(t('texts.exportCsv'))}
          onClick={() => downloadText('selection.csv', toCsv(['handle', 'type', 'layer'], rows.map((r) => [r.handle, r.type, r.layer])), 'text/csv;charset=utf-8')}
        >
          <Download size={14} />
        </button>
        <button type="button" className="icon-btn" disabled={!sel.length} {...iconTip(t('sel.clear'), undefined, 'Esc')} onClick={() => session.setSelection([])}>
          <X size={14} />
        </button>
      </div>
      <div className="panel-scroll" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            return (
              <div key={vi.key} className="sel-row" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }} onClick={() => void session.zoomToEntities([r.id])}>
                <span>
                  <TypeName type={r.type} side />
                </span>
                <span className="muted" title={r.layer}>
                  {r.layer}
                </span>
                <span className="mono">{r.handle}</span>
                <button
                  type="button"
                  className="icon-btn hover-only"
                  {...iconTip(t('sel.remove'))}
                  onClick={(e) => {
                    e.stopPropagation();
                    session.setSelection(sel.filter((id) => id !== r.id));
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
