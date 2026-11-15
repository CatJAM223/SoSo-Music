import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let nativeVisible: boolean | undefined;
let stopListening: (() => void) | undefined;
const snapshot = () =>
  (nativeVisible ?? (typeof window === 'undefined' || !window.electronAPI?.getWindowVisible)) &&
  (typeof document === 'undefined' || !document.hidden);

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stopListening) {
    let active = true;
    let receivedEvent = false;
    const notify = () => listeners.forEach((callback) => callback());
    const off = window.electronAPI?.onWindowVisible?.((visible) => {
      receivedEvent = true;
      nativeVisible = visible;
      notify();
    });
    void window.electronAPI
      ?.getWindowVisible?.()
      .then((visible) => {
        if (!active || receivedEvent) return;
        nativeVisible = visible;
        notify();
      })
      .catch(() => {
        if (!active || receivedEvent) return;
        nativeVisible = true;
        notify();
      });
    document.addEventListener('visibilitychange', notify);
    stopListening = () => {
      active = false;
      off?.();
      document.removeEventListener('visibilitychange', notify);
      nativeVisible = undefined;
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    stopListening?.();
    stopListening = undefined;
  };
}

export const useWindowVisible = () => useSyncExternalStore(subscribe, snapshot, () => true);
