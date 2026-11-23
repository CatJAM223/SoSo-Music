import type { Artist, MusicSource, Track } from '../types/index.ts';
import {
  assessSearchArtists,
  assessSearchTracks,
  mergeSearchTopTracks,
  searchQueryVariants,
} from './searchRanking.ts';

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

type Provider = Exclude<MusicSource, 'all'>;
type Part = 'tracks' | 'artists';
type Status = 'pending' | 'ok' | 'failed';

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
  searchArtistTracks?: (artist: Artist, source: Provider, requestId: string) => Promise<Track[]>;
  cancelSearch?: (requestId: string) => Promise<void>;
}

interface SourceResult {
  source: Provider;
  tracks: Track[];
  artists: Artist[];
  popular: Track[];
  status: Record<Part, Status>;
}

export interface SearchSnapshot {
  tracks: Track[];
  artists: Artist[];
  pending: boolean;
  tracksFirst: boolean;
  failedSources: Provider[];
  failures: { source: Provider; part: Part }[];
  sources: SourceResult[];
}

export async function runProgressiveSearch(
  query: string,
  source: MusicSource,
  api: SearchApi,
  onResults: (snapshot: SearchSnapshot) => void,
  timeoutMs = 15000,
  signal?: AbortSignal,
  resume?: SearchSnapshot,
): Promise<void> {
  const providers: Provider[] = source === 'all' ? ['youtube', 'soundcloud'] : [source];
  const deadline = performance.now() + timeoutMs;
  const parts: Part[] = ['tracks', 'artists'];
  const sources: SourceResult[] = providers.map((provider) => {
    const previous = resume?.sources.find((item) => item.source === provider);
    return previous
      ? { ...previous, status: { ...previous.status } }
      : {
          source: provider,
          tracks: [],
          artists: [],
          popular: [],
          status: { tracks: 'pending', artists: 'pending' },
        };
  });

  const request = <T>(
    execute: (id: string) => Promise<T>,
    budget: number,
  ): Promise<T | undefined> => {
    if (signal?.aborted || budget <= 0) return Promise.resolve(undefined);
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value?: T, cancel = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (cancel) void api.cancelSearch?.(id).catch(() => {});
        resolve(value);
      };
      const abort = () => finish(undefined, true);
      const timer = setTimeout(abort, budget);
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => (finished ? undefined : execute(id)))
        .then(
          (value) => finish(value),
          () => finish(),
        );
    });
  };
  let extrasPending = true;

  const ranked = () => ({
    tracks: assessSearchTracks(
      sources.flatMap((item) => mergeSearchTopTracks(item.tracks, item.popular)),
      query,
    ),
    artists: assessSearchArtists(
      sources.flatMap((item) => item.artists),
      query,
    ),
  });
  const publish = () => {
    if (signal?.aborted) return;
    const { tracks, artists } = ranked();
    const failures = sources.flatMap((item) =>
      parts
        .filter((part) => item.status[part] === 'failed')
        .map((part) => ({ source: item.source, part })),
    );
    onResults({
      tracks: tracks.items.slice(0, 40),
      artists: artists.items.slice(0, 6),
      tracksFirst: tracks.strong && !artists.strong,
      pending:
        extrasPending ||
        sources.some((item) => parts.some((part) => item.status[part] === 'pending')),
      failedSources: [...new Set(failures.map((failure) => failure.source))],
      failures,
      sources: sources.map((item) => ({ ...item, status: { ...item.status } })),
    });
  };

  const alternatives = searchQueryVariants(query);
  const jobs = sources.map(async (item) => {
    const selected = parts.filter((part) => item.status[part] !== 'ok');
    for (const part of selected) item.status[part] = 'pending';
    await Promise.all(
      selected.map(async (part) => {
        const budget = deadline - performance.now();
        if (part === 'tracks') {
          const reply = await request((id) => api.search(query, 40, item.source, id), budget);
          item.status.tracks = Array.isArray(reply?.data) ? 'ok' : 'failed';
          if (Array.isArray(reply?.data)) item.tracks = reply.data;
          publish();
          return;
        }
        const reply = api.searchArtists
          ? await request((id) => api.searchArtists!(query, 12, item.source, id), budget)
          : { data: [] };
        item.status.artists = Array.isArray(reply?.data) ? 'ok' : 'failed';
        if (Array.isArray(reply?.data)) item.artists = reply.data;
        publish();
        const exact = assessSearchArtists(item.artists, query);
        if (api.searchArtistTracks && exact.strong) {
          const hits = await request(
            (id) => api.searchArtistTracks!(exact.items[0], item.source, id),
            Math.min(3500, deadline - performance.now()),
          );
          if (Array.isArray(hits)) {
            item.popular = hits;
            publish();
          }
        }
      }),
    );
    if (!selected.length || !alternatives.length || signal?.aborted) return;
    const results = ranked();
    if (results.tracks.strong || results.artists.strong) return;
    const budgetEnd = Math.min(deadline, performance.now() + 1800);
    for (const alternative of alternatives) {
      const budget = budgetEnd - performance.now();
      if (budget <= 0 || signal?.aborted) return;
      const [trackReply, artistReply] = await Promise.all([
        selected.includes('tracks') && item.status.tracks === 'ok'
          ? request((id) => api.search(alternative, 16, item.source, id), budget)
          : undefined,
        api.searchArtists && selected.includes('artists') && item.status.artists === 'ok'
          ? request((id) => api.searchArtists!(alternative, 6, item.source, id), budget)
          : undefined,
      ]);
      const tracks = assessSearchTracks(trackReply?.data || [], alternative);
      const artists = assessSearchArtists(artistReply?.data || [], alternative);
      if (tracks.strong) item.tracks = [...item.tracks, ...tracks.items];
      if (artists.strong) item.artists = [...item.artists, ...artists.items];
      if (tracks.strong || artists.strong) {
        publish();
        return;
      }
    }
  });
  await Promise.all(jobs);
  extrasPending = false;
  publish();
}
