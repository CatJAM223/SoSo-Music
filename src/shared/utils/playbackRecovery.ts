/**
 * Playback Recovery Action Decision Logic
 * Pure, deterministic logic for audio playback failure recovery
 */

export function shouldHaltPlaybackOnConsecutiveErrors(
  consecutiveErrors: number,
  maxThreshold = 5,
): boolean {
  return consecutiveErrors >= maxThreshold;
}

export function shouldRecordListeningStart(
  requestId: number,
  lastRecordedRequestId: number,
): boolean {
  return requestId !== lastRecordedRequestId;
}

export function isCurrentPlaybackRequest(
  expectedRequestId: number,
  currentRequestId: number,
  expectedTrackId?: string | number | null,
  currentTrackId?: string | number | null,
): boolean {
  if (expectedRequestId !== currentRequestId) return false;
  if (expectedTrackId === undefined || expectedTrackId === null) return true;
  return String(expectedTrackId) === String(currentTrackId);
}
