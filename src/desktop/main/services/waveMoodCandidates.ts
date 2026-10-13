import type { Track, WaveMood } from '../../../shared/types/index.ts';
import {
  getWaveArtistNames,
  getWaveArtistKeys,
  matchesWaveArtist,
  normalizeWaveArtist,
} from '../../../shared/utils/waveIdentity.ts';
import { selectWaveMoodSeeds } from '../../../shared/utils/waveRecommendations.ts';
import { waveMoodScore, waveMusicProfile } from '../../../shared/utils/waveMusicProfile.ts';
import {
  CURATED_WAVE_FALLBACK_QUERIES,
  getCuratedWaveArtist,
} from '../../../shared/utils/waveQueue.ts';
import { mapConcurrentSettled, shuffled } from '../../../shared/utils/concurrentTasks.ts';
import type { WaveCatalog } from './waveCatalog.ts';
import type { WaveCandidatePool } from './waveCandidatePool.ts';

const SEARCH_CONCURRENCY = 3;
const MOOD_ARTIST_LIMIT = 5;
const EMPTY_MOOD_QUERY_LIMIT = 3;
const ENERGY_QUERIES = [
  'zxcursed phonk',
  'Interworld METAMORPHOSIS',
  'DVRST Close Eyes',
  'Kordhell Murder In My Mind',
  'Nirvana',
  'Гражданская Оборона',
  'cupsize кислота',
  'shadowraze',
];
const CHILL_QUERIES = [
  'Øneheart snowfall',
  'leadwave memories',
  'antent your eyes',
  'reidenshi lost memory',
  'my head is empty',
  'Валентин Стрыкало акустика',
  'Where Is My Mind acoustic',
  'ambient driftwave',
];
const MIX_QUERIES = ['rock classics', 'indie alternative', 'drift phonk', 'russian post punk'];
const DISCOVERY_QUERIES = [
  'russian post punk indie',
  'dark indie rock alt',
  'underground wave phonk',
  'ambient lofi gems',
  'emo rock alt indie',
];

export interface WaveMoodCandidates {
  mood: WaveMood;
  seeds: Track[];
  artists: string[];
  hasTaste: boolean;
  exposedTracks?: readonly Track[];
  pool: WaveCandidatePool;
  catalog: WaveCatalog;
  rotate: (artists: string[]) => string[];
}

type ArtistReplies = Awaited<ReturnType<typeof fetchArtists>>;

/** Look past familiar top hits as a personal catalog is gradually heard or offered. */
function artistSearchLimit(options: WaveMoodCandidates, artist: string, limit: number): number {
  const exposed = new Set(
    (options.exposedTracks || [])
      .filter((track) => matchesWaveArtist(track, artist))
      .map((track) => String(track.id)),
  ).size;
  return Math.min(40, limit + exposed * 2);
}

async function fetchArtists(options: WaveMoodCandidates, artists: string[], limit: number) {
  return mapConcurrentSettled(
    artists,
    (artist) =>
      Promise.allSettled([
        options.catalog.soundcloud(artist, artistSearchLimit(options, artist, limit)),
        options.catalog.youtube(artist, artistSearchLimit(options, artist, limit)),
      ]),
    SEARCH_CONCURRENCY,
  );
}

/** Keep per-provider song limits and provider order independently of response timing. */
function acceptArtistReplies(
  options: WaveMoodCandidates,
  artists: string[],
  replies: ArtistReplies,
  limit: number,
): void {
  replies.forEach((reply, index) => {
    if (reply.status !== 'fulfilled') return;
    for (const provider of reply.value) {
      if (provider.status === 'fulfilled')
        options.pool.addRanked(provider.value.data || [], limit, artists[index]);
    }
  });
}

async function searchArtists(
  options: WaveMoodCandidates,
  artists: string[],
  requested: number,
  accepted: number,
): Promise<void> {
  acceptArtistReplies(options, artists, await fetchArtists(options, artists, requested), accepted);
}

async function searchCombinedArtists(
  options: WaveMoodCandidates,
  artists: string[],
): Promise<void> {
  const replies = await mapConcurrentSettled(
    artists,
    async (artist) => {
      const query = artist + (options.mood === 'energy' ? ' energetic' : ' chill');
      const limit = artistSearchLimit(options, artist, 10);
      const reply = await options.catalog.both(query, limit).catch(() => ({ data: [] }));
      // A small catalog may not support qualified searches. Keep personal music available.
      if (
        !reply.data?.some(
          (track) =>
            !track.playbackUnavailable &&
            matchesWaveArtist(track, artist) &&
            waveMoodScore(waveMusicProfile(track), options.mood) >= 0,
        )
      )
        return options.catalog.both(artist, limit);
      return reply;
    },
    SEARCH_CONCURRENCY,
  );
  replies.forEach((reply, index) => {
    if (reply.status === 'fulfilled')
      options.pool.addRanked(
        [...(reply.value.data || [])].sort(
          (left, right) =>
            waveMoodScore(waveMusicProfile(right), options.mood) -
            waveMoodScore(waveMusicProfile(left), options.mood),
        ),
        3,
        artists[index],
      );
  });
}

