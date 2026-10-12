import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';

import { getLocale, shortcut, t } from '../i18n';
import { entityTypeDesc, isTermId, term, type TermId } from '../i18n/glossary';

export interface TipProps {
  'data-tip': string;
  'data-tip-desc'?: string;
  'data-tip-keys'?: string;
  'data-tip-terms'?: string;
  'data-tip-side'?: '';
  'aria-label'?: string;
}

export interface TipOptions {
  /** glossary terms explained below the description (for people new to CAD) */
  terms?: TermId | TermId[];
  /** place beside the element instead of below it (menu items, list rows) */
  side?: boolean;
}

/**
 * Attributes that give an element a tooltip: a title line, an optional
 * explanation, an optional shortcut ("F", "Ctrl+Shift+F", alternatives
 * separated by " / ") and optional glossary terms. One TooltipLayer shows
 * them for the whole app.
 */
export function tip(title: string, desc?: string, keys?: string, opts?: TipOptions): TipProps {
  const p: TipProps = { 'data-tip': title };
  if (desc) p['data-tip-desc'] = desc;
  if (keys) p['data-tip-keys'] = keys;
  if (opts?.terms) p['data-tip-terms'] = ([] as TermId[]).concat(opts.terms).join(' ');
  if (opts?.side) p['data-tip-side'] = '';
  return p;
}

/** tip() for icon-only controls: the title also names the control for screen readers. */
export function iconTip(title: string, desc?: string, keys?: string, opts?: TipOptions): TipProps {
  return { ...tip(title, desc, keys, opts), 'aria-label': title };
}

/** Tooltip that explains a glossary term (title = the term, then its explanation). */
export function termTip(id: TermId, opts?: Omit<TipOptions, 'terms'>): TipProps {
  const { name, desc } = term(id);
  return tip(name, desc, undefined, opts);
}

/** Tooltip that says what an entity type (LINE, INSERT…) is. */
export function typeTip(type: string, opts?: TipOptions): TipProps {
  return tip(type, entityTypeDesc(type), undefined, opts);
}

/** An entity type name (LINE, INSERT…); hovering says what the type is. */
export function TypeName({ type, side }: { type: string; side?: boolean }) {
  const desc = entityTypeDesc(type);
  if (!desc) return <>{type}</>;
  return (
    <span className="term" {...tip(type, desc, undefined, { side })}>
      {type}
    </span>
  );
}

/** A label for a CAD term: dotted underline, and hovering explains the term. */
export function Term({ id, children, side }: { id: TermId; children?: ReactNode; side?: boolean }) {
  return (
    <span className="term" {...termTip(id, { side })}>
      {children ?? term(id).name}
    </span>
  );
}

/** Shortcut chips ("Ctrl+Shift+F / F1" → ⌘⇧F, F1 on Apple platforms). */
export function Keys({ keys }: { keys: string }) {
  return (
    <span className="keys">
      {keys.split(' / ').map((k) => (
        <kbd key={k}>{shortcut(k)}</kbd>
      ))}
    </span>
  );
}

interface Shown {
  title: string;
  desc?: string;
  keys?: string;
  terms: TermId[];
  side: boolean;
  rect: DOMRect;
}

const DELAY = 450;
/** after a tooltip was visible, the next one appears almost at once */
const WARM_DELAY = 60;
const WARM_MS = 600;

/** Delegated tooltips for every element with `data-tip` (mouse hover and keyboard focus). */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: Element | null = null;
    let visible = false;
    let hiddenAt = 0;
    const show = (el: HTMLElement) => {
      const title = el.dataset.tip;
      if (!title || !el.isConnected) return;
      visible = true;
      const terms = (el.dataset.tipTerms ?? '').split(' ').filter(isTermId);
      setShown({ title, desc: el.dataset.tipDesc, keys: el.dataset.tipKeys, terms, side: el.dataset.tipSide !== undefined, rect: el.getBoundingClientRect() });
    };
    const hide = () => {
      clearTimeout(timer);
      if (visible) hiddenAt = performance.now();
      visible = false;
      current = null;
      setShown(null);
    };
    const schedule = (el: HTMLElement) => {
      if (el === current) return;
      clearTimeout(timer);
      current = el;
      const warm = visible || performance.now() - hiddenAt < WARM_MS;
      if (visible) setShown(null);
      visible = false;
      timer = window.setTimeout(() => show(el), warm ? WARM_DELAY : DELAY);
    };
    const tipTarget = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null);
    const onOver = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const el = tipTarget(e.target);
      if (el) schedule(el);
      else if (current) hide();
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = tipTarget(e.target);
      if (el && el === e.target && el.matches(':focus-visible')) schedule(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // place below the element (above when there is no room) or beside it, inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = shown.rect;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (shown.side && (r.right + 8 + w <= W - 8 || r.left - 8 - w >= 8)) {
      const left = r.right + 8 + w <= W - 8 ? r.right + 8 : r.left - 8 - w;
      setPos({ left, top: Math.max(8, Math.min(H - h - 8, r.top)) });
      return;
    }
    const left = Math.max(8, Math.min(W - w - 8, r.left + r.width / 2 - w / 2));
    let top = r.bottom + 6;
    if (top + h > H - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left, top });
  }, [shown]);

  if (!shown) return null;
  return (
    <div ref={ref} className="tooltip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      <div className="tooltip-title">
        <span>{shown.title}</span>
        {shown.keys && <Keys keys={shown.keys} />}
      </div>
      {shown.desc && <div className="tooltip-desc">{shown.desc}</div>}
      {shown.terms.map((id) => {
        const tm = term(id);
        return (
          <div key={id} className="tooltip-term">
            <div className="tooltip-term-name">
              <BookOpen size={12} />
              {/* Japanese puts a space between Latin letters and kana: "DXF とは", "ブロックとは" */}
              {t('tip.whatIs', { term: getLocale() === 'ja' && /[!-~]$/.test(tm.name) ? `${tm.name} ` : tm.name })}
            </div>
            <div>{tm.desc}</div>
          </div>
        );
      })}
    </div>
  );
}
