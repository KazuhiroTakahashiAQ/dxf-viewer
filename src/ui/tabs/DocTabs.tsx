import { useRef } from 'react';
import { FileWarning, Loader2, X } from 'lucide-react';

import { t } from '../../i18n';
import { formatBytes } from '../format';
import { closeSession } from '../../session/DocumentSession';
import { useUi } from '../../state/store';
import { iconTip, tip } from '../Tooltip';

export function DocTabs() {
  const tabs = useUi((s) => s.tabs);
  const activeId = useUi((s) => s.activeId);
  const activate = useUi((s) => s.activate);
  const moveTab = useUi((s) => s.moveTab);
  const dragFrom = useRef<number | null>(null);
  if (!tabs.length) return null;
  return (
    <div className="doc-tabs" role="tablist">
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={0}
          className={`doc-tab ${tab.id === activeId ? 'active' : ''}`}
          {...tip(tab.name, [tab.build?.memoryBytes ? t('tabs.memory', { size: formatBytes(tab.build.memoryBytes) }) : '', t('tip.tab')].filter(Boolean).join(' · '))}
          draggable
          onDragStart={() => (dragFrom.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom.current !== null && dragFrom.current !== i) moveTab(dragFrom.current, i);
            dragFrom.current = null;
          }}
          onClick={() => activate(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) closeSession(tab.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') activate(tab.id);
          }}
        >
          {tab.status === 'loading' && <Loader2 size={13} className="spin" aria-label={t('tabs.loading')} />}
          {tab.status === 'error' && <FileWarning size={13} className="warn" />}
          <span className="doc-tab-name">{tab.name}</span>
          <button
            type="button"
            className="icon-btn tab-close"
            {...iconTip(t('tabs.close'))}
            onClick={(e) => {
              e.stopPropagation();
              closeSession(tab.id);
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
