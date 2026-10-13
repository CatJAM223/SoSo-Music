import type { Artist, MusicSource, Track } from '../types/index.ts';
import { rankSearchTracks } from './searchRanking.ts';

export function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

interface SearchApi {
  search: (query: string, limit: number, source: MusicSource) => Promise<{ data: Track[] }>;
  searchArtists?: (
    query: string,
    limit: number,
    source: MusicSource,
  ) => Promise<{ data: Artist[] }>;
}
interface SearchSnapshot {
  tracks: Track[];
  artists: Artist[];
  pending: boolean;
}

/** Publish each provider as it arrives, preserving the same relevance ranking after merging. */
export async function runProgressiveSearch(
  query: string,
  source: MusicSource,
  api: SearchApi,
  onResults: (snapshot: SearchSnapshot) => void,
  timeoutMs = 15000,
): Promise<void> {
  const sources: MusicSource[] = source === 'all' ? ['youtube', 'soundcloud'] : [source];
  const tracks = new Map<MusicSource, Track[]>(),
    artists = new Map<MusicSource, Artist[]>();
  let pending = sources.length * 2;
  const publish = () => {
    const combined = sources.flatMap((item) => tracks.get(item) || []);
    const seen = new Set<string>();
    const combinedArtists = sources
      .flatMap((item) => artists.get(item) || [])
      .filter((artist) => {
        const key = (artist.name || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    onResults({
      tracks: rankSearchTracks(combined, query).slice(0, 40),
      artists: combinedArtists.slice(0, 6),
      pending: --pending > 0,
    });
  };
  const jobs = sources.flatMap((provider) => [
    settleWithin(
      Promise.resolve().then(() => api.search(query, 40, provider)),
      timeoutMs,
      { data: [] },
    ).then((reply) => {
      tracks.set(provider, Array.isArray(reply?.data) ? reply.data : []);
      publish();
    }),
    settleWithin(
      Promise.resolve().then(() => api.searchArtists?.(query, 6, provider) || { data: [] }),
      timeoutMs,
      { data: [] },
    ).then((reply) => {
      artists.set(provider, Array.isArray(reply?.data) ? reply.data : []);
      publish();
    }),
  ]);
  await Promise.all(jobs);
}
