import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleSlash, Plus, Trash2 } from 'lucide-react';

import { BUNDLED_FONT_FAMILIES } from '../../fonts/bundledFamilies';
import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import type { FontOverrideInfo, FontUsage } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import { listUserFonts, removeUserFont, type StoredFontInfo } from '../../storage/userFonts';
import { addFontFiles, reloadUserFontsEverywhere } from '../../session/userFonts';
import { formatBytes } from '../format';
import { iconTip, Term, termTip, tip } from '../Tooltip';

const STROKE_FONTS: [string, string][] = [
  ['futural', 'Hershey Simplex (txt/simplex/romans)'],
  ['futuram', 'Hershey Duplex (romand)'],
  ['timesr', 'Hershey Complex (romanc)'],
  ['timesrb', 'Hershey Triplex (romant)'],
  ['timesi', 'Hershey Italic'],
  ['scripts', 'Hershey Script'],
  ['gothiceng', 'Hershey Gothic'],
  ['greek', 'Hershey Greek'],
  ['cyrillic', 'Hershey Cyrillic'],
];

export function FontsPanel() {
  const tab = useUi(activeTab);
  const settings = useUi((s) => s.settings);
  const updateSettings = useUi((s) => s.updateSettings);
  const [fonts, setFonts] = useState<FontUsage[]>([]);
  const [userFonts, setUserFonts] = useState<StoredFontInfo[]>([]);
  const [showUnused, setShowUnused] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const userFontsVersion = useUi((s) => s.userFontsVersion);

  useEffect(() => {
    void listUserFonts().then(setUserFonts);
  }, [userFontsVersion]);
  const session = tab ? sessions.get(tab.id) : undefined;
  const ready = tab?.status === 'ready';

  useEffect(() => {
    if (!session || !ready) return;
    let alive = true;
    void session.rpc.call('getFonts', undefined).then((f) => alive && setFonts(f));
    return () => {
      alive = false;
    };
  }, [session, ready, settings.fontOverrides, settings.preferLocalFonts, tab?.build, userFontsVersion]);

  const setOverride = (requested: string, patch: Partial<FontOverrideInfo>) => {
    const key = requested.toLowerCase();
    const cur = settings.fontOverrides[key] ?? { target: 'auto', widthScale: 1, heightScale: 1 };
    const next = { ...cur, ...patch };
    const overrides = { ...settings.fontOverrides };
    if (next.target === 'auto' && next.widthScale === 1 && next.heightScale === 1) delete overrides[key];
    else overrides[key] = next;
    updateSettings({ fontOverrides: overrides });
  };

  if (!tab) return <div className="panel-empty">—</div>;
  const used = fonts.filter((f) => f.textCount > 0);
  const unused = fonts.filter((f) => f.textCount === 0);
  const visible = showUnused ? fonts : used;
  return (
    <div className="panel fonts-panel panel-scroll">
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept=".ttf,.ttc,.otf,.woff,.woff2,.shx"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          setErrors(await addFontFiles(files));
        }}
      />
      <div className="panel-section">
        <label className="check">
          <input type="checkbox" checked={settings.preferLocalFonts} onChange={(e) => updateSettings({ preferLocalFonts: e.target.checked })} />
          {t('fonts.preferLocal')}
        </label>
        <p className="muted small">{t('fonts.help')}</p>
      </div>
      {fonts.length === 0 && <div className="panel-empty">{t('fonts.none')}</div>}
      {visible.map((f) => {
        const ov = settings.fontOverrides[f.requested.toLowerCase()];
        return (
          <div key={f.requested} className="font-card">
            <div className="font-head">
              <span className={`badge ${f.kind}`} {...termTip(f.kind === 'shx' ? 'shx' : 'trueType')}>
                {f.kind.toUpperCase()}
              </span>
              <b className="font-name" title={f.requested}>
                {f.requested}
              </b>
              {f.bigFont && (
                <span className="badge" {...termTip('bigFont')}>
                  {f.bigFont}
                </span>
              )}
              <span className="muted small">{t('fonts.texts', { count: f.textCount })}</span>
            </div>
            <div className="font-meta muted small">
              {f.styles.length > 0 && <Term id="textStyle">{t('fonts.styles', { names: f.styles.join(', ') })}</Term>}
            </div>
            <div className="font-resolve small">
              <span {...tip(t('fonts.substitute'), t('fonts.substituteDesc'))}>{t('fonts.substitute')}</span>: <b>{f.substitute}</b>
              {f.localName && (
                <span className={f.localAvailable ? 'ok' : 'muted'} title={f.localName}>
                  {' '}
                  {f.localAvailable ? <CircleCheck size={12} /> : <CircleSlash size={12} />} {f.localAvailable ? t('fonts.localFound', { name: f.localName }) : t('fonts.localMissing', { name: f.localName })}
                </span>
              )}
            </div>
            <div className="font-controls">
              <select value={ov?.target ?? 'auto'} onChange={(e) => setOverride(f.requested, { target: e.target.value })} aria-label={t('fonts.override')}>
                <option value="auto">{t('fonts.auto')}</option>
                <optgroup label={t('fonts.bundled')}>
                  {BUNDLED_FONT_FAMILIES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.displayName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('fonts.strokeFonts')}>
                  {STROKE_FONTS.map(([id, name]) => (
                    <option key={id} value={`stroke:${id}`}>
                      {name}
                    </option>
                  ))}
                </optgroup>
                {f.kind === 'ttf' && (
                  <optgroup label={t('fonts.local')}>
                    <option value={`local:${f.localName ?? f.requested}`}>{f.localName ?? f.requested}</option>
                  </optgroup>
                )}
                {userFonts.length > 0 && (
                  <optgroup label={t('fonts.user')}>
                    {userFonts.map((u) => (
                      <option key={u.name} value={`user:${u.name.replace(/\.[^.]+$/, '')}`}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <label {...tip(t('fonts.widthScale'), t('fonts.scaleDesc'))}>
                W×
                <input type="number" step="0.05" min="0.1" max="5" value={ov?.widthScale ?? 1} onChange={(e) => setOverride(f.requested, { widthScale: Number(e.target.value) || 1 })} />
              </label>
              <label {...tip(t('fonts.heightScale'), t('fonts.scaleDesc'))}>
                H×
                <input type="number" step="0.05" min="0.1" max="5" value={ov?.heightScale ?? 1} onChange={(e) => setOverride(f.requested, { heightScale: Number(e.target.value) || 1 })} />
              </label>
            </div>
          </div>
        );
      })}
      {unused.length > 0 && (
        <button type="button" className="link-btn" onClick={() => setShowUnused(!showUnused)}>
          {showUnused ? t('fonts.hideUnused') : t('fonts.showUnused', { count: unused.length })}
        </button>
      )}
      <div className="panel-section">
        <div className="section-head">
          <b>{t('fonts.userFonts')}</b>
          <button type="button" className="tb-btn" onClick={() => fileRef.current?.click()}>
            <Plus size={14} />
            {t('fonts.addFonts')}
          </button>
        </div>
        <p className="muted small">{t('fonts.userHelp')}</p>
        {errors.map((e) => (
          <p key={e} className="warn-text small">
            {e}
          </p>
        ))}
        {userFonts.map((u) => (
          <div key={u.name} className="user-font-row">
            <span className={`badge ${u.kind}`}>{u.kind.toUpperCase()}</span>
            <span className="font-name" title={u.name}>
              {u.name}
            </span>
            <span className="muted small">{formatBytes(u.size)}</span>
            <button
              type="button"
              className="icon-btn"
              {...iconTip(t('fonts.remove'))}
              onClick={async () => {
                await removeUserFont(u.name);
                setErrors(await reloadUserFontsEverywhere());
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
