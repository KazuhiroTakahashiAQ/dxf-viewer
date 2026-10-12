import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Crosshair, ScrollText } from 'lucide-react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { GeneratorGuess, HeaderVarRow, InspectedRecord, ObjectNode, TableGroup } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { formatBytes, unitName } from '../format';

const OPEN_KEY = 'dxfv.docSections.v1';

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function Section({ id, title, children, extra, defaultOpen = false, openSignal }: { id: string; title: string; children: ReactNode; extra?: ReactNode; defaultOpen?: boolean; openSignal?: unknown }) {
  const [open, setOpen] = useState(() => loadOpen()[id] ?? defaultOpen);
  // open when the signal changes (e.g. a new handle to inspect)
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...loadOpen(), [id]: next }));
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="prop-section">
      <button type="button" className="section-toggle" onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
        {extra && <span className="muted small section-extra">{extra}</span>}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

/** Jump to a line in the Raw panel. */
export function showRawLine(line: number): void {
  const ui = useUi.getState();
  ui.setDock('bottom', { open: true, active: 'raw' });
  ui.setRawJump({ line, seq: Date.now() });
}

function HandleLink({ handle, session }: { handle: string; session: DocumentSession }) {
  return (
    <button
      type="button"
      className="link-inline mono"
      onClick={async () => {
        const r = await session.rpc.call('findHandle', { handle });
        if (r?.kind === 'entity') {
          session.setSelection([r.id]);
          void session.zoomToEntities([r.id]);
        }
        useUi.getState().setInspectHandle(handle);
      }}
    >
      {handle}
    </button>
  );
}

