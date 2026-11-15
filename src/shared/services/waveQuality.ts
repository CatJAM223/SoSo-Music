import type { MusicSource, Track, WaveMood } from '../types/index.ts';
import {
  WAVE_METHODS,
  mergeWaveProvenance,
  readWaveProvenance,
  type WaveMethod,
  type WaveProvenance,
} from '../types/wavePolicy.ts';
import { recordingKey } from '../types/musicDomain.ts';
import { getWaveArtistKeys, normalizeWaveArtist } from '../utils/waveIdentity.ts';
import { getWavePlaybackFeedback, type WavePlaybackReason } from '../utils/waveFeedback.ts';
import { PlaybackLogger } from './playbackLogger.ts';

export interface WaveRecommendation {
  id: string;
  ranker: 'rust-sequence-v1' | 'rust-sequence-v2' | 'rust-sequence-v3';
  mood: WaveMood;
  rank: number;
  familiar: boolean;
  provenance?: WaveProvenance[];
  familiarity?: Track['waveFamiliarity'];
  selectedSource?: MusicSource;
  tasteRevision?: number;
  surface?: 'daily';
}
export function readWaveRecommendation(value: unknown): WaveRecommendation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    !r.id ||
    r.id.length > 512 ||
    !['rust-sequence-v1', 'rust-sequence-v2', 'rust-sequence-v3'].includes(String(r.ranker)) ||
    !['default', 'energy', 'chill', 'discover', 'mix', 'favorites'].includes(String(r.mood)) ||
    typeof r.rank !== 'number' ||
    !Number.isInteger(r.rank) ||
    r.rank < 0 ||
    r.rank > 4096 ||
    typeof r.familiar !== 'boolean'
  )
    return undefined;
  const provenance = Array.isArray(r.provenance)
    ? r.provenance
        .slice(0, 3)
        .map(readWaveProvenance)
        .filter((path) => path !== undefined)
    : [];
  const result: WaveRecommendation = {
    id: r.id,
    ranker: r.ranker as WaveRecommendation['ranker'],
    mood: r.mood as WaveMood,
    rank: r.rank,
    familiar: r.familiar,
  };
  if (provenance.length) result.provenance = mergeWaveProvenance(provenance);
  if (
    r.familiarity === 'heard' ||
    r.familiarity === 'unheard_known_artist' ||
    r.familiarity === 'unheard_new_artist'
  )
    result.familiarity = r.familiarity;
  if (
    r.selectedSource === 'all' ||
    r.selectedSource === 'youtube' ||
    r.selectedSource === 'soundcloud'
  )
    result.selectedSource = r.selectedSource;
  if (
    typeof r.tasteRevision === 'number' &&
    Number.isSafeInteger(r.tasteRevision) &&
    r.tasteRevision >= 0
  )
    result.tasteRevision = r.tasteRevision;
  if (r.surface === 'daily') result.surface = 'daily';
  return result;
}

