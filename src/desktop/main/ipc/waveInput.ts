import { WAVE_HISTORY_LIMIT } from '../../../shared/utils/waveHistoryLimits.ts';

/** Check sizes before normalization, database reads or recommendation work. */
export function validateWaveContext(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid wave context');
  const context = value as Record<string, unknown>;
  const limits: Record<string, number> = {
    recentTracks: WAVE_HISTORY_LIMIT,
    offeredTracks: 80,
    tasteTracks: 54,
    positiveTracks: 12,
    skippedTracks: 12,
    learnedTracks: 48,
  };
  for (const [key, limit] of Object.entries(limits)) {
    const list = context[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > limit)
      throw new TypeError('Invalid wave context: ' + key);
    validateWaveSeeds(list);
  }
  const feedback = context.artistFeedback;
  if (feedback !== undefined) {
    if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback))
      throw new TypeError('Invalid wave feedback');
    let count = 0;
    for (const key in feedback) {
      if (!Object.prototype.hasOwnProperty.call(feedback, key)) continue;
      if (
        ++count > 100 ||
        key.length > 500 ||
        !Number.isFinite((feedback as Record<string, unknown>)[key])
      )
        throw new TypeError('Invalid wave feedback');
    }
  }
}
export function validateWaveSeeds(tracks: unknown[]): void {
  for (const value of tracks) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Invalid wave track');
    const track = value as Record<string, any>;
    for (const key of ['title', 'genre', 'recordingId']) {
      if (
        track[key] !== undefined &&
        (typeof track[key] !== 'string' || track[key].length > (key === 'recordingId' ? 1024 : 512))
      )
        throw new TypeError('Invalid wave track');
    }
    const name = typeof track.artist === 'string' ? track.artist : track.artist?.name;
    if (name !== undefined && (typeof name !== 'string' || name.length > 512))
      throw new TypeError('Invalid wave artist');
    if (
      track.tags !== undefined &&
      (!Array.isArray(track.tags) ||
        track.tags.length > 16 ||
        track.tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > 80))
    )
      throw new TypeError('Invalid wave tags');
  }
}
