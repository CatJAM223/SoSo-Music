import { useEffect, useState } from 'react';
/** Pause decoration when another app owns focus, or this page is hidden. */
export const useAnimationsPaused = (): boolean => {
  const [paused, setPaused] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    let active = true;
    let revision = 0;
    let nativePaused = false;
    const sync = () => {
      if (active) setPaused(nativePaused || document.visibilityState === 'hidden');
    };
    const unsubscribe = window.electronAPI?.onAnimationsPaused?.((value) => {
      revision++;
      nativePaused = value;
      sync();
    });
    // Effects mounted after a blur/reload still receive the current native state.
    const requestedAt = revision;
    void window.electronAPI
      ?.getAnimationsPaused?.()
      .then((value) => {
        if (!active || revision !== requestedAt) return;
        nativePaused = value;
        sync();
      })
      .catch(() => {});
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      active = false;
      unsubscribe?.();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-anim-paused', paused);
  }, [paused]);
  return paused;
};
