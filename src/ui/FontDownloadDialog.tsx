import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import type { FontManifest } from '../fonts/fontLoader';
import { t } from '../i18n';
import { useUi } from '../state/store';
import { formatBytes } from './format';

/** Same cache the service worker uses for fonts (CacheFirst runtime caching). */
const CACHE = 'dxfv-fonts';

type Family = FontManifest['families'][number];

const urlOf = (file: string) => new URL(`fonts/${file}`, document.baseURI).href;
const filesOf = (f: Family) => f.faces.flatMap((face) => face.files);

/**
 * Pre-download the bundled substitute fonts for offline use. Shows the size of
 * every family, what is already cached and the browser's storage estimate
 * before anything is downloaded.
 */
export function FontDownloadDialog() {
  const open = useUi((s) => s.fontDialog);
  const setOpen = useUi((s) => s.setFontDialog);
  const [families, setFamilies] = useState<Family[]>([]);
  const [cached, setCached] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const cancel = useRef(false);
  const supported = typeof caches !== 'undefined';

  const refresh = async (fams: Family[]) => {
    if (supported) {
      const cache = await caches.open(CACHE);
      const out: Record<string, number> = {};
      for (const f of fams) {
        let n = 0;
        for (const file of filesOf(f)) if (await cache.match(urlOf(file.url))) n++;
        out[f.id] = n;
      }
      setCached(out);
    }
    const est = await navigator.storage?.estimate?.();
    if (est) setEstimate({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
    setPersisted((await navigator.storage?.persisted?.()) ?? null);
  };

  useEffect(() => {
    if (!open) return;
    void fetch(new URL('fonts/manifest.json', document.baseURI))
      .then((r) => r.json() as Promise<FontManifest>)
      .then((m) => {
        setFamilies(m.families);
        return refresh(m.families);
      })
      .catch(() => setError(t('fontsDl.noManifest')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const missingBytes = (f: Family) => filesOf(f).reduce((s, x) => s + x.size, 0) * (1 - (cached[f.id] ?? 0) / Math.max(1, filesOf(f).length));
  const selBytes = families.filter((f) => selected.has(f.id)).reduce((s, f) => s + missingBytes(f), 0);
  const free = estimate ? Math.max(0, estimate.quota - estimate.usage) : null;

  const download = async () => {
    setError('');
    cancel.current = false;
    const cache = await caches.open(CACHE);
    const files = families.filter((f) => selected.has(f.id)).flatMap((f) => filesOf(f).map((x) => urlOf(x.url)));
    const todo: string[] = [];
    for (const u of files) if (!(await cache.match(u))) todo.push(u);
    const total = todo.length;
    setProgress({ done: 0, total });
    let done = 0;
    const worker = async () => {
      while (todo.length && !cancel.current) {
        const u = todo.shift()!;
        try {
          await cache.add(u);
        } catch (e) {
          setError(String((e as Error).message));
        }
        setProgress({ done: ++done, total });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    setProgress(null);
    await refresh(families);
  };

  const remove = async (f: Family) => {
    const cache = await caches.open(CACHE);
    for (const file of filesOf(f)) await cache.delete(urlOf(file.url));
    await refresh(families);
  };

  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && !progress && setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('fontsDl.title')}>
        <div className="modal-head">
          <b>{t('fontsDl.title')}</b>
          <span className="tb-spacer" />
          <button type="button" className="icon-btn" title={t('pwa.dismiss')} disabled={!!progress} onClick={() => setOpen(false)}>
            <X size={15} />
          </button>
        </div>
        <p className="small muted">{t('fontsDl.help')}</p>
        {!supported && <p className="warn-text small">{t('fontsDl.unsupported')}</p>}
        <table className="grid">
          <thead>
            <tr>
              <th />
              <th>{t('fontsDl.family')}</th>
              <th className="num">{t('fontsDl.size')}</th>
              <th>{t('fontsDl.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {families.map((f) => {
              const total = filesOf(f).length;
              const have = cached[f.id] ?? 0;
              return (
                <tr key={f.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={f.family}
                      disabled={!supported || have === total || !!progress}
                      checked={selected.has(f.id) && have < total}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(f.id);
                        else next.delete(f.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>
                    {f.family.replace(/^dxfv /, '')} <span className="muted small">({f.license})</span>
                  </td>
                  <td className="num">{formatBytes(f.totalSize)}</td>
                  <td className="small">{have === total ? t('fontsDl.cached') : have ? t('fontsDl.partial', { percent: Math.round((have / total) * 100) }) : t('fontsDl.notCached')}</td>
                  <td>
                    {have > 0 && (
                      <button type="button" className="link-inline small" disabled={!!progress} onClick={() => void remove(f)}>
                        {t('fontsDl.remove')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small">
          {t('fontsDl.selected', { size: formatBytes(Math.round(selBytes)) })}
          {free !== null && <span className="muted"> · {t('fontsDl.free', { size: formatBytes(free), used: formatBytes(estimate!.usage) })}</span>}
        </p>
        {free !== null && selBytes > free && <p className="warn-text small">{t('fontsDl.noSpace')}</p>}
        {persisted === false && (
          <p className="small muted">
            {t('fontsDl.persistHelp')}{' '}
            <button type="button" className="link-inline" onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}>
              {t('fontsDl.persist')}
            </button>
          </p>
        )}
        {progress && (
          <div className="progress-row">
            <progress max={progress.total || 1} value={progress.done} />
            <span className="small">
              {progress.done} / {progress.total}
            </span>
            <button type="button" className="tb-btn small-btn" onClick={() => (cancel.current = true)}>
              {t('url.cancel')}
            </button>
          </div>
        )}
        {error && <p className="warn-text small">{error}</p>}
        <div className="row-actions">
          <button type="button" className="primary-btn small" disabled={!supported || !selected.size || !!progress || (free !== null && selBytes > free)} onClick={() => void download()}>
            {t('fontsDl.download')}
          </button>
          <button type="button" className="tb-btn" disabled={!!progress} onClick={() => setSelected(new Set(families.filter((f) => (cached[f.id] ?? 0) < filesOf(f).length).map((f) => f.id)))}>
            {t('fontsDl.selectAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
