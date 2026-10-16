import test from 'node:test';
import assert from 'node:assert/strict';
import * as entries from '../src/shared/utils/queueEntry.ts';
import { ShuffleCycle, sameShuffleCollection } from '../src/shared/utils/shuffleCycle.ts';
import { selectPlayerQueue } from '../src/shared/utils/playerQueueSelection.ts';
import {
  PlaybackSessionWriter,
  readPlaybackSession,
} from '../src/shared/services/playbackSession.ts';
import { hookRuntime } from './helpers/hookRuntime.mjs';

const track = (id) => ({
  id,
  title: id,
  duration: 100,
  artist: { name: 'Artist' },
  album: {},
  preview: '',
});
const key = entries.queueEntryKey;
const keys = (queue) => queue.map(key);
function queueHarness() {
  return hookRuntime(new URL('../src/shared/hooks/useQueueManager.ts', import.meta.url), {
    '../utils/shuffleCycle': { ShuffleCycle },
    '../utils/queueEntry': entries,
  });
}

test('Repeated recordings, including the same object, have independent occurrence IDs without changing provider IDs', () => {
  const a = track('a');
  const q = entries.ensureQueueEntries([a, track('b'), a]);
  assert.equal(new Set(keys(q)).size, 3);
  assert.deepEqual(
    q.map((t) => t.id),
    ['a', 'b', 'a'],
  );
  assert.equal(entries.readQueueEntryId(a), undefined);
  assert.equal(entries.ensureQueueEntries(q), q);
  const metadata = entries.ensureQueueEntries(
    q.map((t) => ({ id: t.id, title: 'fresh' })),
    q,
  );
  assert.deepEqual(keys(metadata), keys(q));
  assert.equal(sameShuffleCollection(q, q.slice(0, 2)), false);
  // An explicit existing row cannot lose its ID to an earlier anonymous insertion.
  const inserted = entries.ensureQueueEntries([a, q[0], q[2]], q);
  assert.equal(key(inserted[1]), key(q[0]));
  assert.equal(key(inserted[2]), key(q[2]));
  assert.notEqual(key(inserted[0]), key(q[0]));
  const copied = entries.ensureQueueEntries([q[0], q[0]]);
  assert.equal(key(copied[0]), key(q[0]));
  assert.notEqual(key(copied[1]), key(q[0]));
});

test('Shuffle visits every occurrence of [A,B,A] and history returns to the correct duplicate', () => {
  const q = entries.ensureQueueEntries([track('a'), track('b'), track('a')]);
  const cycle = new ShuffleCycle();
  let current = key(q[0]);
  const played = [0];
  while (cycle.hasNext(q, current, false)) {
    const next = cycle.next(q, current, false, () => 0);
    played.push(next);
    current = key(q[next]);
  }
  assert.deepEqual(played, [0, 1, 2]);
  assert.equal(cycle.next(q, current, false), -1);
  assert.equal(cycle.previous(q, current), 1);
  assert.equal(cycle.previous(q, key(q[1])), 0);
  assert.equal(cycle.next(q, key(q[0]), false), 1);
  assert.equal(cycle.next(q, key(q[1]), false), 2);
  for (let pass = 0; pass < 3; pass++) {
    const visited = [];
    for (let i = 0; i < q.length; i++) {
      const index = cycle.next(q, current, true, () => 0);
      current = key(q[index]);
      visited.push(index);
    }
    assert.equal(new Set(visited).size, 3);
  }
});

