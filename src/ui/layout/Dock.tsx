import { useCallback, useRef, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, type LucideIcon } from 'lucide-react';

import { t, type MessageKey } from '../../i18n';
import type { TermId } from '../../i18n/glossary';
import { useUi, type DockSide } from '../../state/store';
import { iconTip, tip } from '../Tooltip';

export interface PanelDef {
  id: string;
  title: MessageKey;
  /** what the panel is for (tooltip, help) */
  desc: MessageKey;
  /** CAD terms the panel is about, explained in its tooltip */
  terms?: TermId[];
  icon: LucideIcon;
  component: ComponentType;
}

const MIN: Record<DockSide, number> = { left: 180, right: 220, bottom: 120 };

/**
 * Collapsible, resizable dock. When collapsed it shrinks to a thin icon strip
 * so the drawing area stays visible; clicking an icon re-opens that panel.
 */
export function Dock({ side, panels }: { side: DockSide; panels: PanelDef[] }) {
  const dock = useUi((s) => s.docks[side]);
  const setDock = useUi((s) => s.setDock);
  const toggleDock = useUi((s) => s.toggleDock);
  const dragRef = useRef<{ start: number; size: number } | null>(null);
  const active = panels.find((p) => p.id === dock.active) ?? panels[0];
  const vertical = side !== 'bottom';

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { start: vertical ? e.clientX : e.clientY, size: dock.size };
    },
    [dock.size, vertical],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const pos = vertical ? e.clientX : e.clientY;
      const delta = side === 'left' ? pos - d.start : d.start - pos;
      const max = vertical ? window.innerWidth * 0.6 : window.innerHeight * 0.7;
      setDock(side, { size: Math.round(Math.max(MIN[side], Math.min(max, d.size + delta))) });
    },
    [setDock, side, vertical],
  );
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const CollapseIcon = side === 'left' ? ChevronLeft : side === 'right' ? ChevronRight : ChevronDown;
  const ExpandIcon = side === 'left' ? ChevronRight : side === 'right' ? ChevronLeft : ChevronUp;

  if (!dock.open) {
    return (
      <div className={`dock dock-${side} dock-collapsed`}>
        <div className="dock-strip">
          {panels.map((p) => (
            <button key={p.id} type="button" className="icon-btn" {...iconTip(t(p.title), t(p.desc), undefined, { terms: p.terms })} onClick={() => toggleDock(side, p.id)}>
              <p.icon size={16} />
            </button>
          ))}
          <button type="button" className="icon-btn dock-expand" {...iconTip(t('dock.expand'))} onClick={() => setDock(side, { open: true })}>
            <ExpandIcon size={14} />
          </button>
        </div>
      </div>
    );
  }

  const Active = active.component;
  return (
    <div className={`dock dock-${side}`} style={vertical ? { width: dock.size } : { height: dock.size }}>
      <div className={`dock-resizer dock-resizer-${side}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} />
      <div className="dock-header">
        <div className="dock-tabs" role="tablist">
          {panels.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === active.id}
              className={`dock-tab ${p.id === active.id ? 'active' : ''}`}
              onClick={() => setDock(side, { active: p.id })}
              {...tip(t(p.title), t(p.desc), undefined, { terms: p.terms })}
            >
              <p.icon size={14} />
              <span>{t(p.title)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" {...iconTip(t('dock.collapse'))} onClick={() => setDock(side, { open: false })}>
          <CollapseIcon size={14} />
        </button>
      </div>
      <div className="dock-body">
        <Active />
      </div>
    </div>
  );
}
