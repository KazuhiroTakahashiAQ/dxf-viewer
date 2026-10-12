import { useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, ChevronDown, ChevronRight, Link2, Pentagon, Play, Plus, Scan, Square, Trash2, X } from 'lucide-react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { FilterCatalog } from '../../shared/docApi';
import {
  emptyFilter,
  encodeFilter,
  isEmptyFilter,
  OPS_BY_TYPE,
  regexIssues,
  riskyPattern,
  type CatalogProp,
  type FacetKey,
  type FilterCond,
  type FilterGroup,
  type FilterOp,
  type FilterSpec,
  type SpatialSpec,
} from '../../shared/filterSpec';
import { screenToWorld } from '../../shared/view';
import { activeTab, useUi } from '../../state/store';

const fmt = (v: number) => String(Number(v.toPrecision(6)));

/** The visible area of the view as a region (a polygon when the view is rotated). */
function viewRegion(session: DocumentSession, mode: 'inside' | 'crossing' = 'crossing'): SpatialSpec {
  const { width, height } = session.viewport;
  const c = [screenToWorld(session.view, session.viewport, 0, 0), screenToWorld(session.view, session.viewport, width, 0), screenToWorld(session.view, session.viewport, width, height), screenToWorld(session.view, session.viewport, 0, height)];
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  const axisAligned = new Set(xs.map((x) => x.toPrecision(12))).size <= 2 && new Set(ys.map((y) => y.toPrecision(12))).size <= 2;
  return axisAligned ? { kind: 'rect', minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), mode } : { kind: 'polygon', points: c.flat(), mode };
}

const FACET_KEYS: FacetKey[] = ['type', 'layer', 'block', 'color', 'linetype', 'lineweight', 'style', 'xdata'];
const PRESETS_KEY = 'dxfv.filterPresets.v1';

