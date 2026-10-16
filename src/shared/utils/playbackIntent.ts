let current: symbol = Symbol('initial playback intent');
/** Preparing a queue owns only its eventual commit, without stopping current audio. */
export function beginPlaybackIntent(): () => boolean {
  const token = Symbol('prepare playback');
  current = token;
  return () => current === token;
}
/** Playback controls supersede a queue still being read asynchronously. */
export function invalidatePlaybackIntent(): void {
  current = Symbol('playback control');
}
