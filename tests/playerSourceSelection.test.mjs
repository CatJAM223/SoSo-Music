import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPlayerQueue } from '../src/shared/utils/playerQueueSelection.ts';
import {
  readCachedPlayerCover,
  readCachedPlayerSource,
} from '../src/shared/services/playerCachedSource.ts';
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
  assert.equal(selectPlayerQueue(queue, 2, first, [middle, first]).resetShuffle, true);
  assert.equal(selectPlayerQueue(queue, 2, track('new'), [track('new')]).resetShuffle, true);
});

test('a valid RAM source bypasses offline storage; a RAM fill during an offline miss is reused', async () => {
  const original = track('saved');
  let offlineReads = 0;
  const readers = {
    offlineUrl: async () => {
      offlineReads++;
      throw Error('storage unavailable');
    },
    memoryUrl: () => 'blob:memory',
    isCurrent: () => true,
  };
  assert.deepEqual(await readCachedPlayerSource(original, readers), {
    kind: 'memory',
    url: 'blob:memory',
    track: original,
  });
  assert.equal(offlineReads, 0);
  let memory = null;
  readers.memoryUrl = () => memory;
  readers.offlineUrl = async () => {
    memory = 'blob:completed';
    return null;
  };
  assert.equal((await readCachedPlayerSource(original, readers)).url, 'blob:completed');
});

test('offline audio is available without awaiting artwork or changing provider metadata', async () => {
  const original = track('saved');
  const result = await readCachedPlayerSource(original, {
    offlineUrl: async () => 'blob:offline',
    memoryUrl: () => null,
    isCurrent: () => true,
  });
  assert.deepEqual(result, { kind: 'offline', url: 'blob:offline', track: original });
  assert.equal(original.album.cover, undefined);
  assert.equal(
    await readCachedPlayerCover(original.id, {
      offlineCover: async () => 'blob:cover',
      isCurrent: () => true,
    }),
    'blob:cover',
  );
});

test('stale offline replies cannot read another cache or return artwork for the new selection', async () => {
  let finish,
    current = true,
    memoryReads = 0,
    coverReads = 0;
  const pending = readCachedPlayerSource(track('old'), {
    offlineUrl: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    memoryUrl: () => {
      memoryReads++;
      return null;
    },
    isCurrent: () => current,
  });
  current = false;
  finish('blob:offline');
  assert.deepEqual(await pending, { kind: 'stale' });
  assert.equal(memoryReads, 1, 'only the synchronous RAM lookup precedes cancellation');
  const readers = {
    offlineCover: () => {
      coverReads++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    isCurrent: () => current,
  };
  assert.equal(await readCachedPlayerCover('old', readers), null);
  assert.equal(coverReads, 0);
  current = true;
  const coverPending = readCachedPlayerCover('old', readers);
  current = false;
  finish('blob:old-cover');
  assert.equal(await coverPending, null);
});

test('unavailable artwork does not reject a successful offline audio lookup', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      await readCachedPlayerCover('saved', {
        offlineCover: async () => {
          throw Error('broken artwork record');
        },
        isCurrent: () => true,
      }),
      null,
    );
  } finally {
    console.warn = originalWarn;
  }
});
