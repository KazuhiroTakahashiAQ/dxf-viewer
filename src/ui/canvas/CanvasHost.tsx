import { useEffect, useRef, useState } from 'react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { HoverInfo } from '../../shared/docApi';
import { panBy, screenToWorld, zoomAt, type ViewState } from '../../shared/view';
import { useUi } from '../../state/store';
import { ContextMenu, type MenuItem } from './ContextMenu';

interface PointerInfo {
  x: number;
  y: number;
}

/** Apply a pick/box result to the selection using keyboard modifiers. */
export function combineSelection(current: number[], ids: number[], e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): number[] {
  if (e.ctrlKey || e.metaKey) {
    const set = new Set(current);
    for (const id of ids) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    return [...set];
  }
  if (e.shiftKey) return [...new Set([...current, ...ids])];
  return ids;
}

/** Heuristic: trackpads send small/fractional pixel deltas, mouse wheels coarse steps. */
function isTrackpadScroll(e: WheelEvent): boolean {
  if (e.ctrlKey || e.deltaMode !== 0) return false;
  if (e.deltaX !== 0) return true;
  return !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40;
}

/**
 * Hosts the active document's worker-rendered canvases plus a main-thread
 * overlay canvas for interaction feedback (window/crossing rectangles).
 */
export function CanvasHost({ tabId }: { tabId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const setCursor = useUi((s) => s.setCursor);
  const [hover, setHover] = useState<{ info: HoverInfo; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // mount the session canvases
  useEffect(() => {
    const host = hostRef.current;
    const session = sessions.get(tabId);
    if (!host || !session) return;
    host.prepend(session.highlight);
    host.prepend(session.canvas);
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      session.setViewport({ width: Math.max(1, r.width), height: Math.max(1, r.height), dpr });
      const ov = overlayRef.current;
      if (ov) {
        ov.width = Math.round(r.width * dpr);
        ov.height = Math.round(r.height * dpr);
      }
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      session.canvas.remove();
      session.highlight.remove();
    };
  }, [tabId]);

  // pointer / wheel / touch interaction
  useEffect(() => {
    const el = overlayRef.current;
    const session = sessions.get(tabId);
    if (!el || !session) return;
    const octx = el.getContext('2d')!;
    const pointers = new Map<number, PointerInfo>();
    let pan: { x: number; y: number; view: ViewState } | null = null;
    let pinch: { dist: number; cx: number; cy: number; view: ViewState } | null = null;
    let press: { x: number; y: number; box: boolean; ev: PointerEvent } | null = null;
    let spaceDown = false;
    let lastMove: PointerEvent | null = null;
    let moveScheduled = false;
    let hoverBusy = false;
    let lastPick: { x: number; y: number; ids: number[]; index: number } | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const clearOverlay = () => {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, el.width, el.height);
    };

    const drawBox = (x0: number, y0: number, x1: number, y1: number) => {
      const dpr = window.devicePixelRatio || 1;
      clearOverlay();
      const crossing = x1 < x0;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.fillStyle = crossing ? 'rgba(102, 187, 106, 0.12)' : 'rgba(79, 195, 247, 0.12)';
      octx.strokeStyle = crossing ? '#66bb6a' : '#4fc3f7';
      octx.lineWidth = 1;
      octx.setLineDash(crossing ? [5, 4] : []);
      octx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      octx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    };

    const updateCursor = () => {
      moveScheduled = false;
      if (!lastMove) return;
      const p = local(lastMove);
      const [wx, wy] = screenToWorld(session.view, session.viewport, p.x, p.y);
      setCursor({ x: wx, y: wy });
      if (!pan && !pinch && !press?.box && !hoverBusy && lastMove.pointerType !== 'touch') {
        hoverBusy = true;
        void session.rpc
          .call('hover', p)
          .then((info) => setHover(info ? { info, x: p.x, y: p.y } : null))
          .finally(() => (hoverBusy = false));
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      if (isTrackpadScroll(e) && useUi.getState().settings.trackpadPan) {
        session.setView(panBy(session.view, session.viewport, -e.deltaX, -e.deltaY));
        return;
      }
      const factorBase = useUi.getState().settings.wheelZoomFactor;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.pow(factorBase, -delta / (e.ctrlKey ? 25 : 100));
      session.setView(zoomAt(session.view, session.viewport, p.x, p.y, factor));
    };

    const onPointerDown = (e: PointerEvent) => {
      setMenu(null);
      if (e.button === 2) return;
      el.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: session.view };
        pan = null;
        press = null;
        return;
      }
      const tool = useUi.getState().tool;
      if (e.button === 1 || spaceDown || e.pointerType === 'touch' || tool === 'pan') {
        pan = { x: p.x, y: p.y, view: session.view };
        el.classList.add('panning');
        if (e.pointerType === 'touch' && tool !== 'pan') press = { x: p.x, y: p.y, box: false, ev: e };
        if (e.button === 1) e.preventDefault();
        return;
      }
      if (e.button === 0) press = { x: p.x, y: p.y, box: false, ev: e };
    };

    const onPointerMove = (e: PointerEvent) => {
      lastMove = e;
      if (!moveScheduled) {
        moveScheduled = true;
        requestAnimationFrame(updateCursor);
      }
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        let v = zoomAt(pinch.view, session.viewport, pinch.cx, pinch.cy, dist / Math.max(1, pinch.dist));
        v = panBy(v, session.viewport, (a.x + b.x) / 2 - pinch.cx, (a.y + b.y) / 2 - pinch.cy);
        session.setView(v);
        return;
      }
      if (pan) {
        if (press && Math.hypot(p.x - press.x, p.y - press.y) > 6) press = null;
        session.setView(panBy(pan.view, session.viewport, p.x - pan.x, p.y - pan.y));
        return;
      }
      if (press) {
        if (!press.box && Math.hypot(p.x - press.x, p.y - press.y) > 4) {
          press.box = true;
          setHover(null);
        }
        if (press.box) drawBox(press.x, press.y, p.x, p.y);
      }
    };

    const finishPress = async (e: PointerEvent, s: DocumentSession) => {
      const pr = press;
      press = null;
      if (!pr) return;
      const p = local(e);
      const current = useUi.getState().tabs.find((x) => x.id === tabId)?.selection ?? [];
      if (pr.box) {
        clearOverlay();
        const ids = await s.rpc.call('selectRect', { x0: pr.x, y0: pr.y, x1: p.x, y1: p.y, crossing: p.x < pr.x });
        s.setSelection(combineSelection(current, ids, e));
        lastPick = null;
        return;
      }
      const ids = await s.rpc.call('pick', { x: p.x, y: p.y, tolerance: e.pointerType === 'touch' ? 12 : 5 });
      const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
      // repeated clicks at the same spot cycle through overlapping entities
      if (plain && lastPick && Math.hypot(lastPick.x - p.x, lastPick.y - p.y) < 3 && ids.length > 1 && ids.join() === lastPick.ids.join()) {
        lastPick.index = (lastPick.index + 1) % ids.length;
        s.setSelection([ids[lastPick.index]]);
        return;
      }
      lastPick = { x: p.x, y: p.y, ids, index: 0 };
      if (!ids.length) {
        if (plain) s.setSelection([]);
        return;
      }
      s.setSelection(combineSelection(current, [ids[0]], e));
    };

    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        if (press && (e.type === 'pointerup' || e.type === 'pointercancel')) void finishPress(e, session);
        pan = null;
        el.classList.remove('panning');
      }
    };

    const onLeave = () => {
      lastMove = null;
      setCursor(null);
      setHover(null);
      void session.rpc.call('hover', null);
    };

    const onDblClick = (e: MouseEvent) => {
      if (e.button === 1) session.fit();
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    const onContextMenu = async (e: MouseEvent) => {
      e.preventDefault();
      const p = local(e);
      const ids = await session.rpc.call('pick', { x: p.x, y: p.y });
      const current = useUi.getState().tabs.find((x) => x.id === tabId)?.selection ?? [];
      let target = current;
      if (ids.length && !current.includes(ids[0])) {
        target = [ids[0]];
        session.setSelection(target);
      }
      setMenu({ x: p.x, y: p.y, items: contextItems(session, target) });
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') spaceDown = e.type === 'keydown';
      if (e.type === 'keydown' && e.key === 'Escape') {
        session.setSelection([]);
        setMenu(null);
        clearOverlay();
        press = null;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('auxclick', onAuxClick);
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('auxclick', onAuxClick);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [tabId, setCursor]);

  return (
    <div className="canvas-host" ref={hostRef}>
      <canvas className="overlay-canvas" ref={overlayRef} />
      {hover && (
        <div
          className="hover-tip"
          style={{
            left: hover.x + 14,
            top: hover.y + 14,
            transform: hover.x > (hostRef.current?.clientWidth ?? 0) - 260 ? 'translateX(calc(-100% - 28px))' : undefined,
          }}
        >
          <b>{hover.info.type}</b> · {hover.info.layer} · <span className="mono">{hover.info.handle}</span>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function contextItems(session: DocumentSession, ids: number[]): MenuItem[] {
  const single = ids.length === 1 ? ids[0] : null;
  const select = async (by: 'type' | 'layer' | 'block' | 'color') => {
    if (single === null) return;
    session.setSelection(await session.rpc.call('selectSimilar', { id: single, by }));
  };
  const items: MenuItem[] = [];
  if (ids.length) {
    items.push({ label: t('menu.zoomTo'), action: () => void session.zoomToEntities(ids) });
    if (single !== null) {
      items.push({ label: t('menu.selectSameType'), action: () => void select('type') });
      items.push({ label: t('menu.selectSameLayer'), action: () => void select('layer') });
      items.push({ label: t('menu.selectSameBlock'), action: () => void select('block') });
      items.push({ label: t('menu.selectSameColor'), action: () => void select('color') });
    }
    items.push({ separator: true, label: '' });
    items.push({ label: t('menu.hide'), action: () => void session.setVisibility('hide', ids) });
    items.push({ label: t('menu.isolate'), action: () => void session.setVisibility('isolate', ids) });
    if (single !== null)
      items.push({
        label: t('menu.copyHandle'),
        action: async () => {
          const info = await session.rpc.call('hoverInfo', { id: single });
          if (info) void navigator.clipboard?.writeText(info.handle);
        },
      });
    items.push({ separator: true, label: '' });
  }
  items.push({ label: t('menu.selectAll'), action: async () => session.setSelection(await session.rpc.call('selectAll', undefined)) });
  items.push({ label: t('menu.showAll'), action: () => void session.setVisibility('show') });
  items.push({ label: t('menu.zoomExtents'), action: () => session.fit() });
  return items;
}
