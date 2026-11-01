import type { ValueRef } from './playbackEngine';
export function createPlaybackTaskScope(
  requestIdRef: ValueRef<number>,
  loadIdRef: ValueRef<number>,
) {
  const playbackAbortRef = { current: new AbortController() };
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelScheduledRecovery = () => {
    if (recoveryTimer !== null) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };
  const invalidatePlayback = () => {
    requestIdRef.current++;
    loadIdRef.current++;
    playbackAbortRef.current.abort();
    playbackAbortRef.current = new AbortController();
    cancelScheduledRecovery();
  };
  const schedulePlaybackRecovery = (requestId: number, recover: () => void) => {
    cancelScheduledRecovery();
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (requestId === requestIdRef.current) recover();
    }, 300);
  };
  return {
    cancelScheduledRecovery,
    invalidatePlayback,
    schedulePlaybackRecovery,
    playbackAbortRef,
  };
}