async function similarNames(
  options: WaveMoodCandidates,
  artists: string[],
  limit: number,
  isKnown: (name: string) => boolean,
): Promise<string[]> {
  const replies = await Promise.allSettled(
    artists.map(async (artist) => {
      try {
        return ((await options.catalog.similar(artist, limit)) || [])
          .map((item) => item.name)
          .filter(Boolean);
      } catch {
        return [];
      }
    }),
  );
  const names: string[] = [];
  for (const reply of replies) {
    if (reply.status !== 'fulfilled') continue;
    for (const name of reply.value) if (!isKnown(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

async function fillMix(options: WaveMoodCandidates): Promise<void> {
  if (options.hasTaste)
    return searchArtists(options, options.rotate(options.artists).slice(0, 7), 10, 3);
  const replies = await Promise.allSettled(
    MIX_QUERIES.map((query) => options.catalog.fallback(query, 10)),
  );
  for (const reply of replies)
    if (reply.status === 'fulfilled') reply.value.data?.forEach((track) => options.pool.add(track));
}

async function fillEnergyOrChill(options: WaveMoodCandidates): Promise<void> {
  const moodArtists = selectWaveMoodSeeds(options.seeds, options.mood).flatMap(getWaveArtistNames);
  const artists = options
    .rotate(moodArtists.length ? [...new Set(moodArtists)] : options.artists)
    .slice(0, MOOD_ARTIST_LIMIT);
  const queries = options.hasTaste
    ? []
    : shuffled(options.mood === 'energy' ? ENERGY_QUERIES : CHILL_QUERIES).slice(
        0,
        EMPTY_MOOD_QUERY_LIMIT,
      );
  const [, replies] = await Promise.all([
    searchCombinedArtists(options, artists),
    mapConcurrentSettled(queries, (query) => options.catalog.both(query, 8), SEARCH_CONCURRENCY),
  ]);
  for (const reply of replies)
    if (reply.status === 'fulfilled') options.pool.addRanked(reply.value.data || [], 3);
}

async function fillDiscover(options: WaveMoodCandidates): Promise<void> {
  const known = new Set(options.artists.map(normalizeWaveArtist));
  const anchors = options.rotate(options.artists).slice(0, 5);
  const similar = await similarNames(options, anchors, 5, (name) =>
    known.has(normalizeWaveArtist(name)),
  );
  const targets = similar.length ? shuffled(similar).slice(0, 4) : anchors;
  const replies = await mapConcurrentSettled(
    targets,
    (artist) => options.catalog.both(similar.length ? artist : artist + ' similar', 12),
    SEARCH_CONCURRENCY,
  );
  replies.forEach((reply, index) => {
    if (reply.status !== 'fulfilled') return;
    for (const track of reply.value.data || []) {
      if (similar.length && !matchesWaveArtist(track, targets[index])) continue;
      const artists = getWaveArtistKeys(track, options.artists);
      if (artists.length && !artists.some((artist) => known.has(artist))) options.pool.add(track);
    }
  });
  if (options.pool.size >= 15 || options.hasTaste) return;
  const fallback = await mapConcurrentSettled(
    shuffled(DISCOVERY_QUERIES).slice(0, 3),
    (query) => options.catalog.fallback(query, 10),
    SEARCH_CONCURRENCY,
  );
  for (const reply of fallback)
    if (reply.status === 'fulfilled') reply.value.data?.forEach((track) => options.pool.add(track));
}

async function fillArtistRadio(options: WaveMoodCandidates): Promise<void> {
  if (options.pool.size >= 20) return;
  const artists = options.rotate(options.artists).slice(0, 3);
  const replies = await Promise.allSettled(
    artists.map((artist) => options.catalog.fallback(artist + ' radio', 8)),
  );
  replies.forEach((reply, index) => {
    if (reply.status === 'fulfilled')
      options.pool.addRanked(reply.value.data || [], 3, artists[index]);
  });
}

async function fillFlow(options: WaveMoodCandidates): Promise<void> {
  if (!options.hasTaste) return fillEmptyWaveCandidates(options);
  const artists = options.rotate(options.artists).slice(0, 8);
  const nearby = await similarNames(options, artists.slice(0, 3), 4, (name) =>
    options.artists.some((known) => known.toLowerCase() === name.toLowerCase()),
  );
  const discovery = shuffled(nearby).slice(0, 3);
  const [familiarReplies, discoveryReplies] = await Promise.all([
    fetchArtists(options, artists, 10),
    fetchArtists(options, discovery, 8),
  ]);
  acceptArtistReplies(options, artists, familiarReplies, 2);
  acceptArtistReplies(options, discovery, discoveryReplies, 2);
  await fillArtistRadio(options);
}

export async function fillEmptyWaveCandidates(options: WaveMoodCandidates): Promise<void> {
  const queries = shuffled(CURATED_WAVE_FALLBACK_QUERIES).slice(0, 6);
  const replies = await Promise.allSettled(
    queries.map((query) => options.catalog.fallback(query, 8)),
  );
  replies.forEach((reply, index) => {
    if (reply.status === 'fulfilled')
      options.pool.addRanked(reply.value.data || [], 3, getCuratedWaveArtist(queries[index]));
  });
}

export async function fillWaveMoodCandidates(options: WaveMoodCandidates): Promise<void> {
  if (options.mood === 'mix' || options.mood === 'favorites') return fillMix(options);
  if (options.mood === 'energy' || options.mood === 'chill') return fillEnergyOrChill(options);
  if (options.mood === 'discover') return fillDiscover(options);
  return fillFlow(options);
}
