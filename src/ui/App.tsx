import { t } from '../i18n';
import { UpdatePrompt } from '../pwa/UpdatePrompt';

export function App() {
  return (
    <div className="welcome">
      <h1>{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
      <UpdatePrompt />
    </div>
  );
}