export interface WaveQualityEvent {
  schema: 1;
  event: 'offered' | 'selected' | 'started' | 'outcome' | 'liked' | 'disliked';
  recommendationId: string;
  ranker: string;
  mood: WaveMood;
  recordingId: string;
  rank: number;
  familiar: boolean;
  familiarity?: Track['waveFamiliarity'];
  method?: WaveMethod;
  selectedSource?: MusicSource;
  tasteRevision?: number;
  surface?: 'daily';
  episodeId?: string;
  playedSeconds?: number;
  durationSeconds?: number;
  reason?: WavePlaybackReason;
}
type Write = (event: WaveQualityEvent) => void;
export const logWaveQuality: Write = (event) => PlaybackLogger.info('[Wave:Quality]', event);
let serial = 0;
export function attributeWaveBatch(
  tracks: Track[],
  mood: WaveMood,
  familiarArtists: readonly string[],
  emit: Write = logWaveQuality,
  positions?: readonly number[],
  context?: { source: MusicSource; revision: number; enabled: boolean; surface?: 'daily' },
): Track[] {
  const batch = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + ':' + ++serial;
  const familiar = new Set(familiarArtists.map(normalizeWaveArtist));
  return tracks.map((track, rank) => {
    if (track.waveRecommendation) return track;
    const recommendation = readWaveRecommendation({
      id: batch + ':' + rank,
      ranker: context?.enabled ? 'rust-sequence-v3' : 'rust-sequence-v2',
      mood,
      rank: positions?.[rank] ?? rank,
      familiar: track.waveFamiliarity
        ? track.waveFamiliarity !== 'unheard_new_artist'
        : getWaveArtistKeys(track).some((key) => familiar.has(key)),
      provenance: track.waveProvenance,
      familiarity: track.waveFamiliarity,
      selectedSource: context?.source,
      tasteRevision: context?.revision,
      surface: context?.surface,
    });
    if (!recommendation) return track;
    const attributed = { ...track, waveRecommendation: recommendation };
    emit(eventFor(attributed, 'offered'));
    return attributed;
  });
}
function eventFor(track: Track, event: WaveQualityEvent['event']): WaveQualityEvent {
  const r = track.waveRecommendation!;
  return {
    schema: 1,
    event,
    recommendationId: r.id,
    ranker: r.ranker as WaveRecommendation['ranker'],
    mood: r.mood,
    rank: r.rank,
    familiar: r.familiar,
    recordingId: recordingKey(track),
    ...(r.familiarity ? { familiarity: r.familiarity } : {}),
    ...(r.provenance?.length ? { method: r.provenance[0].method } : {}),
    ...(r.selectedSource ? { selectedSource: r.selectedSource } : {}),
    ...(r.tasteRevision !== undefined ? { tasteRevision: r.tasteRevision } : {}),
    ...(r.surface ? { surface: r.surface } : {}),
  };
}
export function markWaveLike(track: Track, emit: Write = logWaveQuality): void {
  if (track.waveRecommendation) emit(eventFor(track, 'liked'));
}
export function markWaveDislike(track: Track, emit: Write = logWaveQuality): void {
  if (track.waveRecommendation) emit(eventFor(track, 'disliked'));
}
/** One actual playback session, independent of source retries, pause and buffer recovery. */
export class WaveQualityEpisode {
  private began = false;
  private finished = false;
  private track: Track;
  private episodeId: string;
  private emit: Write;
  constructor(track: Track, episodeId: string, emit: Write = logWaveQuality) {
    this.track = track;
    this.episodeId = episodeId;
    this.emit = emit;
    this.send('selected');
  }
  private send(event: WaveQualityEvent['event'], extra: Partial<WaveQualityEvent> = {}): void {
    if (this.track.waveRecommendation)
      this.emit({ ...eventFor(this.track, event), episodeId: this.episodeId, ...extra });
  }
  started(): void {
    if (this.began || this.finished) return;
    this.began = true;
    this.send('started');
  }
  finish(playedSeconds: number, durationSeconds: number, reason: WavePlaybackReason): void {
    if (this.finished) return;
    this.finished = true;
    this.send('outcome', { playedSeconds, durationSeconds, reason });
  }
}
export function summarizeWaveQuality(events: readonly WaveQualityEvent[]) {
  const groups = new Map<string, WaveQualityEvent[]>();
  for (const event of events) {
    if (
      !event ||
      typeof event !== 'object' ||
      event.schema !== 1 ||
      typeof event.recommendationId !== 'string' ||
      !event.recommendationId ||
      !event.ranker ||
      !['default', 'energy', 'chill', 'discover', 'mix', 'favorites'].includes(event.mood) ||
      !event.recordingId
    )
      continue;
    const key = event.ranker + '/' + event.mood + (event.surface === 'daily' ? '/daily' : '');
    const group = groups.get(key) || [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups].map(([cohort, rows]) => {
    const offered = new Map<string, WaveQualityEvent>(),
      liked = new Set<string>();
    const episodes = new Map<
      string,
      { selected?: WaveQualityEvent; started?: WaveQualityEvent; outcome?: WaveQualityEvent }
    >();
    const methods = new Map<
      WaveMethod,
      { started: number; eligible: number; completions: number; earlySkips: number; liked: number }
    >();
    const familiarityStarts = { heard: 0, unheard_known_artist: 0, unheard_new_artist: 0 };
    const methodStats = (method?: WaveMethod) => {
      if (!method || !WAVE_METHODS.includes(method)) return;
      let stats = methods.get(method);
      if (!stats) {
        stats = { started: 0, eligible: 0, completions: 0, earlySkips: 0, liked: 0 };
        methods.set(method, stats);
      }
      return stats;
    };
    for (const event of rows) {
      if (event.event === 'offered') offered.set(event.recommendationId, event);
      if (event.event === 'liked' && !liked.has(event.recommendationId)) {
        liked.add(event.recommendationId);
        const stats = methodStats(event.method);
        if (stats) stats.liked++;
      }
      if (event.episodeId && ['selected', 'started', 'outcome'].includes(event.event)) {
        const episode = episodes.get(event.episodeId) || {};
        episode[event.event as 'selected' | 'started' | 'outcome'] ||= event;
        episodes.set(event.episodeId, episode);
      }
    }
    let started = 0,
      eligibleOutcomes = 0,
      earlySkips = 0,
      completions = 0,
      errors = 0,
      interrupted = 0,
      incomplete = 0,
      selectedWithoutStart = 0,
      novelStarts = 0;
    for (const episode of episodes.values()) {
      if (!episode.selected) continue; // Cropped logs cannot establish a complete episode.
      if (!episode.started) {
        selectedWithoutStart++;
        continue;
      }
      started++;
      const stats = methodStats(episode.selected.method);
      if (stats) stats.started++;
      const category = episode.selected.familiarity;
      if (
        category === 'heard' ||
        category === 'unheard_known_artist' ||
        category === 'unheard_new_artist'
      )
        familiarityStarts[category]++;
      if (!episode.selected.familiar) novelStarts++;
      const outcome = episode.outcome;
      if (
        !outcome ||
        outcome.recommendationId !== episode.selected.recommendationId ||
        !Number.isFinite(outcome.playedSeconds) ||
        outcome.playedSeconds! < 0 ||
        !['skip', 'ended', 'error', 'interrupted'].includes(outcome.reason || '')
      ) {
        incomplete++;
        continue;
      }
      if (outcome.reason === 'error') {
        errors++;
        continue;
      }
      if (outcome.reason === 'interrupted') {
        interrupted++;
        continue;
      }
      eligibleOutcomes++;
      const reaction = getWavePlaybackFeedback(
        outcome.playedSeconds!,
        outcome.durationSeconds || 0,
        outcome.reason,
        outcome.mood,
      );
      if (reaction < 0) earlySkips++;
      if (reaction > 0) completions++;
      if (stats) {
        stats.eligible++;
        if (reaction < 0) stats.earlySkips++;
        if (reaction > 0) stats.completions++;
      }
    }
    const recordingIds = new Set([...offered.values()].map((event) => event.recordingId));
    return {
      cohort,
      offered: offered.size,
      duplicateOffers: offered.size - recordingIds.size,
      selected: [...episodes.values()].filter((e) => e.selected).length,
      started,
      novelStarts,
      familiarityStarts,
      methods: Object.fromEntries(methods),
      selectedWithoutStart,
      eligibleOutcomes,
      earlySkips,
      completions,
      errors,
      interrupted,
      incomplete,
      liked: liked.size,
      earlySkipRate: eligibleOutcomes ? earlySkips / eligibleOutcomes : null,
      completionRate: eligibleOutcomes ? completions / eligibleOutcomes : null,
    };
  });
}
