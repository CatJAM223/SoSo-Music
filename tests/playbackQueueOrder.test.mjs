import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingQueueIndices } from '../src/shared/utils/playbackQueueOrder.ts';

test('Normal queue wraps only after reaching its end and excludes the current song', () => {
  assert.deepEqual(upcomingQueueIndices(5, 3, undefined, false), [4]);
  assert.deepEqual(upcomingQueueIndices(5, 3, undefined, true), [4, 0, 1, 2]);
  assert.deepEqual(upcomingQueueIndices(1, 0, undefined, true), []);
  assert.deepEqual(upcomingQueueIndices(0, -1), []);
});
