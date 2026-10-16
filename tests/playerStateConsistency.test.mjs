import test from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime } from './helpers/hookRuntime.mjs';
import { ShuffleCycle } from '../src/shared/utils/shuffleCycle.ts';
import * as queueEntries from '../src/shared/utils/queueEntry.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const track = (id) => ({
  id,
  title: id,
  artist: { name: 'Artist' },
  album: { title: 'Album' },
  duration: 100,
});
function queueHarness() {
  const h = hookRuntime(new URL('../src/shared/hooks/useQueueManager.ts', import.meta.url), {
    '../utils/shuffleCycle': { ShuffleCycle },
    '../utils/queueEntry': queueEntries,
  });
  const api = h.render();
  api.setQueue(['a', 'b', 'c', 'd'].map(track));
  api.setQueueIndex(2);
  h.render();
  return h;
}

test('Queue insertion before the playing track preserves its position and successor', () => {
  const h = queueHarness();
  h.api().insertIntoQueue(track('new'), 0);
  const api = h.render();
  assert.equal(api.queue[api.queueIndex].id, 'c');
  assert.equal(api.queue[api.queueIndex + 1].id, 'd');
});

test('Removing an earlier item and then the playing item preserves its original successor', () => {
  const h = queueHarness(),
    api = h.api();
  api.removeFromQueue(0);
  api.removeFromQueue(1);
  assert.equal(api.queueRef.current[api.queueIndexRef.current]?.id, 'b');
  // Removing the playing item leaves its predecessor as the cursor; next is d.
  const result = h.render();
  assert.equal(result.queueIndex, 0);
  assert.equal(result.queue[result.queueIndex + 1].id, 'd');
});

test('Removing two earlier items in the same event cannot move the cursor below the playing item', () => {
  const h = queueHarness(),
    api = h.api();
  api.removeFromQueue(0);
  api.removeFromQueue(0);
  assert.equal(api.queueIndexRef.current, 0);
  assert.equal(h.render().queue[0].id, 'c');
});

test('Queue rejects invalid removal and insertion indices without corrupting the cursor', () => {
  const h = queueHarness(),
    api = h.api();
  api.removeFromQueue(-1);
  api.removeFromQueue(0.5);
  api.removeFromQueue(99);
  assert.equal(h.render().queueIndex, 2);
  api.insertIntoQueue(track('new'), 0.5);
  assert.equal(h.render().queue.at(-1).id, 'new');
  assert.equal(h.api().queue[h.api().queueIndex].id, 'c');
});

test('Queue commands expose the latest collection and modes within one event', () => {
  const h = queueHarness(),
    api = h.api();
  api.setQueue((previous) => previous.concat(track('e')));
  api.addToQueue(track('f'));
  api.setQueueIndex(3);
  api.cycleRepeatMode();
  api.cycleRepeatMode();
  assert.equal(api.queueRef.current.at(-1).id, 'f');
  assert.equal(api.queueIndexRef.current, 3);
  assert.equal(api.repeatModeRef.current, 'one');
  assert.equal(h.render().repeatMode, 'one');
});

const cacheSource = new URL('../src/shared/hooks/useLibraryCaches.ts', import.meta.url);
function libraryBindings(bridge, offline = { getAllCachedTracks: async () => [] }) {
  return {
    '../bridge/platformBridge': { platformBridge: bridge },
    '../services/offlineCacheService': {
      offlineCacheService: offline,
      subscribeOfflineCacheChanges: () => () => {},
    },
  };
}
const readers = () => ({
  getLikedTrackIds: async () => [],
  getDislikedTrackIds: async () => [],
  getSavedAlbumIds: async () => [],
  getArtistMembership: async () => [],
});
for (const [field, setter, method, fresh, stale, retained] of [
  [
    'dislikedTrackIds',
    'setDislikedTrackIds',
    'getDislikedTrackIds',
    ['yt_new', 'sc_old'],
    ['sc_stale'],
    'sc_old',
  ],
  [
    'savedAlbumIds',
    'setSavedAlbumIds',
    'getSavedAlbumIds',
    ['yt_new', 'album-old'],
    ['sc_stale'],
    'album-old',
  ],
  [
    'followedArtistIds',
    'setFollowedArtistIds',
    'getArtistMembership',
    [
      { id: 'yt_new', name: 'New' },
      { id: 'artist-old', name: 'Old' },
    ],
    [{ id: 'sc_stale', name: 'Stale' }],
    'artist-old',
  ],
]) {
  test(
    'Library: delayed initial ' + field + ' snapshot cannot undo a committed mutation',
    async () => {
      const old = deferred(),
        current = deferred();
      let reads = 0;
      const bridge = readers();
      bridge[method] = () => (++reads === 1 ? old : current).promise;
      const h = hookRuntime(cacheSource, libraryBindings(bridge));
      const api = h.render();
      api[setter](new Set(['yt_new']));
      h.render();
      old.resolve(stale);
      await h.flush();
      assert.ok(h.api()[field].has('yt_new'));
      assert.equal(h.api()[field].has('sc_stale'), false);
      assert.equal(reads, 2);
      current.resolve(fresh);
      await h.flush();
      assert.ok(h.api()[field].has('yt_new'));
      assert.ok(h.api()[field].has(retained));
      h.unmount();
    },
  );
}

