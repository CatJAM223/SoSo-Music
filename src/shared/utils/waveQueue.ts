import { libraryGenreAffinity, boundedLibraryGenreScore } from './libraryTaste.ts';
import type { LibraryTasteGenre } from '../types/libraryTaste.ts';
import { scoreWaveCandidate, type WaveRankingContext } from './waveCandidateRanking.ts';
import { waveDiscoveryTarget } from './waveFeedback.ts';
import { createWaveMusicScorer, waveMusicProfile } from './waveMusicProfile.ts';
import { withWaveTextCache } from '../compute/waveTextCache.ts';
import { createWaveSongMatrix } from '../compute/waveSongMatrix.ts';
import type { Track, WaveMood } from '../types/index.ts';
import { WAVE_HISTORY_LIMIT } from './waveHistoryLimits.ts';
import { areTracksDuplicates, buildTrackPrintFromTrack } from './trackFingerprint.ts';
import {
  areSameWaveSong,
  buildWaveSongIdentity,
  getWaveArtistKeys,
  getWaveArtistNames,
  isWaveNonMusic,
  normalizeWaveArtist,
} from './waveIdentity.ts';

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

const TEMPO_EDIT_TITLE =
  /\b(?:slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|bass[\s-]*boost(?:ed)?)\b/i;

/** Mark common speed-edit uploads so regular versions can rank ahead of them. */
export function isWaveTempoEdit(track: Pick<Track, 'title'>): boolean {
  return TEMPO_EDIT_TITLE.test(track.title || '');
}

/** Explicitly relaxed versions do not fit the energetic station. */
export function isWaveMoodMismatch(track: Pick<Track, 'title'>, mood: WaveMood): boolean {
  return (
    mood === 'energy' && /\b(?:slowed|daycore|acoustic)\b|акустик|замедлен/i.test(track.title || '')
  );
}

function waveVersionPenalty(track: Pick<Track, 'title'>): number {
  if (isWaveTempoEdit(track)) return 18;
  if (/\b(?:live|acoustic|cover)\b|кавер|акустик/i.test(track.title || '')) return 8;
  if (/\b(?:remix|bootleg|mashup)\b/i.test(track.title || '')) return 3;
  return /\bremaster(?:ed)?\b/i.test(track.title || '') ? 1 : 0;
}

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
  return withWaveTextCache(() =>
    sequenceWaveTracksUncached(tracks, mood, familiarArtists, limit, options),
  );
}

