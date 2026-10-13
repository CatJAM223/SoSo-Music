import { filterLibraryTracks } from '../src/shared/utils/librarySearch.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime } from './helpers/hookRuntime.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
function harness(
  bridge = {},
  offline = { getAllCachedTracks: async () => [] },
  initialTab = 'tracks',
) {
  const audio = {
    likedTrackIds: new Set(),
    savedAlbumIds: new Set(),
    followedArtistIds: new Set(),
    cachedTrackIds: new Set(),
    playTrack() {},
    toggleSaveAlbum() {},
    toggleFollowArtist() {},
  };
  const platform = {
    getPlaylists: async () => [],
    getLikedTracks: async () => [],
    getSavedAlbums: async () => [],
    getFollowedArtists: async () => [],
    getListeningHistory: async () => [],
    clearListeningHistory: async () => true,
    ...bridge,
  };
  const h = hookRuntime(
    new URL('../src/shared/hooks/useMyMusicViewModel.ts', import.meta.url),
    {
      '../context/AudioContext': { useAudioState: () => audio, useAudioControls: () => audio },
      '../bridge/platformBridge': { platformBridge: platform },
      '../services/offlineCacheService': { offlineCacheService: offline },
      '../utils/playlistEvents': {
        source: new URL('../src/shared/utils/playlistEvents.ts', import.meta.url),
      },
      '../utils/librarySearch.ts': { filterLibraryTracks },
      '../utils/formatters': { detectTrackSource: () => 'youtube' },
    },
    { window: new EventTarget() },
  );
  h.render({ initialTab });
  return h;
}
for (const [method, reload, field, row] of [
  ['getPlaylists', 'loadPlaylists', 'playlists', (id) => ({ id, name: id })],
  [
    'getLikedTracks',
    'loadLikedTracks',
    'tracks',
    (id) => ({ deezer_id: id, title: id, artist: 'Artist', duration: 100 }),
  ],
  ['getSavedAlbums', 'loadSavedAlbums', 'savedAlbums', (id) => ({ id, title: id })],
  ['getFollowedArtists', 'loadFollowedArtists', 'followedArtists', (id) => ({ id, name: id })],
  [
    'getListeningHistory',
    'loadListeningHistory',
    'historyItems',
    (id) => ({ id, title: id, artist: 'Artist' }),
  ],
])
  test(
    'My Music: ' + field + ' keeps the latest completed read when responses arrive in reverse',
    async () => {
      const old = deferred(),
        fresh = deferred();
      let reads = 0;
      const h = harness(
        { [method]: () => (++reads === 1 ? old : fresh).promise },
        undefined,
        field === 'historyItems' ? 'history' : 'tracks',
      );
      const next = h.api()[reload]();
      fresh.resolve([row('new')]);
      await next;
      await h.flush();
      old.resolve([row('old')]);
      await h.flush();
      assert.equal(h.api()[field][0].id, 'new');
      h.unmount();
    },
  );

test('My Music: clearing history invalidates a snapshot already being loaded', async () => {
  const pending = deferred();
  const h = harness({ getListeningHistory: () => pending.promise }, undefined, 'history');
  await h.api().confirmClearHistory();
  await h.flush();
  pending.resolve([{ id: 1, title: 'Removed', artist: 'Artist' }]);
  await h.flush();
  assert.equal(h.api().historyItems.length, 0);
  assert.equal(h.api().loadingHistory, false);
  h.unmount();
});

test('My Music: closing the page rejects all pending state updates', async () => {
  const pending = deferred();
  const read = () => pending.promise;
  const h = harness(
    {
      getPlaylists: read,
      getLikedTracks: read,
      getSavedAlbums: read,
      getFollowedArtists: read,
      getListeningHistory: read,
    },
    { getAllCachedTracks: read },
    'history',
  );
  h.unmount();
  pending.resolve([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.lateUpdates(), 0);
});

test('My Music: failed history clearing preserves the list and reports failure', async () => {
  const h = harness(
    {
      getListeningHistory: async () => [{ id: 1, title: 'Keep', artist: 'Artist' }],
      clearListeningHistory: async () => {
        throw Error('Storage failed');
      },
    },
    undefined,
    'history',
  );
  await h.flush();
  await assert.rejects(h.api().confirmClearHistory());
  await h.flush();
  assert.equal(h.api().historyItems.length, 1);
  h.unmount();
});
