import { useState, useRef, useEffect, useCallback, type SetStateAction } from 'react';
import { RepeatMode, Track } from '../types';
import { ShuffleCycle } from '../utils/shuffleCycle';
import type { PlaybackSession } from '../services/playbackSession';

export function useQueueManager(initial: PlaybackSession | null = null) {
  const [queue, setQueueState] = useState<Track[]>(initial?.queue ?? []);
  const [queueIndex, setQueueIndexState] = useState(initial?.queueIndex ?? -1);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>(initial?.repeatMode ?? 'off');
  const [isShuffle, setIsShuffleState] = useState(initial?.isShuffle ?? false);
  const queueRef = useRef<Track[]>(initial?.queue ?? []);
  const queueIndexRef = useRef(initial?.queueIndex ?? -1);
  const repeatModeRef = useRef<RepeatMode>(initial?.repeatMode ?? 'off');
  const isShuffleRef = useRef(initial?.isShuffle ?? false);
  const shuffleCycleRef = useRef(new ShuffleCycle());
  const [shuffledUpcomingIndices, setShuffledUpcomingIndices] = useState<number[]>([]);

  // Commands and media events can run in the same React batch. Publish their
  // result synchronously; keep mutations out of replayable React state updaters.
  const setQueue = useCallback((value: SetStateAction<Track[]>) => {
    const next = typeof value === 'function' ? value(queueRef.current) : value;
    queueRef.current = next;
    setQueueState(next);
  }, []);
  const setQueueIndex = useCallback((value: SetStateAction<number>) => {
    const next = typeof value === 'function' ? value(queueIndexRef.current) : value;
    queueIndexRef.current = next;
    setQueueIndexState(next);
  }, []);
  const setRepeatMode = useCallback((value: SetStateAction<RepeatMode>) => {
    const next = typeof value === 'function' ? value(repeatModeRef.current) : value;
    repeatModeRef.current = next;
    setRepeatModeState(next);
  }, []);
  const setIsShuffle = useCallback((value: SetStateAction<boolean>) => {
    const next = typeof value === 'function' ? value(isShuffleRef.current) : value;
    isShuffleRef.current = next;
    setIsShuffleState(next);
  }, []);

  useEffect(() => {
    const next = isShuffle
      ? shuffleCycleRef.current.upcoming(queue, queue[queueIndex]?.id, repeatMode === 'all')
      : [];
    setShuffledUpcomingIndices((previous) =>
      previous.length === next.length && previous.every((index, i) => index === next[i])
        ? previous
        : next,
    );
  }, [queue, queueIndex, isShuffle, repeatMode]);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((previous) => (previous === 'off' ? 'all' : previous === 'all' ? 'one' : 'off'));
  }, [setRepeatMode]);
  const toggleShuffle = useCallback(() => setIsShuffle((previous) => !previous), [setIsShuffle]);
  const addToQueue = useCallback(
    (track: Track) => setQueue((previous) => [...previous, track]),
    [setQueue],
  );

  const insertIntoQueue = useCallback(
    (track: Track, atIndex?: number) => {
      const copy = [...queueRef.current];
      const target =
        typeof atIndex === 'number' &&
        Number.isInteger(atIndex) &&
        atIndex >= 0 &&
        atIndex <= copy.length
          ? atIndex
          : copy.length;
      if (isShuffleRef.current && copy[target]) {
        shuffleCycleRef.current.moveUpcoming(
          [...copy, track],
          copy[queueIndexRef.current]?.id,
          repeatModeRef.current === 'all',
          track.id,
          copy[target].id,
        );
      }
      copy.splice(target, 0, track);
      if (target <= queueIndexRef.current) setQueueIndex((previous) => previous + 1);
      setQueue(copy);
    },
    [setQueue, setQueueIndex],
  );

  const playNext = useCallback(
    (track: Track) => {
      if (isShuffleRef.current) shuffleCycleRef.current.prioritize(track.id);
      const copy = [...queueRef.current];
      const insertAt = queueIndexRef.current >= 0 ? queueIndexRef.current + 1 : copy.length;
      copy.splice(insertAt, 0, track);
      setQueue(copy);
    },
    [setQueue],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      const previous = queueRef.current;
      if (!Number.isInteger(index) || index < 0 || index >= previous.length) return;
      const updated = previous.filter((_, position) => position !== index);
      // If the playing item is removed, the next command must still select its
      // original successor. The current audio continues until that command.
      if (index <= queueIndexRef.current) setQueueIndex((position) => position - 1);
      setQueue(updated);
    },
    [setQueue, setQueueIndex],
  );

  const clearQueue = useCallback(
    (fallbackTrack?: Track | null) => {
      shuffleCycleRef.current.reset();
      setQueue(fallbackTrack ? [fallbackTrack] : []);
      setQueueIndex(fallbackTrack ? 0 : -1);
    },
    [setQueue, setQueueIndex],
  );

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      const previous = queueRef.current;
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        fromIndex >= previous.length ||
        toIndex < 0 ||
        toIndex >= previous.length ||
        fromIndex === toIndex
      )
        return;
      if (isShuffleRef.current)
        shuffleCycleRef.current.moveUpcoming(
          previous,
          previous[queueIndexRef.current]?.id,
          repeatModeRef.current === 'all',
          previous[fromIndex].id,
          previous[toIndex].id,
        );
      const updated = [...previous];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      const current = queueIndexRef.current;
      if (current === fromIndex) setQueueIndex(toIndex);
      else if (fromIndex < current && toIndex >= current) setQueueIndex(current - 1);
      else if (fromIndex > current && toIndex <= current) setQueueIndex(current + 1);
      setQueue(updated);
    },
    [setQueue, setQueueIndex],
  );

  const shuffleUpcomingQueue = useCallback(() => {
    if (isShuffleRef.current) {
      shuffleCycleRef.current.reshuffle();
      setQueue((previous) => [...previous]);
      return;
    }
    const previous = queueRef.current,
      current = queueIndexRef.current;
    if (previous.length <= current + 2) return;
    const upcoming = [...previous.slice(current + 1)];
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    setQueue([...previous.slice(0, current + 1), ...upcoming]);
  }, [setQueue]);

  return {
    shuffledUpcomingIndices,
    queue,
    setQueue,
    queueIndex,
    setQueueIndex,
    repeatMode,
    setRepeatMode,
    isShuffle,
    setIsShuffle,
    queueRef,
    queueIndexRef,
    repeatModeRef,
    isShuffleRef,
    shuffleCycleRef,
    cycleRepeatMode,
    toggleShuffle,
    addToQueue,
    insertIntoQueue,
    playNext,
    removeFromQueue,
    clearQueue,
    reorderQueue,
    shuffleUpcomingQueue,
  };
}
