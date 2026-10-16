import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repo = process.env.SOSO_TEST_REPO || fileURLToPath(new URL('../', import.meta.url));
const { hookRuntime } = await import(
  pathToFileURL(path.join(repo, 'tests/helpers/hookRuntime.mjs'))
);
const { beginPlaybackIntent, invalidatePlaybackIntent } = await import(
  pathToFileURL(path.join(repo, 'src/shared/utils/playbackIntent.ts'))
);
const proposal = process.env.SOSO_LIBRARY_PROPOSAL;
const source = (relative) =>
  proposal
    ? pathToFileURL(path.join(proposal, 'files/src/shared', relative))
    : pathToFileURL(path.join(repo, 'src/shared', relative));
const hook = proposal
  ? pathToFileURL(path.join(proposal, 'preview/src/shared/hooks/useMyMusicViewModel.ts'))
  : source('hooks/useMyMusicViewModel.ts');
function fixture(options = {}) {
  const all = Array.from({ length: 205 }, (_, i) => ({
    deezer_id: String(i),
    title: 'Title ' + i,
    artist: 'Artist',
    album: 'Album',
    duration: 60,
    cover_url: '',
    preview_url: '',
  }));
  const reads = [],
    plays = [];
  let failure = false;
  const platform = {
    getLibraryPage: async (request) => {
      reads.push(request);
      if (failure) throw Error('read failed');
      const list = request.kind === 'tracks' ? all : [];
      const offset = request.offset || 0,
        items = list.slice(offset, offset + (request.limit || 100));
      return {
        kind: request.kind,
        items,
        total: list.length,
        offset,
        nextOffset: offset + items.length < list.length ? offset + items.length : null,
      };
    },
    getLibraryStats: async () => ({
      tracks: 205,
      playlists: 4,
      albums: 3,
      artists: 2,
      durationSeconds: 12300,
    }),
    getLibraryPlaybackTracks: async (request) => {
      reads.push({ playback: true, ...request });
      return all;
    },
    getListeningHistory: async () => [],
    clearListeningHistory: async () => true,
  };
  const audio = {
    likedTrackIds: new Set(),
    savedAlbumIds: new Set(),
    followedArtistIds: new Set(),
    cachedTrackIds: new Set(),
    playTrack: (...args) => plays.push(args),
    toggleSaveAlbum() {},
    toggleFollowArtist() {},
  };
  const h = hookRuntime(
    hook,
    {
      './usePagedLibrary': { source: source('hooks/usePagedLibrary.ts') },
      '../utils/libraryPageController': { source: source('utils/libraryPageController.ts') },
      '../utils/likedTrackMapping': { source: source('utils/likedTrackMapping.ts') },
      '../utils/librarySearch.ts': {
        filterLibraryTracks: (tracks, query) =>
          tracks.filter((t) => t.title.toLowerCase().includes(query)),
      },
      '../utils/playlistEvents': { subscribePlaylistUpdates: () => () => {} },
      '../utils/formatters': { detectTrackSource: () => 'youtube' },
      './formatters': { detectTrackSource: () => 'youtube' },
      '../utils/playbackIntent.ts': { beginPlaybackIntent },
      '../context/AudioContext': { useAudioState: () => audio, useAudioControls: () => audio },
      '../bridge/platformBridge': { platformBridge: platform },
      '../services/offlineCacheService': {
        offlineCacheService: { getAllCachedTracks: async () => [] },
      },
    },
    { window: new EventTarget() },
  );
  h.render({ initialTab: 'tracks', ...options });
  return {
    h,
    reads,
    plays,
    audio,
    platform,
    fail: () => {
      failure = true;
    },
  };
}
test('whole My Music hook loads only active first page, preserves total counts, and resolves complete queue only on play', async () => {
  const f = fixture();
  await f.h.flush();
  f.h.fireTimers(40);
  await f.h.flush();
  assert.equal(f.h.api().tracks.length, 100);
  assert.equal(f.h.api().stats.tracks, 205);
  assert.equal(f.h.api().totalDurationSeconds, 12300);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].kind, 'tracks');
  await f.h.api().handlePlayLibraryTrack(f.h.api().tracks[99]);
  assert.equal(f.plays.length, 1);
  assert.equal(f.plays[0][0].id, '99');
  assert.equal(f.plays[0][1].length, 205);
  assert.equal(f.reads[1].playback, true);
  f.h.unmount();
});
test('whole My Music hook restores saved prefix and keeps previous-success rows when refresh fails', async () => {
  const f = fixture({ initialLoadedCounts: { tracks: 205 }, initialSort: 'oldest' });
  await f.h.flush();
  await f.h.flush();
  assert.equal(f.h.api().tracks.length, 205);
  assert.equal(f.h.api().activePage.nextOffset, null);
  assert.ok(f.reads.every((r) => r.sort === 'oldest'));
  f.fail();
  f.h.api().loadLikedTracks();
  f.h.fireTimers(40);
  await f.h.flush();
  assert.equal(f.h.api().tracks.length, 205);
  assert.match(f.h.api().activePage.error, /read failed/);
  assert.equal(f.h.api().loadingTracks, false);
  f.h.unmount();
});
test('whole My Music hook opens album tab without fetching liked/artist/playlist metadata', async () => {
  const f = fixture({ initialTab: 'albums' });
  await f.h.flush();
  assert.deepEqual(
    f.reads.map((r) => r.kind),
    ['albums'],
  );
  f.h.unmount();
});

test('whole My Music hook discards pending complete context after a foreign playback intent', async () => {
  const f = fixture();
  await f.h.flush();
  let resolve;
  f.platform.getLibraryPlaybackTracks = () =>
    new Promise((yes) => {
      resolve = yes;
    });
  const pending = f.h.api().handlePlayLibraryTrack(f.h.api().tracks[0]);
  invalidatePlaybackIntent();
  resolve([{ deezer_id: '0', title: '0', artist: 'A', duration: 60 }]);
  await pending;
  assert.equal(f.plays.length, 0);
  f.h.unmount();
});
test('whole My Music hook discards pending playlist-card play after a foreign playback intent', async () => {
  const f = fixture();
  await f.h.flush();
  let resolve;
  f.platform.getPlaylistTracks = () =>
    new Promise((yes) => {
      resolve = yes;
    });
  const pending = f.h.api().handlePlayPlaylist({ stopPropagation() {} }, { id: 'p', name: 'P' });
  invalidatePlaybackIntent();
  resolve([{ track_deezer_id: 't', title: 'T', artist: 'A', duration: 60 }]);
  await pending;
  assert.equal(f.plays.length, 0);
  f.h.unmount();
});
