import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import { activeTab, useUi } from '../../state/store';
import { tip } from '../Tooltip';

/** Model / paper space layout tabs shown at the bottom edge of the drawing. */
export function LayoutTabs() {
  const tab = useUi(activeTab);
  const base = tab?.layouts ?? [];
  const current = tab?.layout ?? 'Model';
  const layouts = current.startsWith('\u00A7') ? [...base, { name: current, kind: 'model' as const, count: 0 }] : base;
  if (!tab || layouts.length < 2) return null;
  const session = sessions.get(tab.id);
  return (
    <div className="layout-tabs" role="tablist" aria-label={t('layouts.label')}>
      {layouts.map((l) => (
        <button
          key={l.name}
          type="button"
          role="tab"
          aria-selected={(tab.layout ?? 'Model') === l.name}
          className={`layout-tab ${(tab.layout ?? 'Model') === l.name ? 'active' : ''}`}
          {...tip(t('layouts.count', { count: l.count }), t('tip.layout'), undefined, { terms: l.name.startsWith('\u00A7') ? 'block' : l.kind === 'model' ? 'modelSpace' : ['paperSpace', 'viewport'] })}
          onClick={() => void session?.setLayout(l.name)}
        >
          {l.name.startsWith('\u00A7') ? t('layouts.block', { name: l.name.slice(1) }) : l.kind === 'model' ? t('layouts.model') : l.name}
        </button>
      ))}
    </div>
  );
}
