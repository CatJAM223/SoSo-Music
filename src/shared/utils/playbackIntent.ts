let current: symbol = Symbol('initial playback intent');
let startedAt: number | undefined;
const preparedStarts = new WeakMap<object, number>();
/** Preparing a queue owns only its eventual commit, without stopping current audio. */
export function beginPlaybackIntent(): () => boolean {
  const token = Symbol('prepare playback');
  current = token;
  startedAt = performance.now();
  return () => current === token;
}
/** Playback controls supersede a queue still being read asynchronously. */
export function invalidatePlaybackIntent(): void {
  current = Symbol('playback control');
  startedAt = undefined;
}

/** Bind preparation timing only after its owner has validated and selected the actual track. */
export function markPreparedPlayback(track: object): void {
  if (startedAt !== undefined) preparedStarts.set(track, startedAt);
}

/** A direct selection must never inherit the time of an unrelated pending library read. */
export function takePlaybackIntentStart(track: object): number | undefined {
  const value = preparedStarts.get(track);
  preparedStarts.delete(track);
  return value;
}
