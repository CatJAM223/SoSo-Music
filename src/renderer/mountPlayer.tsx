import { initializeRustCompute } from '../shared/compute/waveSongMatrix';
import { logger } from '../shared/utils/logger';
import { runStartupTask } from '../shared/utils/startupTask';
import { t } from '../shared/i18n/locale';
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

export function mountPlayer(rootElement: HTMLElement): void {
  let busy = false;
  let mounted = false;
  const showRecovery = (loading: boolean) => {
    const panel = document.createElement('main');
    panel.className =
      'min-h-screen w-full flex items-center justify-center bg-[var(--bg-app)] text-[var(--text-primary)] p-6';
    const card = document.createElement('section');
    card.className = 'max-w-md w-full space-y-5';
    card.setAttribute('role', loading ? 'status' : 'alert');
    const title = document.createElement('h1');
    title.className = 'text-xl font-semibold';
    title.textContent = t(loading ? 'Подготовка плеера…' : 'Не удалось подготовить плеер');
    const description = document.createElement('p');
    description.textContent = t(
      'Медиатека и настройки сохранены. Повторите запуск или перезагрузите окно.',
    );
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className =
      'rounded-xl px-4 py-3 bg-[var(--theme-accent,#f43f5e)] text-white disabled:opacity-50';
    retry.textContent = t('Повторить запуск');
    retry.disabled = loading;
    retry.addEventListener('click', () => void attempt());
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'rounded-xl px-4 py-3 border border-current ml-3';
    reload.textContent = t('Перезагрузить окно');
    reload.addEventListener('click', () => window.location.reload());
    card.append(title, description, retry, reload);
    panel.append(card);
    rootElement.replaceChildren(panel);
    if (!loading) retry.focus();
  };
  const attempt = async () => {
    if (busy || mounted) return;
    busy = true;
    showRecovery(true);
    try {
      await runStartupTask(async (signal) => {
        const response = await fetch(new URL('compute/soso-core.wasm', document.baseURI), {
          signal,
        });
        if (!response.ok || !(await initializeRustCompute(await response.arrayBuffer())))
          throw new Error('Required compute module unavailable');
      });
      rootElement.replaceChildren();
      mountReadyPlayer(rootElement);
      mounted = true;
    } catch (error) {
      logger.error('[Compute:Rust] Player initialization failed', error);
      document.getElementById('app-preloader')?.remove();
      showRecovery(false);
    } finally {
      busy = false;
    }
  };
  void attempt();
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
