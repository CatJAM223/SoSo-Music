import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

/** Own delayed recovery for one player; invalidate its async replies on teardown. */
export function usePlaybackTaskScope(
  requestIdRef: MutableRefObject<number>,
  loadIdRef: MutableRefObject<number>,
) {
  const playbackAbortRef = useRef(new AbortController());
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledRecovery = useCallback(() => {
    if (recoveryTimerRef.current !== null) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
  }, []);
  const invalidatePlayback = useCallback(() => {
    requestIdRef.current++;
    loadIdRef.current++;
    playbackAbortRef.current.abort();
    playbackAbortRef.current = new AbortController();
    cancelScheduledRecovery();
  }, [requestIdRef, loadIdRef, cancelScheduledRecovery]);
  const schedulePlaybackRecovery = useCallback(
    (requestId: number, recover: () => void) => {
      cancelScheduledRecovery();
      recoveryTimerRef.current = setTimeout(() => {
        recoveryTimerRef.current = null;
        if (requestId === requestIdRef.current) recover();
      }, 300);
    },
    [requestIdRef, cancelScheduledRecovery],
  );

  useEffect(() => () => invalidatePlayback(), [invalidatePlayback]);
  return {
    cancelScheduledRecovery,
    invalidatePlayback,
    schedulePlaybackRecovery,
    playbackAbortRef,
  };
}
