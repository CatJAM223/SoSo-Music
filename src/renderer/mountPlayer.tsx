import { initializeRustCompute } from '../shared/compute/waveSongMatrix';
import { logger } from '../shared/utils/logger';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from '../shared/context/ThemeContext';
import { AudioProvider } from '../shared/context/AudioContext';
import { platformBridge } from '../shared/bridge/platformBridge';
import { ToastProvider } from '../shared/context/ToastContext';
import { ToastContainer } from '../shared/components/ToastContainer';
import { AnimationPauseController } from '../shared/components/AnimationPauseController';

// Expose the desktop bridge to renderer preview environments
if (typeof window !== 'undefined' && !(window as any).electronAPI) {
  (window as any).electronAPI = platformBridge;
}

import { ErrorBoundary } from '../shared/components/ErrorBoundary';

// Rust owns the algorithms; mount only after the required local module is ready.
const computeReady = fetch(new URL('compute/soso-core.wasm', document.baseURI)).then(
  async (response) => {
    if (!response.ok || !(await initializeRustCompute(await response.arrayBuffer())))
      throw Error('Не удалось загрузить вычислительный модуль Rust. Перезапустите приложение.');
  },
);

export function mountPlayer(rootElement: HTMLElement): void {
  void computeReady
    .then(() => mountReadyPlayer(rootElement))
    .catch((error) => {
      logger.error('[Compute:Rust] Player initialization failed', error);
      document.getElementById('app-preloader')?.remove();
      rootElement.textContent =
        error instanceof Error ? error.message : 'Не удалось загрузить вычислительный модуль Rust.';
    });
}

function mountReadyPlayer(rootElement: HTMLElement): void {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary name="Root" onError={() => document.getElementById('app-preloader')?.remove()}>
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
