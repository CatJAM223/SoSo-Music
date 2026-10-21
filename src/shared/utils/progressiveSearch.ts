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
  search: (
    query: string,
    limit: number,
    source: MusicSource,
    requestId?: string,
  ) => Promise<{ data: Track[] }>;
  searchArtists?: (
    query: string,
    limit: number,
    source: MusicSource,
    requestId?: string,
  ) => Promise<{ data: Artist[] }>;
  cancelSearch?: (requestId: string) => Promise<void>;
}
interface SearchSnapshot {
  tracks: Track[];
  artists: Artist[];
  pending: boolean;
  failedSources: MusicSource[];
}

/** Publish each provider as it arrives, preserving the same relevance ranking after merging. */
export async function runProgressiveSearch(
  query: string,
  source: MusicSource,
  api: SearchApi,
  onResults: (snapshot: SearchSnapshot) => void,
  timeoutMs = 15000,
  signal?: AbortSignal,
): Promise<void> {
  const sources: MusicSource[] = source === 'all' ? ['youtube', 'soundcloud'] : [source];
  const tracks = new Map<MusicSource, Track[]>(),
    artists = new Map<MusicSource, Artist[]>();
  let pending = sources.length * 2;
  const failures = new Set<MusicSource>();
  const request = <T>(
    provider: MusicSource,
    execute: (id: string) => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value: T, failed = false, cancel = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (failed) failures.add(provider);
        if (cancel) void api.cancelSearch?.(id).catch(() => {});
        resolve(value);
      };
      const abort = () => finish(fallback, false, true);
      const timer = setTimeout(() => finish(fallback, true, true), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      Promise.resolve()
        .then(() => (finished ? fallback : execute(id)))
        .then(
          (value) => finish(value),
          () => finish(fallback, true),
        );
    });
  };
  const publish = () => {
    if (signal?.aborted) return;
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
      failedSources: [...failures],
    });
  };
  const jobs = sources.flatMap((provider) => [
    request(provider, (id) => api.search(query, 40, provider, id), { data: [] }).then((reply) => {
      tracks.set(provider, Array.isArray(reply?.data) ? reply.data : []);
      publish();
    }),
    request(provider, async (id) => api.searchArtists?.(query, 6, provider, id) || { data: [] }, {
      data: [],
    }).then((reply) => {
      artists.set(provider, Array.isArray(reply?.data) ? reply.data : []);
      publish();
    }),
  ]);
  await Promise.all(jobs);
}
