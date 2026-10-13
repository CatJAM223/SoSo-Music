import { detectTrackSource } from '../utils/formatters.ts';

const key = 'soso_youtube_playback_disabled';
let owner: Window | undefined;
let disabled = false;
const listeners = new Set<() => void>();
export function isYouTubePlaybackDisabled(): boolean {
  if (typeof window === 'undefined' || !window.electronAPI?.connectYouTubeAccount) return false;
  if (owner !== window) {
    owner = window;
    try {
      disabled = localStorage.getItem(key) === 'true';
    } catch {
      disabled = false;
    }
  }
  return disabled;
}
export function setYouTubePlaybackDisabled(value: boolean): void {
  const previous = isYouTubePlaybackDisabled();
  if (typeof window === 'undefined' || !window.electronAPI?.connectYouTubeAccount) return;
  disabled = value;
  try {
    if (value) localStorage.setItem(key, 'true');
    else localStorage.removeItem(key);
  } catch {}
  if (previous !== value) listeners.forEach((listener) => listener());
}
export function subscribeYouTubeAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function isYouTubeItemDisabled(
  item: unknown,
  blocked = isYouTubePlaybackDisabled(),
): boolean {
  return blocked && !!item && detectTrackSource(item) === 'youtube';
}
/** Inert removes every nested action from mouse and keyboard navigation. */
export function youtubeDisabledProps(item: unknown, blocked: boolean) {
  return isYouTubeItemDisabled(item, blocked)
    ? { 'data-youtube-disabled': 'true', 'aria-disabled': true as const, inert: '' }
    : {};
}
/** Bounded navigation keeps blocked items in the queue without attempting playback. */
export function availableQueueIndex(
  queue: readonly unknown[],
  start: number,
  direction: 1 | -1,
  wrap: boolean,
): number {
  for (let count = 0, index = start; count < queue.length; count++, index += direction) {
    if (wrap) index = ((index % queue.length) + queue.length) % queue.length;
    if (index < 0 || index >= queue.length) return -1;
    if (!isYouTubeItemDisabled(queue[index])) return index;
  }
  return -1;
}
