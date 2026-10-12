import { useRegisterSW } from 'virtual:pwa-register/react';

import { t } from '../i18n';

/** Toast shown when a new service worker is waiting (registerType: 'prompt'). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="toast" role="status">
      <span>{needRefresh ? t('pwa.updateAvailable') : t('pwa.offlineReady')}</span>
      {needRefresh && (
        <button type="button" onClick={() => void updateServiceWorker(true)}>
          {t('pwa.reload')}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setNeedRefresh(false);
          setOfflineReady(false);
        }}
      >
        {t('pwa.dismiss')}
      </button>
    </div>
  );
}
