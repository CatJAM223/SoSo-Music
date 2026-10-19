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
  const cleanup = () => {
    active = false;
    clearTimeout(timer);
    audio.removeEventListener('playing', cleanup);
    audio.removeEventListener('pause', pause);
    signal?.removeEventListener('abort', cleanup);
  };
  const pause = () => {
    if (!isCurrent()) cleanup();
  };
  const timer = setTimeout(() => {
    cleanup();
    if (isCurrent() && !signal?.aborted) onTimeout();
  }, 8000);
  audio.addEventListener('playing', cleanup, { once: true });
  audio.addEventListener('pause', pause);
  signal?.addEventListener('abort', cleanup, { once: true });
  if (signal?.aborted) cleanup();
  return () => {
    if (active) cleanup();
  };
}
