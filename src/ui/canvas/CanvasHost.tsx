import { useEffect, useRef } from 'react';

import { sessions } from '../../session/DocumentSession';
import { panBy, screenToWorld, zoomAt, type ViewState } from '../../shared/view';
import { useUi } from '../../state/store';

interface PointerInfo {
  x: number;
  y: number;
}

/**
 * Hosts the active document's worker-rendered canvas plus a main-thread
 * overlay canvas for interaction feedback (crosshair, rubber bands).
 */
export function CanvasHost({ tabId }: { tabId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const setCursor = useUi((s) => s.setCursor);

  // mount the session canvas
  useEffect(() => {
    const host = hostRef.current;
    const session = sessions.get(tabId);
    if (!host || !session) return;
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
    };
  }, [tabId]);

  // pointer / wheel / touch interaction
  useEffect(() => {
    const el = overlayRef.current;
    const session = sessions.get(tabId);
    if (!el || !session) return;
    const pointers = new Map<number, PointerInfo>();
    let dragStart: { x: number; y: number; view: ViewState } | null = null;
    let pinchStart: { dist: number; cx: number; cy: number; view: ViewState } | null = null;
    let spaceDown = false;
    let lastMove: PointerEvent | null = null;
    let moveScheduled = false;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const updateCursor = () => {
      moveScheduled = false;
      if (!lastMove) return;
      const p = local(lastMove);
      const [wx, wy] = screenToWorld(session.view, session.viewport, p.x, p.y);
      setCursor({ x: wx, y: wy });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const factorBase = useUi.getState().settings.wheelZoomFactor;
      // trackpad pinch arrives as ctrl+wheel with small deltas
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.pow(factorBase, -delta / (e.ctrlKey ? 25 : 100));
      session.setView(zoomAt(session.view, session.viewport, p.x, p.y, factor));
    };

    const onPointerDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: session.view };
        dragStart = null;
        return;
      }
      // left (or touch), middle, or space+left drag pans
      if (e.button === 0 || e.button === 1 || spaceDown) {
        dragStart = { x: p.x, y: p.y, view: session.view };
        el.classList.add('panning');
      }
      if (e.button === 1) e.preventDefault();
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
      if (pinchStart && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        let v = zoomAt(pinchStart.view, session.viewport, pinchStart.cx, pinchStart.cy, dist / Math.max(1, pinchStart.dist));
        v = panBy(v, session.viewport, cx - pinchStart.cx, cy - pinchStart.cy);
        session.setView(v);
        return;
      }
      if (dragStart) {
        session.setView(panBy(dragStart.view, session.viewport, p.x - dragStart.x, p.y - dragStart.y));
      }
    };

    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        dragStart = null;
        el.classList.remove('panning');
      }
    };

    const onLeave = () => {
      lastMove = null;
      setCursor(null);
    };

    const onDblClick = (e: MouseEvent) => {
      if (e.button === 1 || e.button === 0) session.fit();
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT') spaceDown = e.type === 'keydown';
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('auxclick', onAuxClick);
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
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [tabId, setCursor]);

  return (
    <div className="canvas-host" ref={hostRef}>
      <canvas className="overlay-canvas" ref={overlayRef} />
    </div>
  );
}
