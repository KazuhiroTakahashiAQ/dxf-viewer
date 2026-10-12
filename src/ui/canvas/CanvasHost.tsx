import { useEffect, useRef, useState } from 'react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { HoverInfo, SnapResult } from '../../shared/docApi';
import { emptyFilter, type SpatialSpec } from '../../shared/filterSpec';
import { panBy, screenToWorld, worldToScreen, zoomAt, type ViewState } from '../../shared/view';
import { useUi, type MeasureState } from '../../state/store';
import { measureFormat } from '../format';
import { measureText, POINTS_NEEDED } from '../measure';
import { drawGuides } from './guides';
import { drawMeasure, drawSnap } from './overlayDraw';
import { unitName } from '../format';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { CanvasHints, CanvasStateBar } from './CanvasState';

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
  const regionPick = useUi((s) => s.regionPick);

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
      // resize the overlay first: setViewport notifies view listeners that redraw it
      const ov = overlayRef.current;
      if (ov) {
        ov.width = Math.round(r.width * dpr);
        ov.height = Math.round(r.height * dpr);
      }
      session.setViewport({ width: Math.max(1, r.width), height: Math.max(1, r.height), dpr });
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

    /** transient feedback: selection/region box (screen) or polygon being drawn (world) */
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    let poly: number[] = [];
    let polyHover: { x: number; y: number } | null = null;
    /** measure tool: current snap and hover point (world) */
    let snapMark: SnapResult | null = null;
    let measureHover: [number, number] | null = null;
    let snapBusy = false;

    const spatialOfTab = (): SpatialSpec | undefined => useUi.getState().tabs.find((x) => x.id === tabId)?.filter?.spatial;

    const tracePoly = (pts: number[], close: boolean) => {
      octx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = worldToScreen(session.view, session.viewport, pts[i], pts[i + 1]);
        if (i === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
      }
      if (close) octx.closePath();
    };

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, el.width, el.height);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.lineWidth = 1;
      {
        const st = useUi.getState();
        const g = st.settings;
        if (g.showGrid || g.showAxes || g.showScaleBar || session.view.rotation || session.view.mirrorX || session.view.mirrorY)
          drawGuides(octx, session.view, session.viewport, {
            grid: g.showGrid,
            axes: g.showAxes,
            scaleBar: g.showScaleBar,
            background: g.background,
            unit: unitName(st.tabs.find((x) => x.id === tabId)?.summary?.insUnits),
          });
      }
      // spatial filter region of the tab
      const sp = spatialOfTab();
      if (sp) {
        const pts = sp.kind === 'rect' ? [sp.minX, sp.minY, sp.maxX, sp.minY, sp.maxX, sp.maxY, sp.minX, sp.maxY] : sp.points;
        octx.setLineDash([6, 4]);
        octx.strokeStyle = '#ffb74d';
        tracePoly(pts, true);
        octx.stroke();
      }
      if (poly.length) {
        octx.setLineDash([]);
        octx.strokeStyle = '#ffb74d';
        octx.fillStyle = 'rgba(255, 183, 77, 0.12)';
        const pts = polyHover ? [...poly, ...screenToWorld(session.view, session.viewport, polyHover.x, polyHover.y)] : poly;
        tracePoly(pts, pts.length >= 6);
        if (pts.length >= 6) octx.fill();
        octx.stroke();
        for (let i = 0; i < poly.length; i += 2) {
          const [x, y] = worldToScreen(session.view, session.viewport, poly[i], poly[i + 1]);
          octx.fillStyle = '#ffb74d';
          octx.fillRect(x - 2.5, y - 2.5, 5, 5);
        }
      }
      const ui = useUi.getState();
      const m = ui.measure;
      if (m && m.tabId === tabId && m.layout === session.layout) {
        const tab = ui.tabs.find((x) => x.id === tabId);
        const f = measureFormat(tab?.summary?.insUnits, tab?.summary?.luprec, ui.settings.coordPrecision);
        drawMeasure(octx, m, measureHover, session.view, session.viewport, measureText(m.mode, m.points, f, m.entity));
      }
      if (snapMark && ui.tool === 'measure') drawSnap(octx, snapMark, session.view, session.viewport);
      if (box) {
        const { x0, y0, x1, y1 } = box;
        const region = !!useUi.getState().regionPick;
        const crossing = x1 < x0;
        octx.fillStyle = region ? 'rgba(255, 183, 77, 0.12)' : crossing ? 'rgba(102, 187, 106, 0.12)' : 'rgba(79, 195, 247, 0.12)';
        octx.strokeStyle = region ? '#ffb74d' : crossing ? '#66bb6a' : '#4fc3f7';
        octx.setLineDash(crossing && !region ? [5, 4] : []);
        octx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        octx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      }
    };

    const clearOverlay = () => {
      box = null;
      render();
    };

    const drawBox = (x0: number, y0: number, x1: number, y1: number) => {
      box = { x0, y0, x1, y1 };
      render();
    };

    /** Store a drawn region as the spatial condition of the tab's filter (applied with the filter). */
    const finishRegion = (spatial: SpatialSpec | null) => {
      const ui = useUi.getState();
      const tab = ui.tabs.find((x) => x.id === tabId);
      poly = [];
      polyHover = null;
      box = null;
      ui.setRegionPick(null);
      if (tab && spatial) {
        const f = tab.filter ?? emptyFilter();
        ui.setTab(tabId, { filter: { ...f, spatial: { ...spatial, mode: f.spatial?.mode ?? 'crossing' } as SpatialSpec } });
      }
      render();
    };

    const unsubView = session.onViewChange(render);
    let lastSpatial = spatialOfTab();
    let lastPickMode = useUi.getState().regionPick;
    let lastMeasure = useUi.getState().measure;
    let lastTool = useUi.getState().tool;
    let lastSettings = useUi.getState().settings;
    const unsubUi = useUi.subscribe((st) => {
      if (st.settings !== lastSettings) {
        lastSettings = st.settings;
        render();
      }
      const sp = st.tabs.find((x) => x.id === tabId)?.filter?.spatial;
      if (st.measure !== lastMeasure || st.tool !== lastTool) {
        lastMeasure = st.measure;
        lastTool = st.tool;
        if (st.tool !== 'measure') {
          snapMark = null;
          measureHover = null;
        }
        el.classList.toggle('measuring', st.tool === 'measure');
        render();
      }
      if (sp !== lastSpatial || st.regionPick !== lastPickMode) {
        if (st.regionPick !== lastPickMode && !st.regionPick) {
          poly = [];
          polyHover = null;
        }
        lastSpatial = sp;
        lastPickMode = st.regionPick;
        render();
      }
    });

    const updateCursor = () => {
      moveScheduled = false;
      if (!lastMove) return;
      const p = local(lastMove);
      const [wx, wy] = screenToWorld(session.view, session.viewport, p.x, p.y);
      setCursor({ x: wx, y: wy });
      const st = useUi.getState();
      if (st.tool === 'measure' && !pan && !pinch) {
        measureHover = [wx, wy];
        if (st.settings.snap && !snapBusy && lastMove.pointerType !== 'touch') {
          snapBusy = true;
          void session.rpc
            .call('snap', { x: p.x, y: p.y, tolerance: 10, kinds: st.settings.snapKinds })
            .then((r) => {
              snapMark = r;
              if (r) {
                measureHover = [r.x, r.y];
                setCursor({ x: r.x, y: r.y });
              }
              render();
            })
            .finally(() => (snapBusy = false));
        } else {
          if (!st.settings.snap) snapMark = null;
          render();
        }
        return;
      }
      if (!pan && !pinch && !press?.box && !hoverBusy && lastMove.pointerType !== 'touch' && !useUi.getState().regionPick) {
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
      if (e.button === 1 || spaceDown || e.pointerType === 'touch' || tool === 'pan' || (tool === 'measure' && e.button === 0)) {
        pan = { x: p.x, y: p.y, view: session.view };
        el.classList.add('panning');
        if ((e.pointerType === 'touch' && tool !== 'pan') || (tool === 'measure' && e.button === 0)) press = { x: p.x, y: p.y, box: false, ev: e };
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
      if (poly.length && !pointers.size) {
        polyHover = local(e);
        render();
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

    const recordMeasure = (m: MeasureState) => {
      const ui = useUi.getState();
      const tab = ui.tabs.find((x) => x.id === tabId);
      const f = measureFormat(tab?.summary?.insUnits, tab?.summary?.luprec, ui.settings.coordPrecision);
      const text = measureText(m.mode, m.points, f, m.entity);
      if (text) ui.addMeasureRecord({ mode: m.mode, file: tab?.name ?? '', points: m.points, text });
    };

    const measureClick = async (p: { x: number; y: number }, s: DocumentSession) => {
      const ui = useUi.getState();
      const mode = ui.measureMode;
      if (mode === 'entity') {
        const r = await s.rpc.call('measureAt', p);
        const m: MeasureState = { tabId, layout: s.layout, mode, points: r?.center ? [...r.center] : [], done: true, entity: r ?? undefined };
        ui.setMeasure(r ? m : null);
        if (r) recordMeasure(m);
        return;
      }
      const pt = snapMark && ui.settings.snap ? [snapMark.x, snapMark.y] : screenToWorld(s.view, s.viewport, p.x, p.y);
      let m = ui.measure;
      if (!m || m.done || m.mode !== mode || m.tabId !== tabId || m.layout !== s.layout) m = { tabId, layout: s.layout, mode, points: [], done: false };
      const n = m.points.length;
      // ignore the second click of a double-click (same spot)
      if (n && Math.hypot(m.points[n - 2] - pt[0], m.points[n - 1] - pt[1]) * s.view.scale < 2) return;
      const points = [...m.points, ...pt];
      ui.setLastPoint([pt[0], pt[1]]);
      const done = points.length / 2 >= POINTS_NEEDED[mode];
      const next = { ...m, points, done };
      ui.setMeasure(next);
      if (done) recordMeasure(next);
    };

    /** Finish an open path/area measurement (double-click or Enter). */
    const finishMeasure = () => {
      const ui = useUi.getState();
      const m = ui.measure;
      if (!m || m.done || m.tabId !== tabId) return;
      const n = m.points.length / 2;
      if ((m.mode === 'path' && n >= 2) || (m.mode === 'area' && n >= 3)) {
        const next = { ...m, done: true };
        ui.setMeasure(next);
        recordMeasure(next);
      }
    };

    const finishPress = async (e: PointerEvent, s: DocumentSession) => {
      const pr = press;
      press = null;
      if (!pr) return;
      const p = local(e);
      const pickMode = useUi.getState().regionPick;
      if (pickMode === 'rect' && pr.box) {
        const c = [screenToWorld(s.view, s.viewport, pr.x, pr.y), screenToWorld(s.view, s.viewport, p.x, pr.y), screenToWorld(s.view, s.viewport, p.x, p.y), screenToWorld(s.view, s.viewport, pr.x, p.y)];
        const axisAligned = Math.abs(c[0][1] - c[1][1]) < 1e-9 * Math.max(1, Math.abs(c[0][1]));
        finishRegion(
          axisAligned
            ? { kind: 'rect', minX: Math.min(c[0][0], c[2][0]), minY: Math.min(c[0][1], c[2][1]), maxX: Math.max(c[0][0], c[2][0]), maxY: Math.max(c[0][1], c[2][1]), mode: 'crossing' }
            : { kind: 'polygon', points: c.flat(), mode: 'crossing' },
        );
        return;
      }
      if (pickMode === 'polygon') {
        if (pr.box) {
          clearOverlay();
          return;
        }
        const n = poly.length;
        const last = n ? worldToScreen(s.view, s.viewport, poly[n - 2], poly[n - 1]) : null;
        if (!last || Math.hypot(last[0] - p.x, last[1] - p.y) > 3) poly.push(...screenToWorld(s.view, s.viewport, p.x, p.y));
        render();
        return;
      }
      if (pickMode) return;
      if (useUi.getState().tool === 'measure') {
        await measureClick(p, s);
        return;
      }
      const current = useUi.getState().tabs.find((x) => x.id === tabId)?.selection ?? [];
      if (pr.box) {
        clearOverlay();
        const ids = await s.rpc.call('selectRect', { x0: pr.x, y0: pr.y, x1: p.x, y1: p.y, crossing: p.x < pr.x });
        s.setSelection(combineSelection(current, ids, e));
        lastPick = null;
        return;
      }
      useUi.getState().setLastPoint(screenToWorld(s.view, s.viewport, p.x, p.y));
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
      if (e.button === 0 && useUi.getState().tool === 'measure') finishMeasure();
      if (e.button === 0 && useUi.getState().regionPick === 'polygon' && poly.length >= 6) finishRegion({ kind: 'polygon', points: [...poly], mode: 'crossing' });
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
      const pickMode = useUi.getState().regionPick;
      if (e.type === 'keydown' && pickMode) {
        if (e.key === 'Escape') finishRegion(null);
        else if (e.key === 'Enter' && pickMode === 'polygon' && poly.length >= 6) finishRegion({ kind: 'polygon', points: [...poly], mode: 'crossing' });
        else if (e.key === 'Backspace' && poly.length) {
          poly.splice(-2, 2);
          render();
        }
        return;
      }
      if (e.type === 'keydown' && useUi.getState().tool === 'measure') {
        const ui = useUi.getState();
        if (e.key === 'Enter') return finishMeasure();
        if (e.key === 'Backspace' && ui.measure && !ui.measure.done && ui.measure.points.length) {
          ui.setMeasure({ ...ui.measure, points: ui.measure.points.slice(0, -2) });
          return;
        }
        if (e.key === 'Escape') {
          if (ui.measure) ui.setMeasure(null);
          else ui.setTool('select');
          return;
        }
      }
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
    render();
    return () => {
      unsubView();
      unsubUi();
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
      <canvas className={`overlay-canvas ${regionPick ? 'picking-region' : ''}`} ref={overlayRef} />
      <div className="canvas-top">
        {regionPick && (
          <div className="canvas-hint">
            {t(regionPick === 'rect' ? 'filter.region.rectHint' : 'filter.region.polygonHint')}
            <button type="button" className="tb-btn small-btn" onClick={() => useUi.getState().setRegionPick(null)}>
              {t('filter.region.cancel')}
            </button>
          </div>
        )}
        <CanvasStateBar tabId={tabId} />
      </div>
      <CanvasHints />
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
    const budget = useUi.getState().tabs.find((x) => x.id === session.id)?.build?.budgetExceeded ?? 0;
    if (single !== null && budget > 0)
      items.push({
        label: t('menu.expandReference'),
        action: async () => {
          const cost = await session.rpc.call('referenceCost', { id: single });
          if (cost > 3_000_000 && !window.confirm(t('menu.expandConfirm', { count: cost.toLocaleString() }))) return;
          const r = await session.rpc.call('expandReference', { id: single });
          if (!r.expanded) window.alert(t('menu.expandRefused', { count: r.cost.toLocaleString() }));
        },
      });
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
  items.push({
    label: t('menu.invertSelection'),
    action: async () => {
      const current = new Set(useUi.getState().tabs.find((x) => x.id === session.id)?.selection ?? []);
      const all = await session.rpc.call('selectAll', undefined);
      session.setSelection(all.filter((id) => !current.has(id)));
    },
  });
  items.push({ label: t('menu.showAll'), action: () => void session.setVisibility('show') });
  items.push({ label: t('menu.zoomExtents'), action: () => session.fit() });
  return items;
}