function Inspector({ session, handle }: { session: DocumentSession; handle: string }) {
  const [rec, setRec] = useState<InspectedRecord | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void session.rpc.call('inspectHandle', { handle }).then((r) => alive && setRec(r));
    return () => {
      alive = false;
    };
  }, [session, handle]);
  if (rec === undefined) return <p className="muted small">…</p>;
  if (rec === null) return <p className="muted small">{t('doc.inspect.notFound', { handle })}</p>;
  return (
    <div className="inspector">
      <div className="inspector-head">
        <b>{rec.type}</b> <span className="mono">{rec.handle}</span>
        {rec.name && <span> · {rec.name}</span>}
        <span className="muted small"> · {rec.kind}</span>
        {rec.owner && (
          <span className="small">
            {' '}
            · {t('doc.inspect.owner')} <HandleLink handle={rec.owner} session={session} />
          </span>
        )}
        <span className="tb-spacer" />
        {rec.entityId !== undefined && (
          <button type="button" className="icon-btn" title={t('doc.inspect.select')} onClick={() => session.setSelection([rec.entityId!])}>
            <Crosshair size={13} />
          </button>
        )}
        {rec.tags[0] && (
          <button type="button" className="icon-btn" title={t('doc.showRaw')} onClick={() => showRawLine(rec.tags[0].line)}>
            <ScrollText size={13} />
          </button>
        )}
      </div>
      <table className="grid raw-grid">
        <thead>
          <tr>
            <th className="num">{t('doc.raw.line')}</th>
            <th className="num">{t('doc.raw.code')}</th>
            <th>{t('doc.raw.value')}</th>
            <th>{t('doc.raw.meaning')}</th>
          </tr>
        </thead>
        <tbody>
          {rec.tags.map((r) => (
            <tr key={r.index}>
              <td className="num mono muted">{r.line}</td>
              <td className="num mono">{r.code}</td>
              <td className="mono">{(r.code >= 320 && r.code <= 369) || r.code === 1005 ? <HandleLink handle={r.value.trim()} session={session} /> : r.value}</td>
              <td className="muted small">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rec.total > rec.tags.length && <p className="muted small">{t('doc.inspect.more', { count: rec.total - rec.tags.length })}</p>}
    </div>
  );
}

function ObjectTree({ session, handle, depth }: { session: DocumentSession; handle: string; depth: number }) {
  const [nodes, setNodes] = useState<ObjectNode[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    void session.rpc.call('objectChildren', { handle }).then(setNodes);
  }, [session, handle]);
  if (!nodes) return <p className="muted small">…</p>;
  if (!nodes.length && depth === 0) return <p className="muted small">{t('doc.objects.none')}</p>;
  return (
    <div className="obj-tree" style={{ paddingLeft: depth ? 12 : 0 }}>
      {nodes.map((n) => (
        <div key={`${n.key}-${n.handle}`}>
          <div className="obj-row">
            {n.hasChildren ? (
              <button type="button" className="icon-btn tiny" onClick={() => setOpen({ ...open, [n.handle]: !open[n.handle] })} aria-expanded={!!open[n.handle]}>
                {open[n.handle] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            <span className="obj-key" title={n.key}>
              {n.key}
            </span>
            <span className="muted small">{n.type}</span>
            <HandleLink handle={n.handle} session={session} />
          </div>
          {open[n.handle] && <ObjectTree session={session} handle={n.handle} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

function ImageRefs({ session }: { session: DocumentSession }) {
  const version = useUi((s) => s.imagesVersion);
  const [refs, setRefs] = useState<{ fileName: string; count: number; attached: boolean }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void session.rpc.call('imageRefs', undefined).then(setRefs);
  }, [session, version]);
  if (!refs.length) return <p className="muted small">{t('doc.images.none')}</p>;
  return (
    <>
      <p className="muted small">{t('doc.images.help')}</p>
      <table className="grid">
        <tbody>
          {refs.map((r) => (
            <tr key={r.fileName}>
              <td className="mono small" title={r.fileName}>
                {r.fileName}
              </td>
              <td className="num">{r.count}</td>
              <td className="small">{r.attached ? t('doc.images.attached') : t('doc.images.missing')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void session.attachImageFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <button type="button" className="tb-btn small-btn" onClick={() => inputRef.current?.click()}>
        {t('doc.images.attach')}
      </button>
    </>
  );
}

function Thumbnail({ session }: { session: DocumentSession }) {
  const [url, setUrl] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    void session.rpc.call('thumbnail', undefined).then((bytes) => {
      if (!bytes?.length) return setNone(true);
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      let blob: Blob;
      if (png) blob = new Blob([bytes as BlobPart], { type: 'image/png' });
      else {
        // THUMBNAILIMAGE holds a DIB (BITMAPINFOHEADER + pixels); prepend a BMP file header
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const headerSize = dv.getUint32(0, true);
        const bitCount = dv.getUint16(14, true);
        const colors = dv.getUint32(32, true) || (bitCount <= 8 ? 1 << bitCount : 0);
        const fh = new Uint8Array(14);
        const fdv = new DataView(fh.buffer);
        fh[0] = 0x42;
        fh[1] = 0x4d;
        fdv.setUint32(2, 14 + bytes.length, true);
        fdv.setUint32(10, 14 + headerSize + colors * 4, true);
        blob = new Blob([fh, bytes as BlobPart], { type: 'image/bmp' });
      }
      u = URL.createObjectURL(blob);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [session]);
  if (none) return <p className="muted small">{t('doc.thumbnail.none')}</p>;
  return url ? <img className="doc-thumb" src={url} alt={t('doc.thumbnail')} /> : null;
}

export function DocumentPanel() {
  const tab = useUi(activeTab);
  const inspect = useUi((s) => s.inspectHandle);
  const session = tab ? sessions.get(tab.id) : undefined;
  const s = tab?.summary;
  const [header, setHeader] = useState<HeaderVarRow[]>([]);
  const [tables, setTables] = useState<TableGroup[]>([]);
  const [classes, setClasses] = useState<{ name: string; cppName: string; app: string; flags: number; line: number }[]>([]);
  const [stats, setStats] = useState<{ type: string; model: number; paper: number; blocks: number }[]>([]);
  const [gen, setGen] = useState<GeneratorGuess | null>(null);
  const [hq, setHq] = useState('');
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [inspectInput, setInspectInput] = useState('');

  useEffect(() => {
    if (!session || tab?.status !== 'ready') return;
    let alive = true;
    void Promise.all([
      session.rpc.call('headerVars', undefined),
      session.rpc.call('tableGroups', undefined),
      session.rpc.call('classes', undefined),
      session.rpc.call('typeStats', undefined),
      session.rpc.call('generator', undefined),
    ]).then(([h, tb, c, st, g]) => {
      if (!alive) return;
      setHeader(h);
      setTables(tb);
      setClasses(c);
      setStats(st);
      setGen(g);
    });
    return () => {
      alive = false;
    };
  }, [session, tab?.status, s]);

  const headerShown = useMemo(() => {
    const q = hq.trim().toLowerCase();
    return q ? header.filter((r) => r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : header;
  }, [header, hq]);

  if (!tab || !s || !session) return <div className="panel-empty">—</div>;
  const ext = s.extents;
  const rows: [string, string][] = [
    [t('doc.file'), s.name],
    [t('doc.size'), formatBytes(s.size)],
    ['SHA-256', s.hash ? `${s.hash.slice(0, 16)}…` : '—'],
    [t('doc.version'), `${s.version ?? '?'}${s.release ? ` (${s.release})` : ''}`],
    [t('doc.format'), s.binary ? t('doc.binary') : t('doc.ascii')],
    [t('doc.encoding'), `${s.encoding}${s.codepage ? ` / ${s.codepage}` : ''}`],
    [t('doc.encodingReason'), s.encodingReason],
    [t('doc.replacements'), String(s.replacements)],
    [t('doc.lines'), `${s.lineCount.toLocaleString()} / ${s.tagCount.toLocaleString()}`],
    [t('doc.entities'), s.entityCount.toLocaleString()],
    [t('doc.modelPaper'), `${s.modelSpaceCount.toLocaleString()} / ${s.paperSpaceCount.toLocaleString()}`],
    [t('doc.blocks'), s.blockCount.toLocaleString()],
    [t('doc.layers'), s.layerCount.toLocaleString()],
    [t('doc.layouts'), s.layoutNames.join(', ') || '—'],
    [t('doc.extents'), ext ? `(${ext.minX.toFixed(3)}, ${ext.minY.toFixed(3)}) – (${ext.maxX.toFixed(3)}, ${ext.maxY.toFixed(3)})` : '—'],
    [t('doc.units'), `${s.insUnits}${unitName(s.insUnits) ? ` (${unitName(s.insUnits)})` : ''}`],
    [t('doc.parseTime'), `${s.parseMs.toFixed(0)} ms`],
    [t('doc.memory'), tab.build?.memoryBytes ? `≈ ${formatBytes(tab.build.memoryBytes)}` : '—'],
  ];
  const coverage = tab.build?.coverage ?? [];
  return (
    <div className="panel doc-panel panel-scroll">
      <Section id="summary" title={t('doc.summary')} defaultOpen>
        <table className="kv">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section id="generator" title={t('doc.generator')} extra={gen?.guess.length ? gen.guess.join(' / ') : t('doc.generator.unknown')} defaultOpen>
        {gen && (
          <>
            <p className="small">
              <b>{gen.guess.length ? gen.guess.join(' / ') : t('doc.generator.unknown')}</b>
              {gen.reasons.length > 0 && <span className="muted"> — {gen.reasons.join('; ')}</span>}
            </p>
            <p className="muted small">{t('doc.generator.note')}</p>
            <ul className="evidence small">
              {gen.evidence.map((e) => (
                <li key={e} className="mono">
                  {e}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      <Section id="inspect" title={t('doc.inspect')} extra={inspect ?? undefined} defaultOpen={!!inspect} openSignal={inspect}>
        <form
          className="inspect-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (inspectInput.trim()) useUi.getState().setInspectHandle(inspectInput.trim());
          }}
        >
          <input className="search" placeholder={t('doc.inspect.placeholder')} value={inspectInput} onChange={(e) => setInspectInput(e.target.value)} />
        </form>
        {inspect ? <Inspector key={inspect} session={session} handle={inspect} /> : <p className="muted small">{t('doc.inspect.help')}</p>}
      </Section>
      <Section id="header" title={t('doc.header')} extra={String(header.length)}>
        <input className="search block-search" type="search" placeholder={t('doc.header.filter')} value={hq} onChange={(e) => setHq(e.target.value)} />
        <table className="grid">
          <tbody>
            {headerShown.map((r) => (
              <tr key={r.name} title={`codes ${r.codes} · line ${r.line}`}>
                <td className="mono">{r.name}</td>
                <td className="mono">{r.value}</td>
                <td className="muted small">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section id="tables" title={t('doc.tables')} extra={String(tables.reduce((n, g) => n + g.records.length, 0))}>
        {tables.map((g) => (
          <div key={g.table}>
            <button type="button" className="link-inline" onClick={() => setOpenTable(openTable === g.table ? null : g.table)}>
              {g.table} ({g.records.length})
            </button>
            {openTable === g.table && (
              <div className="table-records">
                {g.records.slice(0, 2000).map((r, i) => (
                  <div key={`${r.handle}-${i}`} className="obj-row">
                    <span className="obj-key" title={r.name}>
                      {r.name}
                    </span>
                    {r.handle ? <HandleLink handle={r.handle} session={session} /> : <span className="muted small">{t('doc.noHandle')}</span>}
                    <button type="button" className="icon-btn tiny" title={t('doc.showRaw')} onClick={() => showRawLine(r.line)}>
                      <ScrollText size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Section>
      <Section id="objects" title={t('doc.objects')}>
        <ObjectTree session={session} handle="" depth={0} />
      </Section>
      <Section id="classes" title={t('doc.classes')} extra={String(classes.length)}>
        <table className="grid">
          <tbody>
            {classes.map((c, i) => (
              <tr key={`${c.name}-${i}`}>
                <td className="mono">{c.name}</td>
                <td className="mono small">{c.cppName}</td>
                <td className="muted small">{c.app}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section id="stats" title={t('doc.stats')}>
        <table className="grid">
          <thead>
            <tr>
              <th>{t('doc.coverage.type')}</th>
              <th className="num">{t('doc.stats.model')}</th>
              <th className="num">{t('doc.stats.paper')}</th>
              <th className="num">{t('doc.stats.blocks')}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((r) => (
              <tr key={r.type}>
                <td>{r.type}</td>
                <td className="num">{r.model || ''}</td>
                <td className="num">{r.paper || ''}</td>
                <td className="num">{r.blocks || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section id="coverage" title={t('doc.coverage')} extra={coverage.some((c) => c.rendered < c.count) ? '⚠' : undefined}>
        {!!tab.build?.budgetExceeded && <p className="warn-text">{t('doc.budget', { count: tab.build.budgetExceeded })}</p>}
        <table className="grid">
          <thead>
            <tr>
              <th>{t('doc.coverage.type')}</th>
              <th className="num">{t('doc.coverage.count')}</th>
              <th className="num">{t('doc.coverage.rendered')}</th>
              <th>{t('doc.coverage.method')}</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => (
              <tr key={c.type} className={c.rendered < c.count ? 'warn-row' : ''}>
                <td>{c.type}</td>
                <td className="num">{c.count}</td>
                <td className="num">{c.rendered}</td>
                <td>{c.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section id="images" title={t('doc.images')}>
        <ImageRefs session={session} />
      </Section>
      <Section id="thumbnail" title={t('doc.thumbnail')}>
        <Thumbnail session={session} />
      </Section>
    </div>
  );
}
