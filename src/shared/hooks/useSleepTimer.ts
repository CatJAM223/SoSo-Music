import { useState, useRef, useEffect, useCallback } from 'react';
import { emitToast } from '../context/ToastContext';

export type SleepTimerMode = 'off' | '15' | '30' | '45' | '60' | 'end_of_track';

interface UseSleepTimerProps {
  onTimerExpire: () => void;
}

export function useSleepTimer({ onTimerExpire }: UseSleepTimerProps) {
  const [sleepTimerMode, setSleepTimerMode] = useState<SleepTimerMode>('off');
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number | null>(null);
  const sleepTimerModeRef = useRef<SleepTimerMode>('off');
  const sleepTimerEndRef = useRef<number | null>(null);
  const onTimerExpireRef = useRef(onTimerExpire);

  useEffect(() => {
    onTimerExpireRef.current = onTimerExpire;
  }, [onTimerExpire]);

  // Sleep Timer countdown ticker (Uses absolute timestamp to eliminate drift)
  useEffect(() => {
    if (sleepTimerMode === 'off' || sleepTimerMode === 'end_of_track' || !sleepTimerEndRef.current)
      return;

    const interval = setInterval(() => {
      if (!sleepTimerEndRef.current) {
        clearInterval(interval);
        return;
      }
      const remainingMs = sleepTimerEndRef.current - Date.now();
      const remainingSec = Math.max(0, Math.round(remainingMs / 1000));
      if (remainingSec <= 0) {
        clearInterval(interval);
        sleepTimerEndRef.current = null;
        setSleepTimerRemaining(null);
        sleepTimerModeRef.current = 'off';
        setSleepTimerMode('off');
        onTimerExpireRef.current();
      } else {
        setSleepTimerRemaining(remainingSec);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepTimerMode]);

  const setSleepTimer = useCallback((mode: SleepTimerMode) => {
    sleepTimerModeRef.current = mode;
    setSleepTimerMode(mode);
    if (mode === 'off') {
      sleepTimerEndRef.current = null;
      setSleepTimerRemaining(null);
      emitToast('Таймер сна выключен', 'info', 2000);
    } else if (mode === 'end_of_track') {
      sleepTimerEndRef.current = null;
      setSleepTimerRemaining(null);
      emitToast('Таймер сна: остановится в конце этого трека', 'info', 3000);
    } else {
      const minutes = parseInt(mode, 10);
      const totalSeconds = minutes * 60;
      sleepTimerEndRef.current = Date.now() + totalSeconds * 1000;
      setSleepTimerRemaining(totalSeconds);
      emitToast(`Таймер сна установлен на ${minutes} мин`, 'info', 3000);
    }
  }, []);

  const shouldStopOnTrackEnd = useCallback(() => {
    if (sleepTimerModeRef.current === 'end_of_track') {
      sleepTimerModeRef.current = 'off';
      setSleepTimerMode('off');
      setSleepTimerRemaining(null);
      sleepTimerEndRef.current = null;
      return true;
    }
    return false;
  }, []);

  return {
    sleepTimerMode,
    sleepTimerRemaining,
    sleepTimerModeRef,
    sleepTimerDeadline: sleepTimerEndRef.current,
    setSleepTimer,
    shouldStopOnTrackEnd,
  };
}
