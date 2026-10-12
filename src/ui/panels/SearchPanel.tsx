import { useEffect, useRef, useState } from 'react';
import { CaseSensitive, Regex } from 'lucide-react';

import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { SearchHit } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';

interface TabHits {
  tabId: string;
  name: string;
  total: number;
  hits: SearchHit[];
  error?: string;
}

/** Search texts, handles, layer and block names in this tab or across all tabs. */
export function SearchPanel() {
  const tab = useUi(activeTab);
  const tabs = useUi((s) => s.tabs);
  const activate = useUi((s) => s.activate);
  const [q, setQ] = useState('');
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const [all, setAll] = useState(false);
  const [results, setResults] = useState<TabHits[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const targets = (all ? tabs : tabs.filter((x) => x.id === tab?.id)).filter((x) => x.status === 'ready');
      const res = await Promise.all(
        targets.map(async (x) => {
          const s = sessions.get(x.id);
          if (!s) return null;
          const r = await s.rpc.call('search', { query: q, regex, caseSensitive: cs, limit: 300 });
          return { tabId: x.id, name: x.name, ...r } as TabHits;
        }),
      );
      if (id === seq.current) setResults(res.filter((x): x is TabHits => !!x));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, regex, cs, all, tabs, tab?.id]);

  const open = (tabId: string, id: number) => {
    activate(tabId);
    const s = sessions.get(tabId);
    if (!s) return;
    // wait a frame so the canvas of the activated tab is mounted
    requestAnimationFrame(() => {
      s.setSelection([id]);
      void s.zoomToEntities([id]);
    });
  };

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <input className="search" type="search" placeholder={t('search.placeholder')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <button type="button" className={`icon-btn toggle ${cs ? 'on' : ''}`} aria-pressed={cs} title={t('texts.caseSensitive')} onClick={() => setCs(!cs)}>
          <CaseSensitive size={15} />
        </button>
        <button type="button" className={`icon-btn toggle ${regex ? 'on' : ''}`} aria-pressed={regex} title={t('texts.regex')} onClick={() => setRegex(!regex)}>
          <Regex size={15} />
        </button>
      </div>
      <div className="seg panel-sub" role="radiogroup">
        <button type="button" className={!all ? 'on' : ''} aria-checked={!all} role="radio" onClick={() => setAll(false)}>
          {t('search.thisTab')}
        </button>
        <button type="button" className={all ? 'on' : ''} aria-checked={all} role="radio" onClick={() => setAll(true)}>
          {t('search.allTabs', { count: tabs.length })}
        </button>
      </div>
      <div className="panel-scroll">
        {results.map((r) => (
          <div key={r.tabId} className="search-group">
            {(all || results.length > 1) && (
              <div className="search-tab">
                <b>{r.name}</b> <span className="muted small">{t('search.hits', { count: r.total })}</span>
              </div>
            )}
            {r.error && <p className="warn-text small">{r.error}</p>}
            {r.hits.map((h, i) => (
              <div key={`${h.id}-${i}`} className="search-hit" onClick={() => open(r.tabId, h.id)}>
                <span className="muted small">{h.type}</span>
                <span className="hit-text" title={h.text}>
                  {h.text}
                </span>
                <span className="muted small">{h.field}</span>
              </div>
            ))}
            {r.total > r.hits.length && <p className="muted small search-more">{t('search.more', { count: r.total - r.hits.length })}</p>}
          </div>
        ))}
        {q && !results.some((r) => r.total) && <div className="panel-empty">{t('search.none')}</div>}
      </div>
    </div>
  );
}
