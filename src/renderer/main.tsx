import { initializeRustCompute } from '../shared/compute/waveSongMatrix';
import { logger } from '../shared/utils/logger';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PlayerOverlay } from '../desktop/ui/components/PlayerOverlay';
import { ThemeProvider } from '../shared/context/ThemeContext';
import { AudioProvider } from '../shared/context/AudioContext';
import { platformBridge } from '../shared/bridge/platformBridge';
import { ToastProvider } from '../shared/context/ToastContext';
import { ToastContainer } from '../shared/components/ToastContainer';
import { AnimationPauseController } from '../shared/components/AnimationPauseController';
import './index.css';

// Expose the desktop bridge to renderer preview environments
if (typeof window !== 'undefined' && !(window as any).electronAPI) {
  (window as any).electronAPI = platformBridge;
}

import { ErrorBoundary } from '../shared/components/ErrorBoundary';

// Local optional acceleration initializes concurrently; mounting never waits for compilation.
if (window.location.hash !== '#/overlay')
  void fetch(new URL('compute/soso-core.wasm', document.baseURI))
    .then((response) => {
      if (!response.ok) throw Error('Local compute asset unavailable');
      return response.arrayBuffer();
    })
    .then((bytes) => initializeRustCompute(bytes))
    .catch(() => logger.warn('[Compute:Rust] Local asset unavailable; using JavaScript'));

async function mountPlayer(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;
  if (window.location.hash === '#/overlay') {
    document.getElementById('app-preloader')?.remove();
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary name="Overlay">
          <PlayerOverlay />
        </ErrorBoundary>
      </React.StrictMode>,
    );
    return;
  }
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary name="Root">
        <ToastProvider>
          <ThemeProvider>
            <AudioProvider>
              <AnimationPauseController />
              <App />
              <ToastContainer />
            </AudioProvider>
          </ThemeProvider>
        </ToastProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void mountPlayer();
