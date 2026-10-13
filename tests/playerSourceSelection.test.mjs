import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPlayerQueue } from '../src/shared/utils/playerQueueSelection.ts';
import { readCachedPlayerSource } from '../src/shared/services/playerCachedSource.ts';
const track = (id) => ({
  id,
  title: 'Track ' + id,
  artist: { name: 'Artist' },
  album: { title: 'Album' },
  preview: '',
  duration: 200,
});

test('queue selection retains a repeated saved occurrence, detects collection changes and appends only unknown tracks', () => {
  const first = track('a'),
    middle = track('b'),
    last = track('a'),
    queue = [first, middle, last];
  assert.equal(selectPlayerQueue(queue, 2, last, undefined, true).index, 2);
  assert.equal(selectPlayerQueue(queue, 2, last).index, 0);
  const append = selectPlayerQueue(queue, 2, track('new'));
  assert.equal(append.index, 3);
  assert.equal(append.queue.length, 4);
  assert.equal(queue.length, 3);
  assert.equal(selectPlayerQueue(queue, 2, first, [middle, first]).resetShuffle, false);
  assert.equal(selectPlayerQueue(queue, 2, track('new'), [track('new')]).resetShuffle, true);
});

test('late offline source and cover replies cannot read another cache or install audio for an old selection', async () => {
  let finish,
    current = true,
    coverReads = 0,
    memoryReads = 0;
  const readers = {
    offlineUrl: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    offlineCover: async () => {
      coverReads++;
      return 'blob:cover';
    },
    memoryUrl: () => {
      memoryReads++;
      return 'blob:memory';
    },
    isCurrent: () => current,
  };
  const pending = readCachedPlayerSource(track('old'), readers);
  current = false;
  finish('blob:offline');
  assert.deepEqual(await pending, { kind: 'stale' });
  assert.equal(coverReads, 0);
  assert.equal(memoryReads, 0);
  current = true;
  readers.offlineUrl = async () => 'blob:offline';
  readers.offlineCover = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const coverPending = readCachedPlayerSource(track('old'), readers);
  await Promise.resolve();
  current = false;
  finish('blob:cover');
  assert.deepEqual(await coverPending, { kind: 'stale' });
  assert.equal(memoryReads, 0);
});

test('offline audio takes priority over memory, includes offline artwork and leaves provider metadata untouched', async () => {
  const original = track('saved');
  const result = await readCachedPlayerSource(original, {
    offlineUrl: async () => 'blob:offline',
    offlineCover: async () => 'blob:cover',
    memoryUrl: () => {
      throw Error('Memory must not override offline data');
    },
    isCurrent: () => true,
  });
  assert.equal(result.kind, 'offline');
  assert.equal(result.track.album.cover, 'blob:cover');
  assert.equal(original.album.cover, undefined);
  assert.deepEqual(
    await readCachedPlayerSource(original, {
      offlineUrl: async () => null,
      offlineCover: async () => null,
      memoryUrl: () => 'blob:memory',
      isCurrent: () => true,
    }),
    { kind: 'memory', url: 'blob:memory', track: original },
  );
});
