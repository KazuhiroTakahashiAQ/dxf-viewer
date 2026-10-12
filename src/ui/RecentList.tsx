import { useEffect, useState, type RefObject } from 'react';
import { Database, FileText, X } from 'lucide-react';

import { t } from '../i18n';
import { listRecent, removeRecent, type RecentEntry } from '../storage/recentFiles';
import { useUi } from '../state/store';
import { chooseFiles, reopenRecent } from './fileOpen';
import { formatBytes } from './format';
import { iconTip, tip } from './Tooltip';

/** Recently opened drawings (names only unless storing drawings is enabled). */
export function RecentList({ fileInput, compact = false }: { fileInput: RefObject<HTMLInputElement | null>; compact?: boolean }) {
  const version = useUi((s) => s.recentVersion);
  const mode = useUi((s) => s.settings.recentMode);
  const bump = useUi((s) => s.bumpRecent);
  const [list, setList] = useState<RecentEntry[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void listRecent().then(setList);
  }, [version]);
  if (mode === 'off') return compact ? <p className="muted small">{t('recent.off')}</p> : null;
  if (!list.length) return compact ? <p className="muted small">{t('recent.empty')}</p> : null;
  return (
    <div className={`recent-list ${compact ? 'compact' : ''}`}>
      {!compact && <h3>{t('recent.title')}</h3>}
      {list.map((e) => (
        <div key={e.hash} className="recent-row">
          <button
            type="button"
            className="recent-open"
            {...tip(e.name, e.stored ? t('recent.stored') : e.handle ? t('recent.handle') : t('recent.metaOnly'))}
            onClick={async () => {
              setMsg('');
              const ok = await reopenRecent(e);
              if (!ok) {
                setMsg(t('recent.pickAgain', { name: e.name }));
                void chooseFiles(fileInput.current);
              }
            }}
          >
            {e.stored ? <Database size={14} /> : <FileText size={14} />}
            <span className="recent-name">{e.name}</span>
            <span className="muted small">
              {formatBytes(e.size)} · {new Date(e.openedAt).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className="icon-btn"
            {...iconTip(t('recent.remove'))}
            onClick={async () => {
              await removeRecent(e.hash);
              bump();
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {msg && <p className="warn-text small">{msg}</p>}
      {!compact && mode === 'meta' && <p className="muted small">{t('recent.metaHelp')}</p>}
    </div>
  );
}