test('Real queue hook play-next of the playing recording selects the inserted occurrence, across reorder/removal', () => {
  const h = queueHarness();
  const api = h.render();
  api.setQueue([track('a'), track('b'), track('a')]);
  api.setQueueIndex(0);
  api.toggleShuffle();
  h.render();
  const playing = api.queueRef.current[0];
  api.playNext(playing);
  const q = api.queueRef.current;
  assert.notEqual(key(q[1]), key(playing));
  assert.equal(api.shuffleCycleRef.current.upcoming(q, key(playing), false)[0], 1);
  assert.equal(api.shuffleCycleRef.current.next(q, key(playing), false), 1);
  assert.equal(selectPlayerQueue(q, 0, q[1]).index, 1);
  api.setQueueIndex(1);
  const selected = key(q[1]);
  api.reorderQueue(1, 3);
  assert.equal(key(api.queueRef.current[api.queueIndexRef.current]), selected);
  api.removeFromQueue(0);
  assert.equal(key(api.queueRef.current[api.queueIndexRef.current]), selected);
  api.addToQueue(api.queueRef.current[0]);
  assert.equal(new Set(keys(api.queueRef.current)).size, api.queueRef.current.length);
  h.unmount();
});

test('Occurrence selection and session restore preserve a second duplicate and repair duplicate persisted IDs', () => {
  const q = entries.ensureQueueEntries([track('a'), track('b'), track('a')]);
  assert.equal(selectPlayerQueue(q, 0, q[2]).index, 2);
  assert.equal(selectPlayerQueue(q, 2, track('a')).index, 0);
  assert.equal(selectPlayerQueue(q, 2, track('a'), undefined, true).index, 2);
  let stored,
    writes = 0;
  const store = {
    getItem: () => stored ?? null,
    setItem: (_, value) => {
      stored = value;
      writes++;
    },
  };
  const input = {
    track: q[2],
    queue: q,
    queueIndex: 2,
    position: 13,
    repeatMode: 'off',
    isShuffle: true,
  };
  const writer = new PlaybackSessionWriter(store);
  writer.save(input, true);
  writer.save(input, true);
  assert.equal(writes, 1);
  const restored = readPlaybackSession(store);
  assert.deepEqual(keys(restored.queue), keys(q));
  assert.equal(key(restored.track), key(q[2]));
  assert.equal(restored.queueIndex, 2);
  const h = queueHarness(),
    api = h.render(restored);
  assert.deepEqual(keys(api.queueRef.current), keys(q));
  assert.equal(selectPlayerQueue(api.queueRef.current, 2, restored.track).index, 2);
  h.unmount();
  const malformed = { ...input, queue: [q[0], q[0]], track: q[0], queueIndex: 1 };
  writer.save(malformed, true);
  const repaired = readPlaybackSession(store);
  assert.equal(new Set(keys(repaired.queue)).size, 2);
  assert.equal(key(repaired.track), key(repaired.queue[1]));
});

test('Fresh selected-track metadata updates only its occurrence and preserves its entry ID', () => {
  const q = entries.ensureQueueEntries([track('a'), track('a')]);
  const fresh = { ...q[1], title: 'Fresh title', preview: 'https://audio.example/fresh' };
  const selection = selectPlayerQueue(q, 0, fresh);
  assert.equal(selection.index, 1);
  assert.equal(key(selection.queue[1]), key(q[1]));
  assert.equal(selection.queue[1].preview, fresh.preview);
  assert.equal(selection.queue[1].title, fresh.title);
  assert.equal(selection.queue[0], q[0]);
  assert.equal(q[1].title, 'a');
  const replacement = selectPlayerQueue(q, 0, { ...track('a'), title: 'New metadata' }, [
    track('a'),
  ]);
  assert.equal(replacement.queue[0].title, 'New metadata');
});

test('A unique saved occurrence ID takes priority over a stale numeric cursor', () => {
  const q = entries.ensureQueueEntries([track('a'), track('b'), track('a')]);
  let stored;
  const store = {
    getItem: () => stored,
    setItem: (_, value) => {
      stored = value;
    },
  };
  new PlaybackSessionWriter(store).save(
    { track: q[2], queue: q, queueIndex: 0, position: 5, repeatMode: 'off', isShuffle: false },
    true,
  );
  const restored = readPlaybackSession(store);
  assert.equal(restored.queueIndex, 2);
  assert.equal(key(restored.track), key(q[2]));
});
