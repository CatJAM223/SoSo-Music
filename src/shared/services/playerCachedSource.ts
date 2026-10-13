import type { Track } from '../types/index.ts';

interface CacheReaders {
  offlineUrl: (id: string | number) => Promise<string | null>;
  offlineCover: (id: string | number) => Promise<string | null>;
  memoryUrl: (id: string | number) => string | null;
  isCurrent: () => boolean;
}
type CachedPlayerSource =
  { kind: 'offline' | 'memory'; url: string; track: Track } | { kind: 'stale' | 'none' };

function withOfflineCover(track: Track, cover: string | null): Track {
  if (!cover) return track;
  return {
    ...track,
    cover_url: cover,
    album:
      track.album && typeof track.album === 'object'
        ? { ...track.album, cover, cover_medium: cover }
        : track.album,
  };
}

/** A stale lookup cannot install old media or start another cache lookup after a selection changes. */
export async function readCachedPlayerSource(
  track: Track,
  readers: CacheReaders,
): Promise<CachedPlayerSource> {
  try {
    const url = await readers.offlineUrl(track.id);
    if (!readers.isCurrent()) return { kind: 'stale' };
    if (url) {
      const cover = await readers.offlineCover(track.id);
      if (!readers.isCurrent()) return { kind: 'stale' };
      return { kind: 'offline', url, track: withOfflineCover(track, cover) };
    }
  } catch (error) {
    console.warn('Offline cache lookup error:', error);
  }
  if (!readers.isCurrent()) return { kind: 'stale' };
  const url = readers.memoryUrl(track.id);
  return url ? { kind: 'memory', url, track } : { kind: 'none' };
}
