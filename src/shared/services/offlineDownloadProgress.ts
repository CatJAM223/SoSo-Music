import { useCallback, useSyncExternalStore } from 'react';

const progressByTrack = new Map<string, number>();
const listeners = new Set<() => void>();
const trackListeners = new Map<string, Set<() => void>>();

function notify(trackId: string): void {
  listeners.forEach((listener) => listener());
  trackListeners.get(trackId)?.forEach((listener) => listener());
}

export function getOfflineDownloadProgress(trackId: string | number): number | null {
  return progressByTrack.get(String(trackId)) ?? null;
}

export function setOfflineDownloadProgress(
  trackId: string | number,
  progress: number | null,
): void {
  const key = String(trackId);
  if (progress === null) {
    if (progressByTrack.delete(key)) notify(key);
    return;
  }
  if (!Number.isFinite(progress)) return;
  // The UI displays whole percentages; do not wake every row for sub-percent byte updates.
  const next = Math.round(Math.min(1, Math.max(0, progress)) * 100) / 100;
  if (progressByTrack.get(key) === next) return;
  progressByTrack.set(key, next);
  notify(key);
}

export function subscribeOfflineDownloadProgress(
  listener: () => void,
  trackId?: string | number,
): () => void {
  if (trackId === undefined) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  const key = String(trackId);
  let group = trackListeners.get(key);
  if (!group) {
    group = new Set();
    trackListeners.set(key, group);
  }
  group.add(listener);
  return () => {
    group.delete(listener);
    if (group.size === 0) trackListeners.delete(key);
  };
}

export function useOfflineDownloadProgress(trackId: string | number): number | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeOfflineDownloadProgress(listener, trackId),
    [trackId],
  );
  return useSyncExternalStore(
    subscribe,
    () => getOfflineDownloadProgress(trackId),
    () => null,
  );
}
