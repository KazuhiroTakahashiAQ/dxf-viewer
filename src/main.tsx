import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { sessions } from './session/DocumentSession';
import { useUi } from './state/store';
import { App } from './ui/App';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.DEV) {
  // debugging/E2E hook (development builds only)
  (window as unknown as Record<string, unknown>).__dxfv = {
    sessions,
    ui: useUi,
    active: () => sessions.get(useUi.getState().activeId ?? ''),
  };
}