function loadPresets(): { name: string; spec: FilterSpec }[] {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function savePresets(p: { name: string; spec: FilterSpec }[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Property metadata for any key (catalog, raw codes, xdata, attributes, fields). */
function propInfo(key: string, catalog: FilterCatalog | null): CatalogProp {
  const c = catalog?.props.find((p) => p.key === key);
  if (c) return c;
  if (key.startsWith('gc[')) return { key, label: `Group code ${key.slice(3, -1)}`, type: 'string', group: 'Raw' };
  if (key.startsWith('xdata.')) return { key, label: `XDATA ${key.slice(6)}`, type: /\[\d+\]$/.test(key) ? 'string' : 'boolean', group: 'Data' };
  if (key.startsWith('attr.')) return { key, label: `Attribute ${key.slice(5)}`, type: 'string', group: 'Blocks' };
  if (key.startsWith('field.')) return { key, label: `Field ${key.slice(6)}`, type: 'string', group: 'Fields' };
  return { key, label: key, type: 'string', group: '' };
}

function Facet({ name, values, selected, onChange }: { name: FacetKey; values: [string, number][]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(selected.length > 0);
  const [q, setQ] = useState('');
  const list = useMemo(() => (q ? values.filter(([v]) => v.toLowerCase().includes(q.toLowerCase())) : values), [values, q]);
  const sel = new Set(selected);
  return (
    <div className="facet">
      <button type="button" className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {t(`filter.facet.${name}` as never)}
        <span className="muted small">{selected.length ? t('filter.nSelected', { count: selected.length }) : values.length}</span>
        {selected.length > 0 && (
          <span
            className="facet-clear"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
          >
            <X size={12} />
          </span>
        )}
      </button>
      {open && (
        <div className="facet-body">
          {values.length > 10 && <input className="search" type="search" placeholder={t('filter.facetSearch')} value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="facet-list">
            {list.slice(0, 500).map(([v, n]) => (
              <label key={v} className="facet-item">
                <input
                  type="checkbox"
                  checked={sel.has(v)}
                  onChange={(e) => {
                    const next = new Set(sel);
                    if (e.target.checked) next.add(v);
                    else next.delete(v);
                    onChange([...next]);
                  }}
                />
                <span className="facet-value" title={v}>
                  {v}
                </span>
                <span className="muted small">{n.toLocaleString()}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CondRow({
  cond,
  catalog,
  session,
  level,
  onChange,
  onRemove,
}: {
  cond: FilterCond;
  catalog: FilterCatalog | null;
  session: DocumentSession;
  level: 'top' | 'leaf';
  onChange: (c: FilterCond) => void;
  onRemove: () => void;
}) {
  const info = propInfo(cond.prop, catalog);
  const ops = OPS_BY_TYPE[info.type];
  const [suggest, setSuggest] = useState<[string, number][]>([]);
  const listId = useMemo(() => `vals-${Math.random().toString(36).slice(2)}`, []);
  const groups = useMemo(() => {
    const g = new Map<string, CatalogProp[]>();
    for (const p of catalog?.props ?? []) {
      if (!g.has(p.group)) g.set(p.group, []);
      g.get(p.group)!.push(p);
    }
    return [...g.entries()];
  }, [catalog]);
  const risky = cond.op === 'regex' && cond.value ? riskyPattern(cond.value) : false;
  return (
    <div className="cond-row">
      <select value={cond.prop} onChange={(e) => onChange({ ...cond, prop: e.target.value, op: OPS_BY_TYPE[propInfo(e.target.value, catalog).type].includes(cond.op) ? cond.op : propInfo(e.target.value, catalog).type === 'number' ? 'gt' : 'contains' })}>
        {groups.map(([g, props]) => (
          <optgroup key={g} label={g}>
            {props.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
        {!!catalog?.attrTags.length && (
          <optgroup label={t('filter.attributes')}>
            {catalog.attrTags.map((a) => (
              <option key={a} value={`attr.${a}`}>
                {a}
              </option>
            ))}
          </optgroup>
        )}
        {!!catalog?.xdataApps.length && (
          <optgroup label="XDATA">
            {catalog.xdataApps.map((a) => (
              <option key={a} value={`xdata.${a}`}>
                {a}
              </option>
            ))}
          </optgroup>
        )}
        {!!catalog?.gcCodes.length && (
          <optgroup label={t('filter.rawCodes')}>
            {catalog.gcCodes.map((c) => (
              <option key={c} value={`gc[${c}]`}>
                {`${c}`}
              </option>
            ))}
          </optgroup>
        )}
        {!!catalog?.fields.length && (
          <optgroup label={t('filter.fields')}>
            {catalog.fields.map((f) => (
              <option key={f} value={`field.${f}`}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
        {!catalog?.props.some((p) => p.key === cond.prop) && <option value={cond.prop}>{info.label}</option>}
      </select>
      <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as FilterOp })}>
        {ops.map((o) => (
          <option key={o} value={o}>
            {t(`filter.op.${o}` as never)}
          </option>
        ))}
      </select>
      {cond.op !== 'exists' && cond.op !== 'notExists' && (
        <>
          <input
            className="cond-value"
            list={listId}
            value={cond.value ?? ''}
            placeholder={cond.op === 'in' ? t('filter.inPlaceholder') : info.type === 'boolean' ? 'true / false' : ''}
            onFocus={() => void session.rpc.call('filterValues', { prop: cond.prop, level, limit: 200 }).then(setSuggest)}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}
            aria-invalid={risky}
            title={risky ? t('filter.riskyRegex') : undefined}
          />
          <datalist id={listId}>
            {suggest.map(([v, n]) => (
              <option key={v} value={v}>{`${n}`}</option>
            ))}
          </datalist>
          {cond.op === 'between' && <input className="cond-value" value={cond.value2 ?? ''} onChange={(e) => onChange({ ...cond, value2: e.target.value })} />}
        </>
      )}
      {info.type === 'string' && (
        <label className="case-toggle" title={t('texts.caseSensitive')}>
          <input type="checkbox" checked={!!cond.caseSensitive} onChange={(e) => onChange({ ...cond, caseSensitive: e.target.checked })} />
          Aa
        </label>
      )}
      <button type="button" className="icon-btn" title={t('filter.remove')} onClick={onRemove}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  catalog,
  session,
  level,
  depth,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  catalog: FilterCatalog | null;
  session: DocumentSession;
  level: 'top' | 'leaf';
  depth: number;
  onChange: (g: FilterGroup) => void;
  onRemove?: () => void;
}) {
  const setItem = (i: number, item: FilterCond | FilterGroup | null) => {
    const items = [...group.items];
    if (item) items[i] = item;
    else items.splice(i, 1);
    onChange({ ...group, items });
  };
  return (
    <div className={`cond-group depth-${depth % 3}`}>
      <div className="cond-group-head">
        <select value={group.logic} onChange={(e) => onChange({ ...group, logic: e.target.value as 'and' | 'or' })}>
          <option value="and">{t('filter.all')}</option>
          <option value="or">{t('filter.any')}</option>
        </select>
        <label className="case-toggle">
          <input type="checkbox" checked={!!group.not} onChange={(e) => onChange({ ...group, not: e.target.checked })} />
          {t('filter.not')}
        </label>
        <span className="tb-spacer" />
        <button type="button" className="tb-btn small-btn" onClick={() => onChange({ ...group, items: [...group.items, { kind: 'cond', prop: 'layer', op: 'contains', value: '' }] })}>
          <Plus size={12} />
          {t('filter.addCondition')}
        </button>
        {depth < 4 && (
          <button type="button" className="tb-btn small-btn" onClick={() => onChange({ ...group, items: [...group.items, { kind: 'group', logic: 'or', items: [] }] })}>
            <Plus size={12} />
            {t('filter.addGroup')}
          </button>
        )}
        {onRemove && (
          <button type="button" className="icon-btn" title={t('filter.remove')} onClick={onRemove}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {group.items.map((it, i) =>
        it.kind === 'cond' ? (
          <CondRow key={i} cond={it} catalog={catalog} session={session} level={level} onChange={(c) => setItem(i, c)} onRemove={() => setItem(i, null)} />
        ) : (
          <GroupEditor key={i} group={it} catalog={catalog} session={session} level={level} depth={depth + 1} onChange={(g) => setItem(i, g)} onRemove={() => setItem(i, null)} />
        ),
      )}
    </div>
  );
}

export function FilterPanel() {
  const tab = useUi(activeTab);
  const setTab = useUi((s) => s.setTab);
  const pending = useUi((s) => s.pendingFilter);
  const setPending = useUi((s) => s.setPendingFilter);
  const regionPick = useUi((s) => s.regionPick);
  const setRegionPick = useUi((s) => s.setRegionPick);
  const session = tab ? sessions.get(tab.id) : undefined;
  const spec = tab?.filter ?? emptyFilter();
  const [catalog, setCatalog] = useState<FilterCatalog | null>(null);
  const [facets, setFacets] = useState<Partial<Record<FacetKey, [string, number][]>>>({});
  const [presets, setPresets] = useState(loadPresets);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const ready = tab?.status === 'ready';

  useEffect(() => {
    if (!session || !ready) return;
    let alive = true;
    void session.rpc.call('filterCatalog', undefined).then((c) => alive && setCatalog(c));
    void session.rpc.call('filterFacets', { level: spec.level }).then((f) => alive && setFacets(f));
    return () => {
      alive = false;
    };
  }, [session, ready, spec.level, tab?.layout]);

  if (!tab || !session) return <div className="panel-empty">—</div>;
  const update = (patch: Partial<FilterSpec>) => setTab(tab.id, { filter: { ...spec, ...patch } });
  const apply = async (s: FilterSpec = spec) => {
    setBusy(true);
    try {
      await session.applyFilter(isEmptyFilter(s) && s.mode !== 'select' ? null : s);
      if (!isEmptyFilter(s)) useUi.getState().setDock('bottom', { open: true, active: 'results' });
    } finally {
      setBusy(false);
    }
  };
  const result = tab.filterResult;
  const share = async () => {
    const url = new URL(location.href);
    url.hash = `filter=${encodeFilter(spec)}`;
    await navigator.clipboard?.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="panel panel-scroll filter-panel">
      {pending && (
        <div className="pending-filter">
          <b>{t('filter.sharedTitle')}</b>
          <p className="small">{t('filter.sharedHelp')}</p>
          <pre className="mono small">{JSON.stringify({ mode: pending.mode, level: pending.level, facets: pending.facets, where: pending.where, spatial: pending.spatial }, null, 1)}</pre>
          {JSON.stringify(pending.where).includes('"regex"') && <p className="warn-text small">{t('filter.sharedRegex')}</p>}
          {regexIssues(pending).map((r) => (
            <p key={r.pattern} className="warn-text small">
              {t(r.reason === 'risky' ? 'filter.rejectedRisky' : 'filter.rejectedInvalid', { pattern: r.pattern })}
            </p>
          ))}
          <div className="row-actions">
            <button
              type="button"
              className="tb-btn"
              onClick={() => {
                setTab(tab.id, { filter: pending });
                setPending(null);
              }}
            >
              {t('filter.loadShared')}
            </button>
            <button type="button" className="tb-btn" onClick={() => setPending(null)}>
              {t('pwa.dismiss')}
            </button>
          </div>
        </div>
      )}
      <div className="panel-section filter-mode">
        <div className="seg" role="radiogroup" aria-label={t('filter.mode')}>
          {(['show', 'highlight', 'select'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={spec.mode === m} className={spec.mode === m ? 'on' : ''} onClick={() => update({ mode: m })}>
              {t(`filter.mode.${m}` as never)}
            </button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label={t('filter.level')}>
          {(['top', 'leaf'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={spec.level === l} className={spec.level === l ? 'on' : ''} onClick={() => update({ level: l })} title={t(`filter.level.${l}.help` as never)}>
              {t(`filter.level.${l}` as never)}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <div className="section-head">
          <b>{t('filter.facets')}</b>
        </div>
      </div>
      {FACET_KEYS.filter((k) => facets[k]?.length).map((k) => (
        <Facet key={k} name={k} values={facets[k]!} selected={spec.facets[k] ?? []} onChange={(v) => update({ facets: { ...spec.facets, [k]: v } })} />
      ))}
      <div className="panel-section">
        <div className="section-head">
          <b>{t('filter.conditions')}</b>
        </div>
        <GroupEditor group={spec.where} catalog={catalog} session={session} level={spec.level} depth={0} onChange={(g) => update({ where: g })} />
      </div>
      <div className="panel-section">
        <div className="section-head">
          <b>{t('filter.region')}</b>
        </div>
        <div className="spatial-row">
          <button type="button" className="tb-btn small-btn" onClick={() => update({ spatial: viewRegion(session, spec.spatial?.mode) })}>
            <Scan size={12} />
            {t('filter.region.view')}
          </button>
          <button type="button" className={`tb-btn small-btn ${regionPick === 'rect' ? 'on' : ''}`} onClick={() => setRegionPick(regionPick === 'rect' ? null : 'rect')}>
            <Square size={12} />
            {t('filter.region.rect')}
          </button>
          <button type="button" className={`tb-btn small-btn ${regionPick === 'polygon' ? 'on' : ''}`} onClick={() => setRegionPick(regionPick === 'polygon' ? null : 'polygon')}>
            <Pentagon size={12} />
            {t('filter.region.polygon')}
          </button>
        </div>
        {spec.spatial && (
          <div className="spatial-row">
            <span className="muted small">
              {spec.spatial.kind === 'rect'
                ? t('filter.region.rectInfo', { w: fmt(spec.spatial.maxX - spec.spatial.minX), h: fmt(spec.spatial.maxY - spec.spatial.minY) })
                : t('filter.region.polygonInfo', { count: spec.spatial.points.length / 2 })}
            </span>
            <select value={spec.spatial.mode} onChange={(e) => update({ spatial: { ...spec.spatial!, mode: e.target.value as 'inside' | 'crossing' } })}>
              <option value="crossing">{t('filter.spatial.crossing')}</option>
              <option value="inside">{t('filter.spatial.inside')}</option>
            </select>
            <button type="button" className="icon-btn" title={t('filter.remove')} onClick={() => update({ spatial: undefined })}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="panel-section filter-actions">
        <button type="button" className="primary-btn small" disabled={busy} onClick={() => void apply()}>
          <Play size={14} />
          {t('filter.apply')}
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={() => {
            const e = { ...emptyFilter(), mode: spec.mode, level: spec.level };
            setTab(tab.id, { filter: e });
            void session.applyFilter(null);
          }}
        >
          {t('filter.clear')}
        </button>
        <button type="button" className="icon-btn" title={t('filter.share')} onClick={() => void share()}>
          <Link2 size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t('filter.savePreset')}
          onClick={() => {
            const name = prompt(t('filter.presetName'));
            if (!name) return;
            const next = [...presets.filter((p) => p.name !== name), { name, spec }];
            setPresets(next);
            savePresets(next);
          }}
        >
          <BookmarkPlus size={15} />
        </button>
        {copied && <span className="muted small">{t('filter.copied')}</span>}
      </div>
      {result && (
        <div className="panel-section">
          <b>{t('filter.result', { count: result.count.toLocaleString() })}</b>
          {result.leafCount !== undefined && spec.level === 'leaf' && <span className="muted small"> · {t('filter.leaves', { count: result.leafCount.toLocaleString() })}</span>}
          {result.truncated && <p className="warn-text small">{t('filter.truncated')}</p>}
          {result.rejected?.map((r) => (
            <p key={r.pattern} className="warn-text small">
              {t(r.reason === 'risky' ? 'filter.rejectedRisky' : 'filter.rejectedInvalid', { pattern: r.pattern })}
            </p>
          ))}
        </div>
      )}
      {presets.length > 0 && (
        <div className="panel-section">
          <b>{t('filter.presets')}</b>
          {presets.map((p) => (
            <div key={p.name} className="preset-row">
              <button
                type="button"
                className="link-inline"
                onClick={() => {
                  setTab(tab.id, { filter: p.spec });
                  void apply(p.spec);
                }}
              >
                {p.name}
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('filter.remove')}
                onClick={() => {
                  const next = presets.filter((x) => x.name !== p.name);
                  setPresets(next);
                  savePresets(next);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
