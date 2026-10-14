import React from 'react';
import ReactDOM from 'react-dom/client';
import { PlayerOverlay } from '../desktop/ui/components/PlayerOverlay';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import './index.css';
const rootElement = document.getElementById('root');
if (rootElement) {
  if (window.location.hash === '#/overlay') {
    document.getElementById('app-preloader')?.remove();
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary name="Overlay">
          <PlayerOverlay />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } else {
    // The overlay never imports the audio engine, recommendation code or the main app.
    void import('./mountPlayer')
      .then(({ mountPlayer }) => mountPlayer(rootElement))
      .catch((error) => {
        console.error('Unable to start SoSo Music', error);
        document.getElementById('app-preloader')?.remove();
        rootElement.textContent =
          'Не удалось запустить SoSo Music. Перезапустите приложение. / Please restart SoSo Music.';
      });
  }
}