test('Library: an offline snapshot cannot restore a track removed while it was pending', async () => {
  const old = deferred(),
    current = deferred();
  let reads = 0;
  const h = hookRuntime(
    cacheSource,
    libraryBindings(readers(), {
      getAllCachedTracks: () => (++reads === 1 ? old : current).promise,
    }),
  );
  const api = h.render();
  api.setCachedTrackIds(new Set());
  old.resolve([{ trackId: 'sc_removed' }]);
  await h.flush();
  assert.equal(h.api().cachedTrackIds.has('sc_removed'), false);
  current.resolve([{ trackId: 'yt_kept' }]);
  await h.flush();
  assert.equal(h.api().cachedTrackIds.has('yt_kept'), true);
  h.unmount();
});

function managerHarness(bridge) {
  return hookRuntime(new URL('../src/shared/hooks/useLibraryManager.ts', import.meta.url), {
    ...libraryBindings(bridge),
    './useLibraryCaches': { source: cacheSource },
    '../services/youtubeAvailability.ts': { isYouTubeItemDisabled: () => false },
    '../utils/formatters': { detectTrackSource: () => 'youtube' },
    '../services/offlineDownloadProgress': {
      getOfflineDownloadProgress: () => null,
      setOfflineDownloadProgress() {},
    },
    '../context/ToastContext': { emitToast() {} },
  });
}

test('Disliking a favorite through the real library hook never re-likes it in SQLite', async (t) => {
  const db = new DatabaseManager(':memory:');
  db.save = () => {};
  await db.init();
  t.after(() => db.db.close());
  db.toggleLikeTrack({ deezer_id: 'yt_song', title: 'Song', artist: 'Artist' });
  let toggles = 0;
  const bridge = {
    ...readers(),
    getLikedTrackIds: async () => db.getLikedTrackIds(),
    getDislikedTrackIds: async () => db.getDislikedTrackIds(),
    dislikeTrack: async (song) => db.dislikeTrack(song),
    toggleLikeTrack: async (song) => {
      toggles++;
      return db.toggleLikeTrack({ ...song, deezer_id: String(song.id) });
    },
  };
  const h = managerHarness(bridge);
  h.render();
  await h.flush();
  assert.ok(h.api().likedTrackIds.has('yt_song'));
  assert.equal(await h.api().dislikeTrack(track('yt_song')), true);
  await h.flush();
  assert.equal(db.isTrackLiked('yt_song'), false);
  assert.equal(db.isTrackDisliked('yt_song'), true);
  assert.equal(h.api().likedTrackIds.has('yt_song'), false);
  assert.equal(toggles, 0);
  assert.equal(db.getLikedTrackIds().includes('undefined'), false);
  h.unmount();
});

test('Failed dislike/undislike commits preserve UI state and do not skip the playing song', async () => {
  let skips = 0;
  const bridge = {
    ...readers(),
    getLikedTrackIds: async () => ['yt_song'],
    getDislikedTrackIds: async () => ['yt_other'],
    dislikeTrack: async () => false,
    undislikeTrack: async () => false,
  };
  const h = managerHarness(bridge);
  h.render({
    currentTrackRef: { current: track('yt_song') },
    nextTrack: () => {
      skips++;
    },
  });
  await h.flush();
  assert.equal(await h.api().dislikeTrack(track('yt_song')), false);
  assert.equal(await h.api().undislikeTrack('yt_other'), false);
  await h.flush();
  assert.ok(h.api().likedTrackIds.has('yt_song'));
  assert.ok(h.api().dislikedTrackIds.has('yt_other'));
  assert.equal(skips, 0);
  h.unmount();
});
