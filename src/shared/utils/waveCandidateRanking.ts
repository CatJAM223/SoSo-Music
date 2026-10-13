import type { Track, WaveMood } from '../types/index.ts';
import { waveTransitionScore, type WaveMusicProfile } from './waveMusicProfile.ts';

const ARTIST_DISTANCE_PENALTIES = [48, 40, 32, 24, 18, 12, 8, 4];
const RECENT_ARTIST_WINDOW = 12;
const REPEATED_ARTIST_PENALTY = 24;
const TOTAL_ARTIST_PENALTY = 6;
const MATCHED_DISCOVERY_BONUS = 4;
const FAMILIAR_ARTIST_BONUS = 0.5;
const RADIO_BONUS = 1.5;
const FEEDBACK_LIMIT = 3;
const FEEDBACK_WEIGHT = 4;
const SOURCE_VARIETY_BONUS = 0.5;
const ALBUM_BONUS = 0.4;
const REGULAR_DURATION_BONUS = 0.3;
const NON_SONG_PENALTY = 5;
const PROVIDER_ORDER_WEIGHT = 0.001;

interface RankedCandidate {
  track: Track;
  artists: string[];
  music: WaveMusicProfile;
  musicScore: number;
  likeScore: number;
  exposurePenalty: number;
  versionPenalty: number;
}
export interface WaveRankingContext {
  familiar: ReadonlySet<string>;
  wantsFamiliar: boolean;
  mood: WaveMood;
  recent: readonly string[][];
  artistCounts: ReadonlyMap<string, number>;
  artistFeedback?: ReadonlyMap<string, number>;
  previousSource?: Track['source'];
  previousMusic?: WaveMusicProfile;
}

function artistSpacingPenalties(
  artists: readonly string[],
  context: WaveRankingContext,
): { distance: number; density: number } {
  const recentArtists = context.recent.slice(-ARTIST_DISTANCE_PENALTIES.length);
  const overlaps = (keys: readonly string[]) => keys.some((artist) => artists.includes(artist));
  const lastIndex = recentArtists.map(overlaps).lastIndexOf(true);
  const distance =
    lastIndex >= 0 ? ARTIST_DISTANCE_PENALTIES[recentArtists.length - 1 - lastIndex] || 0 : 0;
  const count = context.recent.slice(-RECENT_ARTIST_WINDOW).filter(overlaps).length;
  return { distance, density: count >= 2 ? (count - 1) * REPEATED_ARTIST_PENALTY : 0 };
}

function feedbackScore(artists: readonly string[], feedback?: ReadonlyMap<string, number>): number {
  const values = artists.map((artist) => feedback?.get(artist) || 0);
  return (
    Math.max(
      -FEEDBACK_LIMIT,
      Math.min(FEEDBACK_LIMIT, Math.min(0, ...values) || Math.max(0, ...values)),
    ) * FEEDBACK_WEIGHT
  );
}

export function scoreWaveCandidate(
  candidate: RankedCandidate,
  index: number,
  context: WaveRankingContext,
): number {
  const { track, artists, music, musicScore, likeScore, exposurePenalty, versionPenalty } =
    candidate;
  const known = artists.some((artist) => context.familiar.has(artist));
  const discoveryBonus =
    context.mood === 'discover' ? 12 : context.mood === 'mix' ? 8 : MATCHED_DISCOVERY_BONUS;
  let score = known === context.wantsFamiliar ? discoveryBonus : 0;
  score += known ? FAMILIAR_ARTIST_BONUS : 0;
  score -= exposurePenalty;
  score += likeScore + musicScore + waveTransitionScore(music, context.previousMusic, context.mood);
  if (Number.isFinite(track.waveRadioScore))
    score += Math.max(0, Math.min(1, track.waveRadioScore!)) * RADIO_BONUS;
  score += feedbackScore(artists, context.artistFeedback);
  const spacing = artistSpacingPenalties(artists, context);
  score -= spacing.distance;
  score -= spacing.density;
  score -=
    Math.max(0, ...artists.map((artist) => context.artistCounts.get(artist) || 0)) *
    TOTAL_ARTIST_PENALTY;
  if (context.previousSource && track.source && track.source !== context.previousSource)
    score += SOURCE_VARIETY_BONUS;
  if (track.album?.title && track.album.title !== 'Single') score += ALBUM_BONUS;
  if (track.duration >= 150 && track.duration <= 360) score += REGULAR_DURATION_BONUS;
  score -= versionPenalty;
  if (
    /\b(karaoke|type beat|fan.?made|reaction|podcast)\b|караоке|минусовка/i.test(track.title || '')
  )
    score -= NON_SONG_PENALTY;
  return score - index * PROVIDER_ORDER_WEIGHT;
}
