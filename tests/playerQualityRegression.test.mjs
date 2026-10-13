import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedMap } from '../src/shared/utils/boundedCache.ts';
import { hookRuntime } from './helpers/hookRuntime.mjs';

function lyricsFixture() {
  let lyrics = 0,
    chords = 0;
  const h = hookRuntime(new URL('../src/shared/hooks/useLyricsAvailability.ts', import.meta.url), {
    '../utils/boundedCache': { BoundedMap },
    '../utils/lyricsIdentity': {
      createLyricsCacheKey: (title, artist, duration) => [title, artist, duration].join(':'),
    },
    '../bridge/platformBridge': {
      platformBridge: {
        getLyrics: async () => {
          lyrics++;
          return [{ time: 0, text: 'Fixture' }];
        },
        getChords: async () => {
          chords++;
          return { rawContent: 'C G' };
        },
      },
    },
  });
  return { h, counts: () => ({ lyrics, chords }) };
}
const song = (id) => ({ id, title: 'Track ' + id, artist: { name: 'Fixture' }, duration: 200 });

test('quick track navigation cancels optional lyrics/chords requests before they start', async () => {
  const { h, counts } = lyricsFixture();
  for (let i = 0; i < 30; i++) h.render(song(i + 1));
  assert.deepEqual(counts(), { lyrics: 0, chords: 0 });
  assert.equal(h.timers(), 1);
  h.fireTimers(350);
  await h.flush();
  assert.deepEqual(counts(), { lyrics: 1, chords: 1 });
  assert.equal(h.api().trackId, 30);
  assert.equal(h.api().hasLyrics, true);
  h.render(song(31));
  h.unmount();
  h.fireTimers(350);
  assert.deepEqual(counts(), { lyrics: 1, chords: 1 });
  assert.equal(h.lateUpdates(), 0);
});

test('lyrics availability retains recent lookups while evicting old recordings after a long session', async () => {
  const { h, counts } = lyricsFixture();
  for (let i = 1; i <= 260; i++) {
    h.render(song(i));
    h.fireTimers(350);
    await h.flush();
  }
  const before = counts().lyrics;
  h.render(song(259));
  h.fireTimers(350);
  await h.flush();
  assert.equal(counts().lyrics, before, 'Recent metadata should be reused');
  h.render(song(1));
  h.fireTimers(350);
  await h.flush();
  assert.equal(
    counts().lyrics,
    before + 1,
    'Unbounded availability cache retained the oldest recording',
  );
  h.unmount();
});

function artistFixture() {
  const pending = new Map(),
    sources = [];
  const h = hookRuntime(new URL('../src/shared/hooks/useArtistViewModel.ts', import.meta.url), {
    '../context/AudioContext': {
      useAudioState: () => ({ currentTrack: null, isPlaying: false }),
      useAudioControls: () => ({}),
      useAudio: () => ({}),
    },
    '../utils/formatters': { formatRecordType: (value) => value },
    '../utils/artistParser': { normalizeArtistDetails: (value) => value },
    '../bridge/platformBridge': {
      platformBridge: {
        getArtist: async (_query, _name, source) => {
          sources.push(source);
          return { artist: { id: 'fixture', name: 'Fixture' }, topTracks: [], albums: [] };
        },
        getArtistAllTracks: async () => [],
        getAlbumTracks: (id) => new Promise((resolve) => pending.set(id, resolve)),
      },
    },
  });
  const props = { artistQuery: 'fixture', artistName: 'Fixture', artistSource: 'youtube' };
  h.render(props);
  return { h, pending, props, sources };
}

test('a late album response cannot replace a newer selection or update an unmounted artist page', async () => {
  const { h, pending } = artistFixture();
  await h.flush();
  const a = h.api().handleAlbumClick({ id: 'a', title: 'Album A' });
  await h.flush();
  const b = h.api().handleAlbumClick({ id: 'b', title: 'Album B' });
  pending.get('b')([song('b')]);
  await b;
  await h.flush();
  pending.get('a')([song('a')]);
  await a;
  await h.flush();
  assert.equal(h.api().selectedAlbum.id, 'b');
  assert.equal(h.api().albumTracks[0].id, 'b');
  const c = h.api().handleAlbumClick({ id: 'c', title: 'Album C' });
  h.unmount();
  pending.get('c')([song('c')]);
  await c;
  assert.equal(h.lateUpdates(), 0);
});

test('closing an album cancels its pending view and source changes reload artist data', async () => {
  const { h, pending, props, sources } = artistFixture();
  await h.flush();
  const a = h.api().handleAlbumClick({ id: 'a', title: 'Album A' });
  h.api().setSelectedAlbum(null);
  pending.get('a')([song('a')]);
  await a;
  await h.flush();
  assert.equal(h.api().selectedAlbum, null);
  assert.equal(h.api().albumTracks.length, 0);
  h.render({ ...props, artistSource: 'soundcloud' });
  await h.flush();
  assert.deepEqual(sources, ['youtube', 'soundcloud']);
  h.unmount();
});

test('player shortcuts respect focused controls, browser modifiers, composition and held keys', () => {
  const window = new EventTarget();
  let toggles = 0,
    next = 0;
  const h = hookRuntime(
    new URL('../src/shared/hooks/useAudioKeyboardShortcuts.ts', import.meta.url),
    {},
    { window },
  );
  h.render({
    togglePlay: () => toggles++,
    nextTrack: () => next++,
    prevTrack() {},
    seek() {},
    setVolume() {},
    volume: 0.5,
    audioRef: { current: null },
  });
  const send = (code, options = {}, interactive = false) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, ...options });
    Object.defineProperty(event, 'target', {
      value: { tagName: interactive ? 'BUTTON' : 'DIV', closest: () => (interactive ? {} : null) },
    });
    window.dispatchEvent(event);
    return event;
  };
  assert.equal(send('Space', {}, true).defaultPrevented, false);
  assert.equal(send('KeyN', { ctrlKey: true }).defaultPrevented, false);
  send('Space', { repeat: true });
  send('KeyN', { metaKey: true });
  send('KeyN', { isComposing: true });
  assert.equal(toggles, 0);
  assert.equal(next, 0);
  assert.equal(send('Space').defaultPrevented, true);
  send('KeyN');
  assert.equal(toggles, 1);
  assert.equal(next, 1);
  h.unmount();
  send('Space');
  assert.equal(toggles, 1);
});