/** Put familiar music near the front, while spacing artists and sources across the queue. */
function sequenceWaveTracksUncached(
  tracks: Track[],
  mood: WaveMood,
  familiarArtists: string[],
  limit = 25,
  options: WaveQueueOptions = {},
): Track[] {
  const familiar = new Set(familiarArtists.flatMap(getWaveArtistNames).map(normalizeWaveArtist));
  const knownArtists = [
    ...new Set([
      ...familiarArtists,
      ...tracks.flatMap(getWaveArtistNames),
      ...(options.recentTracks || []).flatMap(getWaveArtistNames),
    ]),
  ];
  const recentSongs = (options.recentTracks || []).map((track) =>
    buildWaveSongIdentity(track, knownArtists),
  );
  const offeredSongs = (options.offeredTracks || []).map((track) =>
    buildWaveSongIdentity(track, knownArtists),
  );
  const offeredArtists = (options.offeredTracks || [])
    .slice(-25)
    .map((track) => getWaveArtistKeys(track, knownArtists));
  const scoreMusic = createWaveMusicScorer(
    options.tasteTracks,
    options.positiveTracks,
    options.skippedTracks,
    options.learnedTracks,
  );
  // Library rows often have no genre tags. Identity still gives a like concrete influence.
  const likedSeeds = (options.tasteTracks || []).filter((track) => track.waveSeedWeight === 2);
  const likedArtists = new Set(
    likedSeeds.flatMap((track) => getWaveArtistKeys(track, knownArtists)),
  );
  const likedSongs = likedSeeds.map((track) => buildWaveSongIdentity(track, knownArtists));
  const skippedIds = new Set((options.skippedTracks || []).map((track) => String(track.id)));
  const lastHeard = [...(options.recentTracks || [])]
    .reverse()
    .find((track) => !skippedIds.has(String(track.id)));
  let previousMusic = lastHeard ? waveMusicProfile(lastHeard) : undefined;
  const prepared = tracks
    .filter(
      (track) =>
        !track.playbackUnavailable && !isWaveNonMusic(track) && !isWaveMoodMismatch(track, mood),
    )
    .map((track, matrixIndex) => {
      const artists = getWaveArtistKeys(track, knownArtists);
      const song = buildWaveSongIdentity(track, knownArtists);
      const versionPenalty = waveVersionPenalty(track);
      const versionPriority =
        versionPenalty + (artists.some((artist) => familiar.has(artist)) ? 0 : 0.5);
      const music = waveMusicProfile(track);
      return {
        track,
        artists,
        song,
        matrixIndex,
        music,
        musicScore:
          scoreMusic(music, mood) +
          (options.libraryGenres
            ? libraryGenreAffinity(music.styles, options.libraryGenres)
            : boundedLibraryGenreScore(track.waveGenreScore)),
        likeScore: artists.some((artist) => likedArtists.has(artist))
          ? likedSongs.some((liked) => areSameWaveSong(liked, song))
            ? 2
            : 1
          : 0,
        exposurePenalty: 0,
        versionPenalty,
        versionPriority,
      };
    });
  const matrix = createWaveSongMatrix(
    prepared.map((candidate) => candidate.song),
    recentSongs,
    offeredSongs,
  );
  for (const candidate of prepared) {
    const exposed = matrix
      ? matrix.wasOffered(candidate.matrixIndex)
      : offeredSongs.some((offered) => areSameWaveSong(offered, candidate.song));
    candidate.exposurePenalty =
      (exposed ? 8 : 0) +
      Math.min(
        4,
        offeredArtists.filter((keys) => keys.some((key) => candidate.artists.includes(key))).length,
      );
  }
  const candidates = prepared.filter(
    (candidate) =>
      !(matrix
        ? matrix.wasHeard(candidate.matrixIndex)
        : recentSongs.some((recent) => areSameWaveSong(recent, candidate.song))),
  );
  const sameSong = (left: (typeof prepared)[number], right: (typeof prepared)[number]) =>
    matrix
      ? matrix.sameSong(left.matrixIndex, right.matrixIndex)
      : areSameWaveSong(left.song, right.song);
  // Choose the ordinary version before artist spacing can promote its cover.
  const remaining = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) => other.versionPriority < candidate.versionPriority && sameSong(candidate, other),
      ),
  );
  const result: Track[] = [];
  const artistCounts = new Map<string, number>();
  const recent = (options.recentArtists || [])
    .slice(-40)
    .map((name) => getWaveArtistKeys({ artist: name }));
  if (options.recentTracks?.length) {
    recent.push(
      ...options.recentTracks.slice(-40).map((track) => getWaveArtistKeys(track, knownArtists)),
    );
  }
  for (const keys of recent.slice(-40))
    for (const artist of keys) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  const noveltyTarget = waveDiscoveryTarget(mood, options.discoveryAdjustment);
  const phase = mood === 'discover' ? 0.75 : 0;
  const offset = Number.isFinite(options.sequenceOffset)
    ? Math.max(0, Math.floor(options.sequenceOffset!))
    : 0;

  while (remaining.length > 0 && result.length < limit) {
    const previousSource = result[result.length - 1]?.source;
    const position = offset + result.length;
    const wantsFamiliar =
      Math.floor((position + 1) * noveltyTarget + phase + 1e-9) ===
      Math.floor(position * noveltyTarget + phase + 1e-9);
    let bestIndex = 0;
    let bestScore = -Infinity;

    const ranking: WaveRankingContext = {
      familiar,
      wantsFamiliar,
      recent,
      previousSource,
      previousMusic,
      mood,
      artistCounts,
      artistFeedback: options.artistFeedback,
    };
    for (let index = 0; index < remaining.length; index++) {
      const score = scoreWaveCandidate(remaining[index], index, ranking);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1);
    result.push(chosen.track);
    previousMusic = chosen.music;
    recent.push(chosen.artists);
    for (const artist of chosen.artists)
      artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    // Prefer the best version once; leave alternatives out of this batch entirely.
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (sameSong(chosen, remaining[index])) remaining.splice(index, 1);
    }
  }

  return result;
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
