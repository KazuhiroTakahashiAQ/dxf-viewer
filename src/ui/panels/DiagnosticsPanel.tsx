import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { t } from '../../i18n';
import { activeTab, useUi } from '../../state/store';
import { showRawLine } from './DocumentPanel';

export function DiagnosticsPanel() {
  const tab = useUi(activeTab);
  const parentRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => [...(tab?.summary?.diagnostics ?? []), ...(tab?.build?.diagnostics ?? [])], [tab?.summary, tab?.build]);
  const v = useVirtualizer({ count: items.length, getScrollElement: () => parentRef.current, estimateSize: () => 24, overscan: 20 });
  if (!items.length) return <div className="panel-empty">{t('diag.empty')}</div>;
  return (
    <div className="panel diag-panel">
      <div className="grid-header diag-row">
        <span>{t('diag.level')}</span>
        <span>{t('diag.code')}</span>
        <span>{t('diag.line')}</span>
        <span>{t('diag.message')}</span>
      </div>
      <div className="panel-scroll" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const d = items[vi.index];
            return (
              <div
                key={vi.key}
                className={`diag-row level-${d.level} ${d.line ? 'clickable' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}
                onClick={() => d.line && showRawLine(d.line)}
                title={d.line ? t('doc.showRaw') : undefined}
              >
                <span>{d.level}</span>
                <span className="mono">{d.code}</span>
                <span className="mono num">{d.line ?? ''}</span>
                <span title={d.message}>{d.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
