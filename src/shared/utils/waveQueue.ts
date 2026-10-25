import { sequenceWaveIndices } from '../compute/waveSequence.ts';
import type { LibraryTasteGenre } from '../types/libraryTaste.ts';
import type { Track, WaveMood } from '../types/index.ts';
import { WAVE_HISTORY_LIMIT } from './waveHistoryLimits.ts';
import { areTracksDuplicates, buildTrackPrintFromTrack } from './trackFingerprint.ts';
import { getWaveArtistKeys, getWaveArtistNames, normalizeWaveArtist } from './waveIdentity.ts';

export const CURATED_WAVE_FALLBACK_QUERIES = [
  'zxcursed phonk',
  'DVRST Close Eyes',
  'Kordhell Murder In My Mind',
  'Interworld METAMORPHOSIS',
  'Hensonn Sahara',
  'madk1d',
  'shadowraze',
  'OG Buda',
  'Big Baby Tape',
  'Saluki',
  'Kai Angel',
  '9mice',
  'Friendly Thug 52 NGG',
  'Toxi$',
  'ssshhhiiittt!',
  'Буерак',
  'Молчат Дома',
  'Перемотка',
  'Дайте танк (!)',
  'Пошлая Молли',
  'КИНО Виктор Цой',
  'Валентин Стрыкало',
  'Гражданская Оборона',
  'ThxSoMch',
  'Nirvana',
  'Øneheart snowfall',
  'reidenshi lost memory',
  'leadwave memories',
  'antent your eyes',
  'Cigarettes After Sex',
  'The Weeknd',
  'Joji',
  'Chase Atlantic',
  'Arctic Monkeys',
  'Deftones',
];

export function getCuratedWaveArtist(query: string): string {
  const artists: Record<string, string> = {
    'zxcursed phonk': 'zxcursed',
    'DVRST Close Eyes': 'DVRST',
    'Kordhell Murder In My Mind': 'Kordhell',
    'Interworld METAMORPHOSIS': 'Interworld',
    'Hensonn Sahara': 'Hensonn',
    'КИНО Виктор Цой': 'КИНО',
    'Øneheart snowfall': 'Øneheart',
    'reidenshi lost memory': 'reidenshi',
    'leadwave memories': 'leadwave',
    'antent your eyes': 'antent',
  };
  return artists[query] || query;
}

export function isWaveMixOrPodcast(track: { title?: string; duration?: number }): boolean {
  const title = (track.title || '').toLowerCase();
  return (
    [
      '1 hour',
      '2 hour',
      '3 hour',
      '10 hour',
      '1hour',
      '2hour',
      'megamix',
      'compilation',
      'full album',
      'dj set',
      'live set',
      'podcast',
      'loop 1h',
      'loop 1 hour',
      'non stop mix',
      'continuous mix',
    ].some((term) => title.includes(term)) ||
    /(?:^|[^\p{L}\p{N}])(?:микс|мегамикс|сборник|подборка|dj\s*mix|nonstop)(?:$|[^\p{L}\p{N}])/u.test(
      title,
    ) ||
    (Number(track.duration) || 0) > 1200
  );
}

export function isWaveGarbageRemix(track: { title?: string }): boolean {
  const title = (track.title || '').toLowerCase();
  return (
    ['earrape', 'distorted', 'bass boosted 1000%', 'nightcore sped up 2x', 'troll'].some((term) =>
      title.includes(term),
    ) && !title.includes('remix')
  );
}

const artistKey = (track: Track): string =>
  (typeof track.artist === 'string' ? track.artist : track.artist?.name || '')
    .trim()
    .toLocaleLowerCase();

export { isWaveTempoEdit, isWaveMoodMismatch } from './waveTrackMetadata.ts';

export interface DislikedWaveTrack {
  id: string | number;
  title: string;
  artist: string;
}

export function matchesDislikedWaveTrack(track: Track, disliked: DislikedWaveTrack): boolean {
  if (String(track.id) === String(disliked.id)) return true;
  if (!disliked.title || !disliked.artist) return false;
  const artist = disliked.artist.trim().toLocaleLowerCase();
  if (
    !artist ||
    (artistKey(track) !== artist && !(track.title || '').toLocaleLowerCase().includes(artist))
  )
    return false;
  return areTracksDuplicates(buildTrackPrintFromTrack(track), buildTrackPrintFromTrack(disliked));
}

