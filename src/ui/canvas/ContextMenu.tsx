import { useEffect, useRef } from 'react';

import type { TermId } from '../../i18n/glossary';
import { tip } from '../Tooltip';

export interface MenuItem {
  label: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  /** CAD term explained when pointing at the item */
  term?: TermId;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  // keep the menu inside the canvas area
  const style: React.CSSProperties = { left: x, top: y };
  return (
    <div className="context-menu" ref={ref} style={style} role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            {...(it.term ? tip(it.label, undefined, undefined, { terms: it.term, side: true }) : {})}
            onClick={() => {
              onClose();
              it.action?.();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
