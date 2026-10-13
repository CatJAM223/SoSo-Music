import type { Track } from '../types/index.ts';
import { sameShuffleCollection } from './shuffleCycle.ts';

interface QueueSelection {
  queue: Track[];
  index: number;
  resetShuffle: boolean;
}

/** A restored position selects the same queue occurrence when a track appears more than once. */
export function selectPlayerQueue(
  queue: Track[],
  currentIndex: number,
  track: Track,
  newQueue?: Track[],
  restoringPosition = false,
): QueueSelection {
  if (newQueue)
    return {
      queue: newQueue,
      index: newQueue.findIndex((candidate) => String(candidate.id) === String(track.id)),
      resetShuffle: !sameShuffleCollection(queue, newQueue),
    };
  const currentMatches = restoringPosition && String(queue[currentIndex]?.id) === String(track.id);
  const existingIndex = currentMatches
    ? currentIndex
    : queue.findIndex((candidate) => String(candidate.id) === String(track.id));
  if (existingIndex >= 0) return { queue, index: existingIndex, resetShuffle: false };
  return { queue: [...queue, track], index: queue.length, resetShuffle: false };
}
