import { libraryGenreAffinity } from '../../../shared/utils/libraryTaste.ts';
import { waveMusicProfile } from '../../../shared/utils/waveMusicProfile.ts';
import type { LibraryTasteService } from './libraryTaste.ts';
import type { Track, WaveBatchContext, WaveMood } from '../../../shared/types/index.ts';
import { WaveRequestScheduler } from '../../../shared/services/waveRequestScheduler.ts';
import { gatherWaveDiscovery } from '../../../shared/services/waveDiscovery.ts';
import { waveMemoryTrack } from '../../../shared/services/waveMemory.ts';
import { mapConcurrentSettled, shuffled } from '../../../shared/utils/concurrentTasks.ts';
import { waveTasteArtistWeights } from '../../../shared/utils/waveTaste.ts';
import {
  selectWaveMoodSeeds,
  waveQueueContext,
} from '../../../shared/utils/waveRecommendations.ts';
import {
  buildWaveSongIdentity,
  getWaveArtistKeys,
  getWaveArtistNames,
  type WaveSongIdentity,
} from '../../../shared/utils/waveIdentity.ts';
import {
  CURATED_WAVE_FALLBACK_QUERIES,
  spreadWaveSeedArtists,
  isWaveGarbageRemix,
  isWaveMixOrPodcast,
  sequenceWaveTracks,
  type DislikedWaveTrack,
} from '../../../shared/utils/waveQueue.ts';
import { WaveCandidatePool } from './waveCandidatePool.ts';
import { createWaveCatalog } from './waveCatalog.ts';
import { includeWaveGenreDiscovery } from './waveGenreDiscovery.ts';
import {
  fillWaveMoodCandidates,
  fillEmptyWaveCandidates,
  type WaveMoodCandidates,
} from './waveMoodCandidates.ts';

export type { WaveMood } from '../../../shared/types/index.ts';
export const SUPPORTED_WAVE_MOODS: WaveMood[] = [
  'default',
  'energy',
  'chill',
  'discover',
  'mix',
  'favorites',
];
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_LIMIT = 800;
const OFFERED_LIMIT = 80;
const RELATED_ANCHOR_LIMIT = 24;
const BATCH_SIZE = 25;
const waveRequests = new WaveRequestScheduler();
interface SessionPrint {
  track: Track;
  song: WaveSongIdentity;
  at: number;
}

