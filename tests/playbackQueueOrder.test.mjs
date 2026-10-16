import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upcomingQueueIndices,
  prefetchQueueIndices,
} from '../src/shared/utils/playbackQueueOrder.ts';

test('Normal queue wraps only after reaching its end and excludes the current song', () => {
  assert.deepEqual(upcomingQueueIndices(5, 3, undefined, false), [4]);
  assert.deepEqual(upcomingQueueIndices(5, 3, undefined, true), [4, 0, 1, 2]);
  assert.deepEqual(upcomingQueueIndices(1, 0, undefined, true), []);
  assert.deepEqual(upcomingQueueIndices(0, -1), []);
});

test('Prefetch follows prepared shuffle, skips disabled entries and stops after two candidates', () => {
  assert.deepEqual(
    prefetchQueueIndices(6, 0, [4, 3, 1, 5, 2], false, (i) => i !== 4),
    [3, 1],
  );
  let visits = 0;
  assert.deepEqual(
    prefetchQueueIndices(100000, 0, undefined, false, () => {
      visits++;
      return true;
    }),
    [1, 2],
  );
  assert.equal(visits, 2, 'ordinary playback must not allocate or inspect the whole playlist');
  assert.deepEqual(
    prefetchQueueIndices(4, 3, undefined, true, () => true),
    [0, 1],
  );
  assert.deepEqual(
    prefetchQueueIndices(4, 3, undefined, false, () => true),
    [],
  );
  assert.deepEqual(
    prefetchQueueIndices(1, 0, undefined, true, () => true),
    [],
  );
  assert.deepEqual(
    prefetchQueueIndices(4, 0, undefined, true, () => false),
    [],
  );
});
