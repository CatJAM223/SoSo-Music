import { useEffect, useState } from 'react';
/** Pause decorative animations while the desktop window is hidden or minimized. */
export const useAnimationsPaused = (): boolean => {
  const [paused, setPaused] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onAnimationsPaused?.(setPaused);
    const handleVisibilityChange = () => {
      if (!window.electronAPI?.onAnimationsPaused) setPaused(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      unsubscribe?.();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-anim-paused', paused);
  }, [paused]);
  return paused;
};
