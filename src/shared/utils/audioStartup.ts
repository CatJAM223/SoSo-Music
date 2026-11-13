import { remainingStartupBudget, completeStartupBudget } from './playbackStartupBudget.ts';
import type { StreamResolveFailure } from './streamResolveError';

export type AudioLoadOwner = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  onFailure: (kind?: StreamResolveFailure) => void;
};

/** HLS can wait for its manifest while the media element is still paused. */
export function watchAudioStartup(
  audio: HTMLMediaElement,
  isCurrent: () => boolean,
  onTimeout: () => void,
  signal?: AbortSignal,
): () => void {
  let active = true;
  const playing = () => {
    if (signal) completeStartupBudget(signal);
    cleanup();
  };
  const cleanup = () => {
    active = false;
    clearTimeout(timer);
    audio.removeEventListener('playing', playing);
    audio.removeEventListener('pause', pause);
    signal?.removeEventListener('abort', cleanup);
  };
  const pause = () => {
    if (!isCurrent()) cleanup();
  };
  const timer = setTimeout(
    () => {
      cleanup();
      if (isCurrent() && !signal?.aborted) onTimeout();
    },
    signal ? Math.min(8000, remainingStartupBudget(signal)) : 8000,
  );
  audio.addEventListener('playing', playing, { once: true });
  audio.addEventListener('pause', pause);
  signal?.addEventListener('abort', cleanup, { once: true });
  if (signal?.aborted) cleanup();
  return () => {
    if (active) cleanup();
  };
}
