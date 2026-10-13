import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialNavigationHistory,
  navigationHistoryReducer as reduce,
} from '../src/desktop/ui/navigationHistory.ts';
const navigate = (state, view, extra = {}) =>
  reduce(state, { type: 'navigate', entry: { view, ...extra } });
const current = (state) => state.entries[state.index];

test('Back and forward restore the specific search visit, source, draft, results and scroll', () => {
  let state = navigate(initialNavigationHistory, 'search');
  const id = current(state).id;
  const search = {
    query: 'сдвг',
    draft: 'сдвг',
    source: 'youtube',
    results: [{ id: 'yt_song', title: 'сдвг' }],
    artists: [{ id: 'artist', name: 'madk1d' }],
    completed: true,
  };
  state = reduce(state, { type: 'snapshot', id, page: { search } });
  state = reduce(state, { type: 'snapshot', id, page: { scrollTop: 630 } });
  state = navigate(state, 'artist', { artist: { id: 'artist', name: 'madk1d' } });
  state = reduce(state, { type: 'back' });
  assert.equal(current(state).id, id);
  assert.deepEqual(current(state).page, { search, scrollTop: 630 });
  state = reduce(state, { type: 'forward' });
  assert.equal(current(state).view, 'artist');
  state = reduce(state, { type: 'back' });
  assert.equal(current(state).page.search.results[0].id, 'yt_song');
});

test('Returning from a playlist preserves all My Music tabs and their filters', () => {
  for (const tab of ['tracks', 'playlists', 'albums', 'artists', 'history', 'offline']) {
    let state = navigate(initialNavigationHistory, 'my-music');
    const id = current(state).id;
    state = reduce(state, {
      type: 'snapshot',
      id,
      page: { music: { tab, query: 'test' }, scrollTop: 300 },
    });
    state = navigate(state, 'playlist_test', { playlist: { id: 'test', name: 'test' } });
    state = reduce(state, {
      type: 'snapshot',
      id: current(state).id,
      page: { playlistQuery: 'song' },
    });
    state = reduce(state, { type: 'back' });
    assert.deepEqual(current(state).page.music, { tab, query: 'test' });
    state = reduce(state, { type: 'forward' });
    assert.equal(current(state).page.playlistQuery, 'song');
  }
});

test('Separate searches do not overwrite each other; late writes target their original entry', () => {
  let state = navigate(initialNavigationHistory, 'search', { searchQuery: 'first' });
  const first = current(state).id;
  state = navigate(state, 'search', { searchQuery: 'second' });
  const second = current(state).id;
  state = reduce(state, {
    type: 'snapshot',
    id: first,
    page: { search: { query: 'first', completed: true } },
  });
  assert.equal(current(state).id, second);
  assert.equal(current(state).page, undefined);
  state = reduce(state, { type: 'back' });
  assert.equal(current(state).page.search.query, 'first');
  state = navigate(state, 'album', { album: { id: 'album', title: 'Album' } });
  assert.ok(!state.entries.some((entry) => entry.id === second));
  assert.equal(reduce(state, { type: 'forward' }).index, state.index);
  assert.equal(reduce(state, { type: 'snapshot', id: second, page: { scrollTop: 99 } }), state);
});

test('Navigation is bounded to fifty independent visits and remains correct after trimming', () => {
  let state = initialNavigationHistory;
  for (let i = 0; i < 80; i++) {
    state = navigate(state, 'search', { searchQuery: String(i) });
    state = reduce(state, { type: 'snapshot', id: current(state).id, page: { scrollTop: i } });
  }
  assert.equal(state.entries.length, 50);
  assert.equal(state.index, 49);
  assert.equal(new Set(state.entries.map((entry) => entry.id)).size, 50);
  for (let i = 0; i < 70; i++) state = reduce(state, { type: 'back' });
  assert.equal(state.index, 0);
  assert.equal(current(state).page.scrollTop, 30);
  state = navigate(state, 'my-music');
  assert.equal(state.entries.length, 2);
  assert.equal(state.index, 1);
});
