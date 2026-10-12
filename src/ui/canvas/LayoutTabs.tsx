import { t } from '../../i18n';
import { sessions } from '../../session/DocumentSession';
import { activeTab, useUi } from '../../state/store';

/** Model / paper space layout tabs shown at the bottom edge of the drawing. */
export function LayoutTabs() {
  const tab = useUi(activeTab);
  const layouts = tab?.layouts ?? [];
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
          title={t('layouts.count', { count: l.count })}
          onClick={() => void session?.setLayout(l.name)}
        >
          {l.kind === 'model' ? t('layouts.model') : l.name}
        </button>
      ))}
    </div>
  );
}
