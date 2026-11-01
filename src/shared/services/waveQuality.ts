import type { Track, WaveMood } from '../types/index.ts';
import { recordingKey } from '../types/musicDomain.ts';
import { getWaveArtistKeys, normalizeWaveArtist } from '../utils/waveIdentity.ts';
import { getWavePlaybackFeedback, type WavePlaybackReason } from '../utils/waveFeedback.ts';
import { PlaybackLogger } from './playbackLogger.ts';

export interface WaveRecommendation {
  id: string;
  ranker: 'rust-sequence-v1' | 'rust-sequence-v2';
  mood: WaveMood;
  rank: number;
  familiar: boolean;
}
export function readWaveRecommendation(value: unknown): WaveRecommendation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    !r.id ||
    r.id.length > 512 ||
    !['rust-sequence-v1', 'rust-sequence-v2'].includes(String(r.ranker)) ||
    !['default', 'energy', 'chill', 'discover', 'mix', 'favorites'].includes(String(r.mood)) ||
    typeof r.rank !== 'number' ||
    !Number.isInteger(r.rank) ||
    r.rank < 0 ||
    r.rank > 4096 ||
    typeof r.familiar !== 'boolean'
  )
    return undefined;
  return {
    id: r.id,
    ranker: r.ranker as WaveRecommendation['ranker'],
    mood: r.mood as WaveMood,
    rank: r.rank,
    familiar: r.familiar,
  };
}

export interface WaveQualityEvent {
  schema: 1;
  event: 'offered' | 'selected' | 'started' | 'outcome' | 'liked';
  recommendationId: string;
  ranker: string;
  mood: WaveMood;
  recordingId: string;
  rank: number;
  familiar: boolean;
  episodeId?: string;
  playedSeconds?: number;
  durationSeconds?: number;
  reason?: WavePlaybackReason;
}
type Write = (event: WaveQualityEvent) => void;
const write: Write = (event) => PlaybackLogger.info('[Wave:Quality]', event);
let serial = 0;
export function attributeWaveBatch(
  tracks: Track[],
  mood: WaveMood,
  familiarArtists: readonly string[],
  emit: Write = write,
  positions?: readonly number[],
): Track[] {
  const batch = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + ':' + ++serial;
  const familiar = new Set(familiarArtists.map(normalizeWaveArtist));
  return tracks.map((track, rank) => {
    if (track.waveRecommendation) return track;
    const recommendation: WaveRecommendation = {
      id: batch + ':' + rank,
      ranker: 'rust-sequence-v2',
      mood,
      rank: positions?.[rank] ?? rank,
      familiar: getWaveArtistKeys(track).some((key) => familiar.has(key)),
    };
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
  };
}
export function markWaveLike(track: Track, emit: Write = write): void {
  if (track.waveRecommendation) emit(eventFor(track, 'liked'));
}
/** One actual playback session, independent of source retries, pause and buffer recovery. */
export class WaveQualityEpisode {
  private began = false;
  private finished = false;
  private track: Track;
  private episodeId: string;
  private emit: Write;
  constructor(track: Track, episodeId: string, emit: Write = write) {
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
    const key = event.ranker + '/' + event.mood;
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
    for (const event of rows) {
      if (event.event === 'offered') offered.set(event.recommendationId, event);
      if (event.event === 'liked') liked.add(event.recommendationId);
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
    }
    const recordingIds = new Set([...offered.values()].map((event) => event.recordingId));
    return {
      cohort,
      offered: offered.size,
      duplicateOffers: offered.size - recordingIds.size,
      selected: [...episodes.values()].filter((e) => e.selected).length,
      started,
      novelStarts,
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
