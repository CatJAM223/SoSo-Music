/** Select only two playable candidates without consuming the prepared shuffle order. */
export function prefetchQueueIndices(
  length: number,
  current: number,
  shuffle: readonly number[] | undefined,
  wrap: boolean,
  isPlayable: (index: number) => boolean,
): number[] {
  const result: number[] = [];
  if (shuffle) {
    for (const index of shuffle) {
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < length &&
        index !== current &&
        !result.includes(index) &&
        isPlayable(index)
      )
        result.push(index);
      if (result.length === 2) break;
    }
    return result;
  }
  // One bounded pass also handles queues where every remaining item is disabled.
  for (let offset = 1; offset <= length && result.length < 2; offset++) {
    let index = current + offset;
    if (wrap && length) index %= length;
    if (index < 0 || index >= length) break;
    if (index !== current && isPlayable(index)) result.push(index);
  }
  return result;
}
