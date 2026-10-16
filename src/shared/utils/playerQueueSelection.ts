import type { Track } from '../types/index.ts';
import { sameShuffleCollection } from './shuffleCycle.ts';
import { createQueueEntry, ensureQueueEntries, readQueueEntryId } from './queueEntry.ts';

interface QueueSelection {
  queue: Track[];
  index: number;
  resetShuffle: boolean;
}

/** Queue rows select an occurrence; a library track without an entry ID selects its first match. */
export function selectPlayerQueue(
  queue: Track[],
  currentIndex: number,
  track: Track,
  newQueue?: Track[],
  restoringPosition = false,
): QueueSelection {
  const source = newQueue ?? queue;
  const entries = ensureQueueEntries(source, queue);
  const entryId = readQueueEntryId(track);
  let index = entryId
    ? entries.findIndex(
        (candidate) =>
          readQueueEntryId(candidate) === entryId && String(candidate.id) === String(track.id),
      )
    : -1;
  if (index < 0 && restoringPosition && String(entries[currentIndex]?.id) === String(track.id))
    index = currentIndex;
  if (index < 0)
    index = entries.findIndex((candidate) => String(candidate.id) === String(track.id));
  const resetShuffle = !!newQueue && !sameShuffleCollection(queue, newQueue);
  if (index >= 0) {
    const selected = entries[index];
    if (selected === track) return { queue: entries, index, resetShuffle };
    // The caller may have fresher stream/artwork metadata than the queued recording.
    const updated = [...entries];
    updated[index] = { ...selected, ...track, ...{ queueEntryId: readQueueEntryId(selected)! } };
    return { queue: updated, index, resetShuffle };
  }
  return { queue: [...entries, createQueueEntry(track)], index: entries.length, resetShuffle };
}