function familiarArtistNames(
  seeds: readonly Track[],
  followed: readonly { name: string }[],
): string[] {
  const names = [
    ...seeds.flatMap(getWaveArtistNames),
    ...followed.flatMap((artist) => getWaveArtistNames(artist.name)),
  ];
  const unique = new Map<string, string>();
  for (const name of names)
    if (!unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  return [...unique.values()];
}

export class WaveEngine {
  private static tasteProvider?: LibraryTasteService;
  public static setTasteProvider(provider?: LibraryTasteService): void {
    this.tasteProvider = provider;
  }
  private static sessionPrints: SessionPrint[] = [];
  private static relatedAnchorIds: string[] = [];
  public static readonly CURATED_FALLBACK_QUERIES = CURATED_WAVE_FALLBACK_QUERIES;
  public static readonly mapConcurrent = mapConcurrentSettled;
  public static readonly isMixOrPodcast = isWaveMixOrPodcast;
  public static readonly isGarbageRemix = isWaveGarbageRemix;

  private static pruneSessionPrints(): void {
    const oldest = Date.now() - SESSION_TTL_MS;
    this.sessionPrints = this.sessionPrints
      .filter((entry) => entry.at >= oldest)
      .slice(-SESSION_LIMIT);
  }

  public static filterWaveTracks(tracks: Track[], excludeIds: (string | number)[]): Track[] {
    const excluded = new Set(excludeIds.map(String)),
      unique = new Map<string, Track>();
    for (const track of tracks) {
      if (!track?.id || excluded.has(String(track.id)) || unique.has(String(track.id))) continue;
      unique.set(String(track.id), track);
    }
    return [...unique.values()];
  }

  private static includeLikes(options: WaveMoodCandidates): void {
    if (!['default', 'mix', 'favorites'].includes(options.mood)) return;
    const selectedArtists = new Set<string>();
    let included = 0;
    for (const track of shuffled(options.seeds.filter((seed) => seed.waveSeedWeight === 2))) {
      const artists = getWaveArtistKeys(track, options.artists);
      if (artists.some((artist) => selectedArtists.has(artist))) continue;
      if (options.pool.add({ ...track, artist: { ...track.artist }, album: { ...track.album } })) {
        artists.forEach((artist) => selectedArtists.add(artist));
        included++;
      }
      if (included >= (options.mood === 'favorites' ? 8 : 4)) break;
    }
  }

  private static async includeRelated(
    options: WaveMoodCandidates,
    context: WaveBatchContext,
    remember: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!options.hasTaste || options.mood === 'favorites') return;
    const discover = options.mood === 'discover';
    const result = await gatherWaveDiscovery(
      selectWaveMoodSeeds(options.seeds, options.mood),
      context,
      {
        familiarArtists: options.artists,
        allowExpansion: discover,
        perRadio: discover ? 6 : 3,
        maxRadioPosition:
          discover || context.recentTracks?.length || context.offeredTracks?.length ? 20 : 5,
        recentAnchorIds: remember ? this.relatedAnchorIds : [],
        related: options.catalog.related,
        accept: (track) => options.pool.add(track),
      },
    );
    signal?.throwIfAborted();
    if (remember)
      this.relatedAnchorIds = [...this.relatedAnchorIds, ...result.usedAnchors].slice(
        -RELATED_ANCHOR_LIMIT,
      );
  }

  private static async fillCandidates(
    options: WaveMoodCandidates,
    remember: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await fillWaveMoodCandidates(options);
    } catch (error) {
      signal?.throwIfAborted();
      console.error('[WaveEngine] Error generating wave batch:', error);
    }
    if (options.pool.size || options.hasTaste || !remember || signal?.aborted) return;
    try {
      await fillEmptyWaveCandidates(options);
    } catch (error) {
      console.debug('[WaveEngine] Emergency fallback error:', error);
    }
  }

  private static rankBatch(
    options: WaveMoodCandidates,
    context: WaveBatchContext,
    offeredTracks: Track[],
    remember: boolean,
    candidates: Track[] = options.pool.values(),
  ): Track[] {
    const seeds = options.seeds;
    const genres = this.tasteProvider?.report().genres;
    const rankingContext = {
      ...context,
      offeredTracks,
      positiveTracks: context.positiveTracks,
      skippedTracks: context.skippedTracks,
    };
    const result = sequenceWaveTracks(candidates, options.mood, options.artists, BATCH_SIZE, {
      ...waveQueueContext(rankingContext),
      tasteTracks: seeds,
      libraryGenres: genres,
    });
    if (remember) {
      for (const track of result) {
        const metadata = waveMemoryTrack(track);
        if (metadata)
          this.sessionPrints.push({
            track: metadata,
            song: buildWaveSongIdentity(track, options.artists),
            at: Date.now(),
          });
      }
      this.pruneSessionPrints();
    }
    return genres
      ? result.map((track) => ({
          ...track,
          waveGenreScore: libraryGenreAffinity(waveMusicProfile(track).styles, genres),
        }))
      : result;
  }

  public static async getWaveBatch(
    mood: WaveMood = 'default',
    seedTracks: Track[] = [],
    excludeIds: (string | number)[] = [],
    followedArtists: { id?: string | number; name: string }[] = [],
    dislikedTracks: DislikedWaveTrack[] = [],
    context: WaveBatchContext = {},
    rememberSession = true,
    signal?: AbortSignal,
  ): Promise<Track[]> {
    const request = waveRequests.createBatch(signal);
    try {
      signal?.throwIfAborted();
      if (rememberSession) this.pruneSessionPrints();
      if (this.tasteProvider) {
        seedTracks = this.tasteProvider.enrichCached(seedTracks);
        context = {
          ...context,
          positiveTracks: this.tasteProvider.enrichCached(context.positiveTracks || []),
          skippedTracks: this.tasteProvider.enrichCached(context.skippedTracks || []),
          learnedTracks: this.tasteProvider.enrichCached(context.learnedTracks || []),
        };
      }
      const history = rememberSession ? this.sessionPrints : [];
      const artists = familiarArtistNames(seedTracks, followedArtists);
      const pool = new WaveCandidatePool({
        mood,
        source: context.source,
        excluded: excludeIds,
        disliked: dislikedTracks,
        familiarArtists: artists,
        heard: context.recentTracks || [],
      });
      const offered = [
        ...new Map(
          [
            ...(context.offeredTracks || []),
            ...history.slice(-OFFERED_LIMIT).map((entry) => entry.track),
          ].map((track) => [String(track.id), track]),
        ).values(),
      ].slice(-OFFERED_LIMIT);
      const exposedTracks = [
        ...new Map(
          [...(context.recentTracks || []), ...offered].map((track) => [String(track.id), track]),
        ).values(),
      ];
      const weights = waveTasteArtistWeights(seedTracks);
      const options: WaveMoodCandidates = {
        mood,
        seeds: seedTracks,
        artists,
        pool,
        exposedTracks,
        hasTaste: artists.length > 0 || seedTracks.length > 0,
        catalog: createWaveCatalog(request, context.source),
        rotate: (names) =>
          spreadWaveSeedArtists(
            shuffled(names),
            exposedTracks.map((track) => getWaveArtistKeys(track, artists)),
            weights,
          ),
      };
      this.includeLikes(options);
      await this.includeRelated(options, context, rememberSession, signal);
      await Promise.all([
        this.fillCandidates(options, rememberSession, signal),
        includeWaveGenreDiscovery(
          options,
          this.tasteProvider?.report().genres || [],
          context.recentTracks,
          signal,
        ),
      ]);
      signal?.throwIfAborted();
      const candidates = this.tasteProvider
        ? await this.tasteProvider.enrichCandidates(pool.values(), signal)
        : pool.values();
      signal?.throwIfAborted();
      return this.rankBatch(options, context, offered, rememberSession, candidates);
    } finally {
      request.dispose();
    }
  }
}
