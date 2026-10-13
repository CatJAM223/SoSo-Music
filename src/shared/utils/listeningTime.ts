/** Count media progress only when it is consistent with elapsed playback time. */
export function playedMediaDelta(
  previousPosition: number,
  currentPosition: number,
  elapsedSeconds: number,
  playbackRate: number,
  isPlaying: boolean,
  isSeeking: boolean,
): number {
  const delta = currentPosition - previousPosition;
  if (!isPlaying || isSeeking || !Number.isFinite(delta) || delta <= 0) return 0;
  const allowed = Math.max(0, elapsedSeconds) * Math.max(1, playbackRate || 1) + 0.75;
  return delta <= allowed ? delta : 0;
}
