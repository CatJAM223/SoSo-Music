import { requireRustCompute, waveMoodId } from '../compute/rustCore.ts';
import { waveMusicProfile } from './waveMusicProfile.ts';
import type { Track, WaveMood } from '../types/index.ts';
import { getWaveArtistNames, normalizeWaveArtist } from './waveIdentity.ts';

export type WavePlaybackReason = 'skip' | 'ended' | 'interrupted' | 'error';

/** Use measured listening, relative duration and why playback ended. */
export function getWavePlaybackFeedback(
  playedSeconds: number,
  durationSeconds: number,
  reason: WavePlaybackReason = 'skip',
  mood: WaveMood = 'default',
): number {
  if (
    !Number.isFinite(playedSeconds) ||
    playedSeconds < 2 ||
    reason === 'error' ||
    reason === 'interrupted'
  )
    return 0;
  const knownDuration = Number.isFinite(durationSeconds) && durationSeconds > 0;
  const fraction = knownDuration ? playedSeconds / durationSeconds : 0;
  if (knownDuration && fraction >= 0.95) return 0.35;
  if (knownDuration && fraction >= 0.8) return 0.2;
  if (reason === 'ended') return 0;
  const threshold = knownDuration ? Math.min(25, durationSeconds * 0.15) : 15;
  if (playedSeconds >= threshold) return 0;
  const immediate = knownDuration ? Math.min(10, durationSeconds * 0.05) : 5;
  const rejection = playedSeconds < immediate ? -0.6 : -0.35;
  return mood === 'discover' ? rejection * 0.5 : rejection;
}

/** The ratio is a ranking target, bounded to preserve the selected station's intent. */
export function waveDiscoveryTarget(mood: WaveMood, adjustment = 0): number {
  return requireRustCompute().wave_discovery_target(waveMoodId(mood), adjustment);
}

/** Session preferences fade so one reaction does not dominate the whole wave. */
export function decayWaveArtistFeedback(feedback: Map<string, number>): void {
  for (const [artist, value] of feedback) {
    if (!Number.isFinite(value)) {
      feedback.delete(artist);
      continue;
    }
    const decayed = Math.max(-2, Math.min(2, value)) * 0.92;
    if (Math.abs(decayed) < 0.05) feedback.delete(artist);
    else feedback.set(artist, decayed);
  }
}

/** Preserve several sides of the listener's taste instead of one artist's catalog. */
export function rememberPositiveWaveTrack(
  previous: readonly Track[],
  track: Track,
  limit = 12,
): Track[] {
  const capacity = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 12;
  if (!capacity) return [];
  const result: Track[] = [];
  const seenIds = new Set<string>();
  const artistCounts = new Map<string, number>();
  for (const candidate of [track, ...previous]) {
    const id = String(candidate.id);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const mainArtist = normalizeWaveArtist(
      getWaveArtistNames({ artist: candidate.artist })[0] || '',
    );
    if (mainArtist && (artistCounts.get(mainArtist) || 0) >= 2) continue;
    result.push(candidate);
    if (mainArtist) artistCounts.set(mainArtist, (artistCounts.get(mainArtist) || 0) + 1);
    if (result.length >= capacity) break;
  }
  return result;
}

/** A successful song reconciles one matching temporary skip, never the durable history. */
export function reconcileWavePositiveFeedback(skipped: readonly Track[], positive: Track): Track[] {
  const profile = waveMusicProfile(positive);
  const artists = getWaveArtistNames(positive).map(normalizeWaveArtist);
  let reconciled = false;
  return skipped.filter((track) => {
    if (String(track.id) === String(positive.id)) return false;
    if (reconciled) return true;
    const candidate = waveMusicProfile(track);
    if (profile.energy * candidate.energy < 0) return true;
    const sameStyle = [...profile.styles].some((style) => candidate.styles.has(style));
    const sameArtist = getWaveArtistNames(track).some((artist) =>
      artists.includes(normalizeWaveArtist(artist)),
    );
    if (!sameStyle && !sameArtist) return true;
    reconciled = true;
    return false;
  });
}
