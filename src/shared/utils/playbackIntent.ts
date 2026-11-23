let current: symbol = Symbol('initial playback intent');
let startedAt: number | undefined;
let cancelPreparation: (() => void) | undefined;
const preparedStarts = new WeakMap<object, number>();

function replaceIntent(token: symbol, start?: number, onSuperseded?: () => void): void {
  const previous = cancelPreparation;
  current = token;
  startedAt = start;
  cancelPreparation = onSuperseded;
  previous?.();
}

/** Preparing a queue owns only its eventual commit, without stopping current audio. */
export function beginPlaybackIntent(onSuperseded?: () => void): () => boolean {
  const token = Symbol('prepare playback');
  replaceIntent(token, performance.now(), onSuperseded);
  return () => current === token;
}
/** Playback controls supersede a queue still being read asynchronously. */
export function invalidatePlaybackIntent(): void {
  replaceIntent(Symbol('playback control'));
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
