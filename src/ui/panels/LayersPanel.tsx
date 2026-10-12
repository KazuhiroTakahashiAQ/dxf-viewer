import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BookmarkPlus, Eye, EyeOff, Focus, Lock, Palette, RotateCcw, Snowflake, Sun, Trash2, TriangleAlert } from 'lucide-react';

import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { DocApi, LayerStateInfo } from '../../shared/docApi';
import { savedLayerStates, setSavedLayerStates, type SavedLayerState } from '../../storage/perFile';
import { activeTab, useUi } from '../../state/store';
import { rgbCss } from '../format';
import { iconTip, tip } from '../Tooltip';

export function LayersPanel() {
  const tab = useUi(activeTab);
  const setTab = useUi((s) => s.setTab);
  const background = useUi((s) => s.settings.background);
  const [filter, setFilter] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);
  const [fileStates, setFileStates] = useState<LayerStateInfo[]>([]);
  const [saved, setSaved] = useState<SavedLayerState[]>([]);
  const hash = tab?.summary?.hash;
  const ready = tab?.status === 'ready';
  const tabSession = tab ? sessions.get(tab.id) : undefined;
  useEffect(() => {
    if (!tabSession || !ready) return;
    let alive = true;
    void tabSession.rpc.call('layerStates', undefined).then((v) => alive && setFileStates(v));
    return () => {
      alive = false;
    };
  }, [tabSession, ready]);
  useEffect(() => setSaved(savedLayerStates(hash)), [hash]);

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
    setTab(tab.id, { layers, layerState: 'reset' in p ? undefined : tab.layerState ? `${tab.layerState.replace(/ \*$/, '')} *` : undefined });
  };
  const applyState = async (value: string) => {
    if (!session || !value) return;
    const [kind, name] = [value.slice(0, 2), value.slice(2)];
    let layers;
    if (kind === 'f:') layers = await session.rpc.call('applyLayerState', { name });
    else {
      const st = saved.find((x) => x.name === name);
      if (!st) return;
      layers = await session.rpc.call('applyLayerState', { custom: st.layers });
    }
    setTab(tab.id, { layers, layerState: value });
  };
  const saveState = () => {
    if (!hash) return;
    const name = prompt(t('layers.stateName'), t('layers.stateDefault', { n: saved.length + 1 }));
    if (!name) return;
    const next = [...saved.filter((x) => x.name !== name), { name, layers: (tab.layers ?? []).map((l) => ({ name: l.name, on: l.on, frozen: l.frozen })) }];
    setSaved(next);
    setSavedLayerStates(hash, next);
    setTab(tab.id, { layerState: `s:${name}` });
  };
  const current = tab.layerState ?? '';
  const overridden = (tab.layers ?? []).some((l) => l.propsOverridden);

  const fg = ((background >> 16) & 0xff) * 0.299 + ((background >> 8) & 0xff) * 0.587 + (background & 0xff) * 0.114 < 128 ? 0xffffff : 0x000000;

  return (
    <div className="panel layers-panel">
      <div className="panel-toolbar">
        <input className="search" type="search" placeholder={t('layers.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="icon-btn" {...iconTip(t('layers.allOn'))} onClick={() => apply({ all: { on: true, frozen: false } })}>
          <Eye size={15} />
        </button>
        <button type="button" className="icon-btn" {...iconTip(t('layers.allOff'))} onClick={() => apply({ all: { on: false } })}>
          <EyeOff size={15} />
        </button>
        <button type="button" className="icon-btn" {...iconTip(t('layers.reset'))} onClick={() => apply({ reset: true })}>
          <RotateCcw size={15} />
        </button>
      </div>
      <div className="panel-sub layer-states">
        <select value={current.endsWith(' *') ? '' : current} onChange={(e) => void applyState(e.target.value)} {...iconTip(t('layers.states'), t('panelDesc.layers'))}>
          <option value="">{current.endsWith(' *') ? t('layers.stateModified', { name: current.slice(2, -2) }) : t('layers.stateNone')}</option>
          {fileStates.length > 0 && (
            <optgroup label={t('layers.statesFile')}>
              {fileStates.map((s) => (
                <option key={s.name} value={`f:${s.name}`} title={s.description}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          {saved.length > 0 && (
            <optgroup label={t('layers.statesSaved')}>
              {saved.map((s) => (
                <option key={s.name} value={`s:${s.name}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="button" className="icon-btn" {...iconTip(t('layers.saveState'), t('layers.saveStateDesc'))} disabled={!hash} onClick={saveState}>
          <BookmarkPlus size={15} />
        </button>
        {current.startsWith('s:') && (
          <button
            type="button"
            className="icon-btn"
            {...iconTip(t('layers.deleteState'))}
            onClick={() => {
              if (!hash) return;
              const next = saved.filter((x) => `s:${x.name}` !== current);
              setSaved(next);
              setSavedLayerStates(hash, next);
              setTab(tab.id, { layerState: undefined });
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
        {overridden && (
          <span className="muted small" {...tip(t('layers.propsOverridden'))}>
            <Palette size={13} />
          </span>
        )}
      </div>
      {current.startsWith('f:') && fileStates.find((s) => `f:${s.name}` === current)?.description && (
        <div className="panel-sub muted small">{fileStates.find((s) => `f:${s.name}` === current)?.description}</div>
      )}
      <div className="panel-scroll" ref={parentRef}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const l = layers[vi.index];
            return (
              <div key={l.index} className={`layer-row ${l.on && !l.frozen ? '' : 'dim'}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}>
                <button type="button" className="icon-btn" {...iconTip(t('layers.on'), t('layers.onDesc'))} aria-pressed={l.on} onClick={() => apply({ changes: [{ index: l.index, on: !l.on }] })}>
                  {l.on ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button type="button" className="icon-btn" {...iconTip(t('layers.freeze'), t('layers.freezeDesc'))} aria-pressed={l.frozen} onClick={() => apply({ changes: [{ index: l.index, frozen: !l.frozen }] })}>
                  {l.frozen ? <Snowflake size={14} /> : <Sun size={14} />}
                </button>
                <span className="swatch" style={{ background: rgbCss(l.fg ? fg : l.rgb) }} {...tip(l.trueColor !== undefined ? rgbCss(l.trueColor) : `ACI ${l.aci}`)} />
                <span className="layer-name" title={l.name}>
                  {l.name}
                </span>
                {l.locked && (
                  <span className="layer-flag" {...iconTip(t('layers.locked'))}>
                    <Lock size={12} className="muted" />
                  </span>
                )}
                {l.undefinedInFile && (
                  <span className="layer-flag" {...iconTip(t('layers.undefined'))}>
                    <TriangleAlert size={12} className="warn" />
                  </span>
                )}
                <span className="layer-count" {...tip(t('layers.count', { count: l.count }))}>
                  {l.count}
                </span>
                <button
                  type="button"
                  className="icon-btn hover-only"
                  {...iconTip(t('layers.isolate'), t('layers.isolateDesc'))}
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
