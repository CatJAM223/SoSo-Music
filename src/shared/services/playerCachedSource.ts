import type { Track } from '../types/index.ts';

interface CacheReaders {
  offlineUrl: (id: string | number) => Promise<string | null>;
  memoryUrl: (id: string | number) => string | null;
  isCurrent: () => boolean;
  signal?: AbortSignal;
}
type CachedPlayerSource =
  { kind: 'offline' | 'memory'; url: string; track: Track } | { kind: 'stale' | 'none' };

/** Artwork is optional and never delays installing an already available audio source. */
export async function readCachedPlayerCover(
  trackId: string | number,
  readers: {
    offlineCover: (id: string | number) => Promise<string | null>;
    isCurrent: () => boolean;
  },
): Promise<string | null> {
  if (!readers.isCurrent()) return null;
  try {
    const cover = await readers.offlineCover(trackId);
    return readers.isCurrent() ? cover : null;
  } catch (error) {
    console.warn('Offline artwork lookup error:', error);
    return null;
  }
}

export const OFFLINE_LOOKUP_TIMEOUT_MS = 2000;

/** IndexedDB can stay blocked indefinitely; audio selection must retain a bounded lifetime. */
function readOfflineUrl(trackId: Track['id'], readers: CacheReaders): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      readers.signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => {
      console.warn('[OfflineCache] Audio lookup timed out; continuing without disk cache');
      finish(null);
    }, OFFLINE_LOOKUP_TIMEOUT_MS);
    readers.signal?.addEventListener('abort', abort, { once: true });
    if (readers.signal?.aborted) {
      abort();
      return;
    }
    const failed = (error: unknown) => {
      if (!settled) console.warn('Offline cache lookup error:', error);
      finish(null);
    };
    try {
      Promise.resolve(readers.offlineUrl(trackId)).then(finish, failed);
    } catch (error) {
      failed(error);
    }
  });
}

/** A stale lookup cannot install old media or start another cache lookup after a selection changes. */
export async function readCachedPlayerSource(
  track: Track,
  readers: CacheReaders,
): Promise<CachedPlayerSource> {
  if (!readers.isCurrent() || readers.signal?.aborted) return { kind: 'stale' };
  const memoryUrl = readers.memoryUrl(track.id);
  if (memoryUrl) return { kind: 'memory', url: memoryUrl, track };
  try {
    const url = await readOfflineUrl(track.id, readers);
    if (!readers.isCurrent() || readers.signal?.aborted) return { kind: 'stale' };
    if (url) {
      return { kind: 'offline', url, track };
    }
  } catch (error) {
    console.warn('Offline cache lookup error:', error);
  }
  if (!readers.isCurrent()) return { kind: 'stale' };
  const url = readers.memoryUrl(track.id);
  return url ? { kind: 'memory', url, track } : { kind: 'none' };
}
