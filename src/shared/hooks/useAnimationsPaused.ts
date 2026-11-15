import { useEffect, useState } from 'react';

const listeners = new Set<(paused: boolean) => void>();
let nativePaused = false;
let stopListening: (() => void) | undefined;

const isPaused = () => nativePaused || document.visibilityState === 'hidden';

function startListening() {
  let active = true;
  let receivedNativeEvent = false;
  const sync = () => {
    const paused = isPaused();
    document.documentElement.toggleAttribute('data-anim-paused', paused);
    for (const listener of listeners) listener(paused);
  };
  const unsubscribe = window.electronAPI?.onAnimationsPaused?.((value) => {
    receivedNativeEvent = true;
    nativePaused = value;
    sync();
  });
  void window.electronAPI
    ?.getAnimationsPaused?.()
    .then((value) => {
      if (!active || receivedNativeEvent) return;
      nativePaused = value;
      sync();
    })
    .catch(() => {});
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    active = false;
    nativePaused = false;
    unsubscribe?.();
    document.removeEventListener('visibilitychange', sync);
  };
}

/** Pause decoration when another app owns focus, or this page is hidden. */
export const useAnimationsPaused = (): boolean => {
  const [paused, setPaused] = useState(isPaused);
  useEffect(() => {
    listeners.add(setPaused);
    stopListening ??= startListening();
    setPaused(isPaused());
    return () => {
      listeners.delete(setPaused);
      if (listeners.size) return;
      stopListening?.();
      stopListening = undefined;
    };
  }, []);
  return paused;
};
