/** Queue positions stay stable: the UI maps playback order back to the actual queue. */
export function upcomingQueueIndices(
  length: number,
  current: number,
  shuffle?: readonly number[],
  wrap = false,
): number[] {
  if (shuffle)
    return [...new Set(shuffle)].filter(
      (index) => Number.isInteger(index) && index >= 0 && index < length && index !== current,
    );
  const result = Array.from(
    { length: Math.max(0, length - current - 1) },
    (_, offset) => current + 1 + offset,
  );
  if (wrap && length > 1)
    for (let index = 0; index < current && index < length; index++) result.push(index);
  return result;
}
