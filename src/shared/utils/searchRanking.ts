import type { Artist, Track } from '../types/index.ts';
import { runRustCompute } from '../compute/rustCore.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const SEARCH_PACKET_VERSION = 2;
const MAX_CANDIDATES = 65_536;
const MAX_PACKET_SIZE = 8 * 1024 * 1024;

interface Candidate {
  fields: string[];
  flags: number;
  providerRank?: number;
  topRank?: number;
  duration?: number;
}

function compute(query: string, mode: 0 | 1 | 2, candidates?: Candidate[]): Uint8Array {
  const encodedQuery = encoder.encode(query.normalize('NFKC'));
  const rows = candidates?.map((candidate) => ({
    ...candidate,
    fields: candidate.fields.map((field) => encoder.encode(field.normalize('NFKC'))),
  }));
  const size =
    6 +
    encodedQuery.length +
    (rows
      ? 4 +
        rows.reduce(
          (sum, row) => sum + 16 + row.fields.reduce((n, field) => n + 4 + field.length, 0),
          0,
        )
      : 0);
  if (size > MAX_PACKET_SIZE) throw Error('Search compute packet limit exceeded');
  const input = new Uint8Array(size);
  const view = new DataView(input.buffer);
  input[0] = SEARCH_PACKET_VERSION;
  input[1] = mode;
  let offset = 2;
  const putNumber = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const putText = (value: Uint8Array) => {
    putNumber(value.length);
    input.set(value, offset);
    offset += value.length;
  };
  putText(encodedQuery);
  if (rows) {
    putNumber(rows.length);
    for (const row of rows) {
      row.fields.forEach(putText);
      putNumber(row.flags);
      putNumber(row.providerRank ?? 0);
      putNumber(row.topRank ?? 0);
      putNumber(row.duration ?? 0);
    }
  }
  return runRustCompute('rank_search', input);
}

function rank<T>(
  items: T[],
  query: string,
  mode: 0 | 1,
  toCandidate: (item: T) => Candidate,
): { items: T[]; strong: boolean } {
  if (!items.length) return { items: [], strong: false };
  if (items.length > MAX_CANDIDATES) throw Error('Search compute candidate limit exceeded');
  const result = compute(query, mode, items.map(toCandidate));
  if (result[0] > 1 || (result.length - 1) % 4 || result.length > 1 + items.length * 4)
    throw Error('Invalid Rust search result');
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  return {
    strong: result[0] === 1,
    items: Array.from({ length: (result.length - 1) / 4 }, (_, i) => {
      const index = view.getUint32(1 + i * 4, true);
      if (index >= items.length) throw Error('Invalid Rust search index');
      return items[index];
    }),
  };
}

export function assessSearchTracks(tracks: Track[], query: string) {
  return rank(tracks, query, 0, (track) => ({
    fields: [
      track.title || '',
      (typeof track.artist === 'string' ? track.artist : track.artist?.name) || '',
      track.album?.title || '',
      searchTrackKey(track),
    ],
    flags:
      Number(track.source === 'youtube') |
      (Number(
        Boolean(track.album?.title && !['Single', 'Unknown Album'].includes(track.album.title)),
      ) <<
        1) |
      (Number(Boolean(track.playbackUnavailable)) << 2),
    providerRank: track.searchProviderRank,
    topRank: track.searchTopRank,
    duration: Number.isFinite(track.duration)
      ? Math.max(0, Math.min(86400, Math.round(track.duration)))
      : 0,
  }));
}

export function rankSearchTracks(tracks: Track[], query: string): Track[] {
  return assessSearchTracks(tracks, query).items;
}

export function assessSearchArtists(artists: Artist[], query: string) {
  return rank(artists, query, 1, (artist) => ({
    fields: ['', artist.name || '', '', String(artist.id)],
    flags: Number(artist.source === 'youtube'),
  }));
}

export function searchQueryVariants(query: string): string[] {
  const result = decoder.decode(compute(query, 2));
  return result ? result.split('\n') : [];
}

export function markSearchOrder(tracks: Track[], popular = false): Track[] {
  return tracks.map((track, index) =>
    popular ? { ...track, searchTopRank: index + 1 } : { ...track, searchProviderRank: index + 1 },
  );
}

function searchTrackKey(track: Track): string {
  return `${track.source || ''}:${track.id}`;
}

/** Attach shelf order to the search hit with the same provider ID, when available. */
export function mergeSearchTopTracks(tracks: Track[], popular: Track[]): Track[] {
  const hits = new Map(popular.map((track) => [searchTrackKey(track), track]));
  return [
    ...tracks.map((track) => {
      const key = searchTrackKey(track);
      const hit = hits.get(key);
      if (!hit) return track;
      hits.delete(key);
      return { ...track, searchTopRank: hit.searchTopRank };
    }),
    ...hits.values(),
  ];
}
