import type { Track, Playlist } from '../types/index.ts';
import type {
  ExternalPlaylist,
  ExternalPlaylistTrack,
  ImportMatch,
  ImportSearchSource,
} from '../types/playlistImport.ts';
import { extractCoreTitle } from '../utils/trackFingerprint.ts';
import {
  getWaveArtistNames,
  getWaveArtistKeys,
  normalizeWaveArtist,
} from '../utils/waveIdentity.ts';
import { runRustCompute } from '../compute/rustCore.ts';
import { PlaybackLogger } from './playbackLogger.ts';

export type ImportSearch = (
  query: string,
  limit: number,
  source: ImportSearchSource,
) => Promise<{ data: Track[] }>;
const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const variants = (title: string) => {
  const words = normalize(title)
    .replace(/ремикс/g, 'remix')
    .replace(/speed\s*up|sped\s*up|speedup/g, 'sped')
    .replace(/кавер/g, 'cover')
    .replace(/караоке/g, 'karaoke')
    .replace(/акустик\w*/g, 'acoustic');
  return new Set(
    words
      .split(' ')
      .filter((word) =>
        [
          'remix',
          'bootleg',
          'live',
          'acoustic',
          'cover',
          'instrumental',
          'karaoke',
          'slowed',
          'sped',
          'nightcore',
          'reverb',
          'mashup',
          'минусовка',
          'extended',
          'tour',
        ].includes(word),
      ),
  );
};
const titleCore = (title: string, artists: string[]) => {
  let core = normalize(
    extractCoreTitle(title.normalize('NFKC').replace(/([\p{L}\p{N}]*)\*+/gu, '$1masktoken')),
  );
  for (const artist of artists.map(normalize).sort((a, b) => b.length - a.length)) {
    if (artist)
      core = (' ' + core + ' ')
        .split(' ' + artist + ' ')
        .join(' ')
        .trim();
  }
  return core;
};
export function rankImportCandidates(original: ExternalPlaylistTrack, candidates: Track[]) {
  if (candidates.length > 256) throw Error('Too many import candidates');
  let packet = new Uint8Array(16384);
  let view = new DataView(packet.buffer);
  let offset = 0;
  const encoder = new TextEncoder();
  const ensure = (size: number) => {
    if (offset + size > 8 * 1024 * 1024) throw Error('Import metadata exceeds limits');
    if (offset + size <= packet.length) return;
    const next = new Uint8Array(
      Math.min(8 * 1024 * 1024, Math.max(packet.length * 2, offset + size)),
    );
    next.set(packet.subarray(0, offset));
    packet = next;
    view = new DataView(next.buffer);
  };
  const word = (value: number) => {
    ensure(4);
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const number = (value: number) => {
    ensure(8);
    view.setFloat64(offset, Number.isFinite(value) ? value : 0, true);
    offset += 8;
  };
  const text = (value: string) => {
    ensure(value.length * 3 + 4);
    const { written } = encoder.encodeInto(value, packet.subarray(offset + 4));
    view.setUint32(offset, written, true);
    offset += 4 + written;
  };
  const strings = (values: Iterable<string>) => {
    const list = [...values];
    word(list.length);
    list.forEach(text);
  };
  const artists = getWaveArtistNames(original.artist);
  const artist = normalize(artists[0] || '');
  word(1);
  word(candidates.length);
  number(original.duration);
  text(artist);
  text(titleCore(original.title, artists));
  strings(variants(original.title));
  strings(getWaveArtistNames(artists[0] || '').map(normalizeWaveArtist));
  for (const candidate of candidates) {
    const candidateArtist = normalize(
      (candidate?.artist?.name || '').replace(/\s*[-–—]?\s*Topic$/i, ''),
    );
    word(
      candidate?.title &&
        candidate.id &&
        candidate.artist?.name &&
        !candidate.playbackUnavailable &&
        ['soundcloud', 'youtube'].includes(candidate.source || '')
        ? 1
        : 0,
    );
    number(candidate?.duration || 0);
    text(candidateArtist);
    text(titleCore(candidate?.title || '', [...artists, ...getWaveArtistNames(candidate || '')]));
    strings(variants(candidate?.title || ''));
    // Exact credit text already travels in the packet. Extra parsed credits are only
    // needed when the uploader differs, avoiding repeated catalog metadata parsing.
    strings(
      candidateArtist === artist ? [] : getWaveArtistKeys(candidate || {}, artists.slice(0, 1)),
    );
  }
  const bytes = runRustCompute('match_import', packet.subarray(0, offset));
  if (bytes.length !== candidates.length * 16) throw Error('Invalid Rust import ranking');
  const result = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return candidates.map((_, i) => ({
    track: candidates[result.getUint32(i * 16, true)],
    score: result.getFloat64(i * 16 + 4, true),
    confident: result.getUint32(i * 16 + 12, true) === 1,
  }));
}

export function scoreImportCandidate(
  original: ExternalPlaylistTrack,
  candidate: Track,
): { score: number; confident: boolean } {
  const { score, confident } = rankImportCandidates(original, [candidate])[0];
  return { score, confident };
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Импорт остановлен', 'AbortError');
}

async function boundedSearch(
  search: ImportSearch,
  query: string,
  source: ImportSearchSource,
  signal?: AbortSignal,
): Promise<Track[]> {
  checkAbort(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      search(query, 24, source),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Поиск не ответил за 25 секунд')), 25000);
        abort = () => reject(new DOMException('Импорт остановлен', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
    checkAbort(signal);
    return (result?.data || []).filter((track) => track.source === source);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

export async function matchImportedTrack(
  original: ExternalPlaylistTrack,
  priority: ImportSearchSource,
  search: ImportSearch,
  signal?: AbortSignal,
): Promise<ImportMatch> {
  const sources: ImportSearchSource[] = [
    priority,
    priority === 'soundcloud' ? 'youtube' : 'soundcloud',
  ];
  const candidates: { track: Track; score: number; confident: boolean }[] = [];
  const failures: string[] = [];
  for (const source of sources) {
    checkAbort(signal);
    try {
      const artist = getWaveArtistNames(original.artist)[0] || original.artist;
      const cleanTitle = extractCoreTitle(original.title.normalize('NFKC')).trim();
      const queries = [
        ...new Set([
          `${artist} - ${original.title}`,
          `${artist} ${cleanTitle}`,
          `${cleanTitle} ${artist}`,
        ]),
      ];
      for (const query of queries) {
        checkAbort(signal);
        const found = await boundedSearch(search, query, source, signal);
        const ranked = rankImportCandidates(original, found).filter((item) => item.score > 0);
        candidates.push(...ranked);
        PlaybackLogger.info(
          `[Import:Search] ${original.artist} — ${original.title}: duration=${original.duration}s, source=${source}, found=${found.length}, accepted=${ranked.length}`,
        );
        const confident = ranked.find((item) => item.confident);
        if (confident)
          return {
            original,
            status: 'matched',
            track: confident.track,
            candidates: ranked.slice(0, 4).map((item) => item.track),
          };
        // More queries help missing metadata, but an exact uncertain recording
        // should stay in review rather than flooding its artist's search.
        if (ranked.length && !original.title.includes('*')) break;
      }
    } catch (error) {
      checkAbort(signal);
      failures.push(error instanceof Error ? error.message : 'Ошибка поиска');
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const unique = candidates.filter(
    (item, index, all) =>
      all.findIndex(
        (other) => other.track.source === item.track.source && other.track.id === item.track.id,
      ) === index,
  );
  if (unique.length)
    return {
      original,
      status: 'review',
      candidates: unique.slice(0, 4).map((item) => item.track),
      error: failures.join('; ') || undefined,
    };
  return {
    original,
    status: failures.length ? 'error' : 'missing',
    candidates: [],
    error: failures.join('; ') || undefined,
  };
}

/** Two workers keep large playlists responsive without flooding either catalog. */
export async function matchImportedPlaylist(
  playlist: ExternalPlaylist,
  priority: ImportSearchSource,
  search: ImportSearch,
  onProgress: (matches: ImportMatch[], completed: number) => void,
  signal?: AbortSignal,
): Promise<ImportMatch[]> {
  const results: ImportMatch[] = new Array(playlist.tracks.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < playlist.tracks.length) {
      checkAbort(signal);
      const index = next++;
      results[index] = await matchImportedTrack(playlist.tracks[index], priority, search, signal);
      checkAbort(signal);
      onProgress(results.slice(), ++completed);
      if (next < playlist.tracks.length) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  await Promise.all([worker(), worker()]);
  return results;
}

export interface ImportPlaylistStorage {
  createPlaylist(name: string, description?: string): Promise<string | Playlist>;
  addTrackToPlaylist(id: string, track: any): Promise<boolean>;
  deletePlaylist(id: string): Promise<boolean>;
  setPlaylistCover?(id: string, coverUrl: string): Promise<boolean>;
}

/** Save only accepted matches, in source order. Roll back our new playlist on failure. */
export async function saveImportedPlaylist(
  name: string,
  playlist: ExternalPlaylist,
  matches: ImportMatch[],
  storage: ImportPlaylistStorage,
): Promise<{ id: string; count: number }> {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 200)
    throw new Error('Название плейлиста должно содержать от 1 до 200 символов.');
  const seen = new Set<string>();
  const tracks = matches.flatMap((match) => {
    if (!match?.track) return [];
    const key = `${match.track.source}:${match.track.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [match.track];
  });
  if (!tracks.length) throw new Error('Выберите хотя бы один найденный трек.');
  const created = await storage.createPlaylist(
    cleanName,
    `Перенесено с ${playlist.source === 'vk' ? 'VK Музыки' : 'Яндекс Музыки'}`,
  );
  const id = typeof created === 'string' ? created : created.id;
  if (!id) throw new Error('Не удалось создать плейлист.');
  try {
    if (playlist.coverUrl?.startsWith('data:image/') && storage.setPlaylistCover) {
      if (!(await storage.setPlaylistCover(id, playlist.coverUrl)))
        throw new Error('Не удалось сохранить обложку плейлиста.');
    }
    for (const track of tracks) {
      const success = await storage.addTrackToPlaylist(id, {
        id: track.id,
        deezer_id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album?.title || '',
        cover_url: track.cover_url || track.album?.cover_medium || track.album?.cover || '',
        preview_url: track.preview || '',
        duration: track.duration,
        source: track.source,
      });
      if (!success) throw new Error(`Не удалось сохранить «${track.title}».`);
    }
    return { id, count: tracks.length };
  } catch (error) {
    try {
      if (!(await storage.deletePlaylist(id))) throw new Error('rollback');
    } catch {
      throw new Error(
        'Сохранение прервалось. В медиатеке остался неполный плейлист; удалите его перед повторным импортом.',
      );
    }
    throw error;
  }
}
