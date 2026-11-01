import { useAnimationsPaused } from './useAnimationsPaused';
import { useLayoutEffect, type RefObject } from 'react';
import { useAudioControls } from '../context/AudioContext';

/** Paint only the timeline between media events; the rest of React stays idle. */
export function usePlaybackTimeline(
  target: RefObject<HTMLDivElement | null>,
  options: { position: number; duration: number; playing: boolean; preview?: number | null },
) {
  const effectsPaused = useAnimationsPaused();
  const { getPlaybackTime } = useAudioControls();
  const { position, duration, playing, preview = null } = options;
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    let frame = 0;
    let previous = '';
    const paint = () => {
      const clock = playing ? getPlaybackTime() : position;
      const seconds = preview ?? (Number.isFinite(clock) ? clock : position);
      const progress = duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0;
      const value = String(progress);
      if (value !== previous) element.style.setProperty('--playback-progress', value);
      previous = value;
    };
    const animate = () => {
      paint();
      frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      paint();
      if (playing && preview === null && !document.hidden && !effectsPaused)
        frame = requestAnimationFrame(animate);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [target, position, duration, playing, preview, getPlaybackTime, effectsPaused]);
}
