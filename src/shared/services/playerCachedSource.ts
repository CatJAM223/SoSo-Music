import type { Track } from '../types/index.ts';

interface CacheReaders {
  offlineUrl: (id: string | number) => Promise<string | null>;
  memoryUrl: (id: string | number) => string | null;
  isCurrent: () => boolean;
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

/** A stale lookup cannot install old media or start another cache lookup after a selection changes. */
export async function readCachedPlayerSource(
  track: Track,
  readers: CacheReaders,
): Promise<CachedPlayerSource> {
  if (!readers.isCurrent()) return { kind: 'stale' };
  const memoryUrl = readers.memoryUrl(track.id);
  if (memoryUrl) return { kind: 'memory', url: memoryUrl, track };
  try {
    const url = await readers.offlineUrl(track.id);
    if (!readers.isCurrent()) return { kind: 'stale' };
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