/** A quick skip should not immediately lead to another song by the same artist. */
export function moveDifferentArtistAfterSkip(queue: Track[], currentIndex: number): Track[] {
  const current = queue[currentIndex];
  const next = queue[currentIndex + 1];
  if (!current || !next) return queue;
  const knownArtists = queue.flatMap(getWaveArtistNames);
  const currentArtists = getWaveArtistKeys(current, knownArtists);
  const overlaps = (track: Track) =>
    getWaveArtistKeys(track, knownArtists).some((artist) => currentArtists.includes(artist));
  if (!overlaps(next)) return queue;
  const replacementIndex = queue.findIndex(
    (track, index) => index > currentIndex + 1 && !overlaps(track),
  );
  if (replacementIndex < 0) return queue;
  const reordered = [...queue];
  [reordered[currentIndex + 1], reordered[replacementIndex]] = [
    reordered[replacementIndex],
    reordered[currentIndex + 1],
  ];
  return reordered;
}

export interface WaveQueueOptions {
  tasteTracks?: readonly Track[];
  libraryGenres?: readonly LibraryTasteGenre[];
  learnedTracks?: readonly Track[];
  discoveryAdjustment?: number;
  sequenceOffset?: number;
  positiveTracks?: readonly Track[];
  skippedTracks?: readonly Track[];
  /** Short-lived in-session feedback, keyed by normalized artist name. */
  artistFeedback?: ReadonlyMap<string, number>;
  /** Artists that just played, including the end of the previous batch. */
  recentArtists?: string[];
  /** Heard songs whose other uploads/versions should not be offered again. */
  recentTracks?: readonly Track[];
  /** Proposed songs lose priority without becoming forbidden recordings. */
  offeredTracks?: readonly Track[];
}

/** Rotate artist searches across batches rather than just shuffling the same pool. */
export function spreadWaveSeedArtists(
  artists: string[],
  recent: readonly string[][],
  weights: ReadonlyMap<string, number> = new Map(),
): string[] {
  const counts = new Map<string, number>();
  for (const keys of recent.slice(-50)) {
    for (const key of keys)
      counts.set(normalizeWaveArtist(key), (counts.get(normalizeWaveArtist(key)) || 0) + 1);
  }
  const cost = (artist: string) =>
    (counts.get(normalizeWaveArtist(artist)) || 0) +
    (weights.get(normalizeWaveArtist(artist)) === 0.25
      ? 2
      : weights.get(normalizeWaveArtist(artist)) === 2
        ? -1
        : 0);
  return [...artists].sort((a, b) => cost(a) - cost(b));
}

export function sequenceWaveTracks(
  tracks: Track[],
  mood: WaveMood,
  familiarArtists: string[],
  limit = 25,
  options: WaveQueueOptions = {},
): Track[] {
  return sequenceWaveIndices(tracks, mood, familiarArtists, limit, options).map(
    (index) => tracks[index],
  );
}

/** Reorder only the unplayed tail, retaining history and the current index. */
export function resequenceWaveQueue(
  queue: Track[],
  currentIndex: number,
  mood: WaveMood,
  familiarArtists: string[],
  artistFeedback: ReadonlyMap<string, number>,
  history: readonly Track[] = [],
  offeredTracks: readonly Track[] = [],
  musicOptions: Pick<
    WaveQueueOptions,
    'tasteTracks' | 'positiveTracks' | 'skippedTracks' | 'learnedTracks' | 'discoveryAdjustment'
  > = {},
): Track[] {
  const played = queue.slice(0, currentIndex + 1);
  const pending = queue.slice(currentIndex + 1);
  const playedIds = new Set(played.map((track) => String(track.id)));
  const sequenced = sequenceWaveTracks(pending, mood, familiarArtists, pending.length, {
    ...musicOptions,
    sequenceOffset: currentIndex + 1,
    artistFeedback,
    offeredTracks,
    recentTracks: [...history.filter((track) => !playedIds.has(String(track.id))), ...played].slice(
      -WAVE_HISTORY_LIMIT,
    ),
  });
  return [...played, ...sequenced];
}
