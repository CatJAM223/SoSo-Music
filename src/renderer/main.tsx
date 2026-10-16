import React from 'react';
import ReactDOM from 'react-dom/client';
import { PlayerOverlay } from '../desktop/ui/components/PlayerOverlay';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import './index.css';
const DesktopWidget = React.lazy(() =>
  import('../desktop/ui/components/DesktopWidget').then((module) => ({
    default: module.DesktopWidget,
  })),
);
const rootElement = document.getElementById('root');
if (rootElement) {
  if (window.location.hash === '#/overlay') {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    document.body.style.transition = 'none';
    document.getElementById('app-preloader')?.remove();
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary name="Overlay">
          <PlayerOverlay />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } else if (window.location.hash === '#/widget') {
    document.getElementById('app-preloader')?.remove();
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary name="Desktop widget">
          <React.Suspense fallback={null}>
            <DesktopWidget />
          </React.Suspense>
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } else {
    // Auxiliary windows never import the audio engine, recommendation code or the main app.
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
