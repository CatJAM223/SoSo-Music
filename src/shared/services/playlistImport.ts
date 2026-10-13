import type { Track, Playlist } from '../types/index.ts';
import type {
  ExternalPlaylist,
  ExternalPlaylistTrack,
  ImportMatch,
  ImportSearchSource,
} from '../types/playlistImport.ts';
import { extractCoreTitle } from '../utils/trackFingerprint.ts';
import { getWaveArtistNames, matchesWaveArtist } from '../utils/waveIdentity.ts';
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
const tokenMatches = (wanted: string, actual: string) =>
  wanted === actual ||
  (wanted.endsWith('masktoken') && wanted.length >= 11 && actual.startsWith(wanted.slice(0, -9))) ||
  (actual.endsWith('masktoken') && actual.length >= 11 && wanted.startsWith(actual.slice(0, -9)));

export function scoreImportCandidate(
  original: ExternalPlaylistTrack,
  candidate: Track,
): { score: number; confident: boolean } {
  if (
    !candidate?.title ||
    !candidate.id ||
    !candidate.artist?.name ||
    candidate.playbackUnavailable ||
    !['soundcloud', 'youtube'].includes(candidate.source || '')
  )
    return { score: 0, confident: false };
  const targetVariants = variants(original.title);
  const candidateVariants = variants(candidate.title);
  if (
    targetVariants.size !== candidateVariants.size ||
    [...targetVariants].some((v) => !candidateVariants.has(v))
  )
    return { score: 0, confident: false };
  const originalArtists = getWaveArtistNames(original.artist);
  const artist = normalize(originalArtists[0] || '');
  const candidateArtist = normalize(candidate.artist.name.replace(/\s*[-–—]?\s*Topic$/i, ''));
  const creditNames = [...originalArtists, ...getWaveArtistNames(candidate)];
  const title = titleCore(candidate.title, creditNames);
  const expected = titleCore(original.title, originalArtists);
  if (!expected || !artist) return { score: 0, confident: false };
  const artistMatches =
    candidateArtist === artist || matchesWaveArtist(candidate, originalArtists[0]);
  if (!artistMatches) return { score: 0, confident: false };
  const wanted = new Set(expected.split(' ').filter(Boolean));
  const actual = new Set(title.split(' ').filter(Boolean));
  const common = [...wanted].filter((token) =>
    [...actual].some((other) => tokenMatches(token, other)),
  ).length;
  const recall = common / wanted.size;
  const precision = common / Math.max(1, actual.size);
  if (recall < 0.6 || precision < 0.5) return { score: 0, confident: false };
  const shortOriginal = original.duration > 0 && original.duration < 15;
  const durationKnown = original.duration >= 15 && candidate.duration > 0;
  const difference = durationKnown ? Math.abs(original.duration - candidate.duration) : 0;
  if (durationKnown && original.duration > 60 && candidate.duration <= 35)
    return { score: 0, confident: false };
  if (durationKnown && difference > Math.max(20, original.duration * 0.1) && recall < 0.95)
    return { score: 0, confident: false };
  const exact = title === expected;
  const masked = expected.includes('masktoken') || title.includes('masktoken');
  const confident =
    !shortOriginal &&
    (!masked || exact) &&
    (exact || (recall >= 0.95 && precision >= 0.9)) &&
    (!durationKnown || difference <= 8);
  return {
    score:
      recall * 45 +
      precision * 30 +
      (candidateArtist === artist ? 15 : 8) +
      (durationKnown ? Math.max(0, 10 - difference) : 3),
    confident,
  };
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
        const ranked = found
          .map((track) => ({ track, ...scoreImportCandidate(original, track) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score);
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
