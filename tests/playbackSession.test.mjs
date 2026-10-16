import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PlaybackSessionWriter,
  readPlaybackSession,
  PLAYBACK_SESSION_KEY,
} from '../src/shared/services/playbackSession.ts';
import { ShuffleCycle } from '../src/shared/utils/shuffleCycle.ts';
import * as queueEntries from '../src/shared/utils/queueEntry.ts';
import { hookRuntime } from './helpers/hookRuntime.mjs';

const track = (id) => ({
  id,
  title: 'Track ' + id,
  source: 'youtube',
  duration: 180,
  artist: { name: 'Artist' },
  album: { title: 'Album', cover: 'https://i.ytimg.com/cover.jpg' },
  preview: 'https://rr1.googlevideo.com/videoplayback?signature=secret',
  resolvedStreamUrl: 'https://signed.test/token=secret',
});
const input = () => ({
  track: track('yt_b'),
  queue: [track('yt_a'), track('yt_b'), track('yt_c')],
  queueIndex: 1,
  position: 61.25,
  repeatMode: 'all',
  isShuffle: true,
});
function memory() {
  const data = new Map();
  let writes = 0;
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      writes++;
      data.set(k, v);
    },
    get writes() {
      return writes;
    },
  };
}

test('Checkpoint round-trip retains the track, fractional position, queue cursor and modes without expiring stream URLs', () => {
  const store = memory();
  const writer = new PlaybackSessionWriter(store);
  assert.equal(writer.save(input(), true), true);
  const restored = readPlaybackSession(store);
  assert.equal(restored.track.id, 'yt_b');
  assert.equal(restored.position, 61.25);
  assert.deepEqual(
    restored.queue.map((t) => t.id),
    ['yt_a', 'yt_b', 'yt_c'],
  );
  assert.equal(restored.queueIndex, 1);
  assert.equal(restored.repeatMode, 'all');
  assert.equal(restored.isShuffle, true);
  assert.equal(restored.track.preview, '');
  assert.equal(restored.track.album.cover, 'https://i.ytimg.com/cover.jpg');
  assert.ok(!store.getItem(PLAYBACK_SESSION_KEY).includes('secret'));
  assert.ok(!Object.hasOwn(restored.track, 'resolvedStreamUrl'));
});

test('Progress checkpoints write at most every ten seconds; pause and shutdown keep an exact final position', () => {
  const store = memory();
  let now = 0;
  const writer = new PlaybackSessionWriter(store, () => now);
  const state = input();
  writer.save(state, true);
  for (let i = 1; i <= 39; i++) {
    now = i * 250;
    state.position = i * 0.25;
    writer.save(state);
  }
  assert.equal(store.writes, 1);
  now = 10000;
  state.position = 10;
  writer.save(state);
  assert.equal(store.writes, 2);
  state.position = 10.125;
  writer.save(state, true);
  assert.equal(store.writes, 3);
  assert.equal(readPlaybackSession(store).position, 10.125);
  writer.save(state, true);
  assert.equal(store.writes, 3);
});

test('Damaged, future-version and unavailable storage cannot prevent player startup', () => {
  for (const raw of [
    '{',
    'null',
    JSON.stringify({ version: 9, ...input() }),
    JSON.stringify({ version: 1, track: null }),
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) {
    const store = memory();
    store.data.set(PLAYBACK_SESSION_KEY, raw);
    assert.equal(readPlaybackSession(store), null);
  }
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('full');
    },
  };
  assert.equal(readPlaybackSession(broken), null);
  assert.equal(new PlaybackSessionWriter(broken).save(input(), true), false);
});

test('Large and malformed queues retain the selected occurrence and clamp invalid positions', () => {
  const store = memory(),
    state = input();
  state.queue = Array.from({ length: 2000 }, (_, i) => track('yt_' + i));
  state.queueIndex = 1700;
  state.track = state.queue[1700];
  state.position = Infinity;
  new PlaybackSessionWriter(store).save(state, true);
  let restored = readPlaybackSession(store);
  assert.equal(restored.queue.length, 500);
  assert.equal(restored.queue[restored.queueIndex].id, 'yt_1700');
  assert.equal(restored.position, 0);
  state.queue = [null, track('yt_a'), state.track, state.track];
  state.queueIndex = 3;
  state.position = 999;
  new PlaybackSessionWriter(store).save(state, true);
  restored = readPlaybackSession(store);
  assert.equal(restored.queueIndex, 2);
  assert.equal(restored.position, 180);
  state.queue = [];
  new PlaybackSessionWriter(store).save(state, true);
  restored = readPlaybackSession(store);
  assert.equal(restored.queueIndex, 0);
  assert.equal(restored.queue[0].id, state.track.id);
});

test('Restored queue hook starts with the saved cursor and modes and next insertion preserves the active track', () => {
  const store = memory();
  new PlaybackSessionWriter(store).save(input(), true);
  const restored = readPlaybackSession(store);
  const h = hookRuntime(new URL('../src/shared/hooks/useQueueManager.ts', import.meta.url), {
    '../utils/shuffleCycle': { ShuffleCycle },
    '../utils/queueEntry': queueEntries,
  });
  const api = h.render(restored);
  assert.equal(api.queue[api.queueIndex].id, 'yt_b');
  assert.equal(api.repeatMode, 'all');
  assert.equal(api.isShuffle, true);
  api.insertIntoQueue(track('yt_new'), 0);
  const result = h.render();
  assert.equal(result.queue[result.queueIndex].id, 'yt_b');
  h.unmount();
});

test('The real persistence hook saves pause, seek and window close without progress renders or leaked listeners', () => {
  const store = memory();
  let now = 0;
  const audio = new EventTarget(),
    window = new EventTarget(),
    document = new EventTarget();
  document.visibilityState = 'visible';
  const state = input();
  const getSnapshot = () => state;
  const h = hookRuntime(
    new URL('../src/shared/hooks/usePlaybackPersistence.ts', import.meta.url),
    {
      '../services/playbackSession': {
        PlaybackSessionWriter: class extends PlaybackSessionWriter {
          constructor() {
            super(store, () => now);
          }
        },
      },
    },
    { window, document },
  );
  const props = {
    audio,
    getSnapshot,
    track: state.track,
    queue: state.queue,
    queueIndex: state.queueIndex,
    repeatMode: state.repeatMode,
    isShuffle: state.isShuffle,
  };
  h.render(props);
  assert.equal(store.writes, 1);
  for (let i = 1; i <= 39; i++) {
    now = i * 250;
    state.position = i / 4;
    audio.dispatchEvent(new Event('timeupdate'));
  }
  assert.equal(store.writes, 1);
  state.position = 72.125;
  audio.dispatchEvent(new Event('pause'));
  assert.equal(readPlaybackSession(store).position, 72.125);
  state.position = 85;
  audio.dispatchEvent(new Event('seeked'));
  assert.equal(readPlaybackSession(store).position, 85);
  state.position = 90.75;
  window.dispatchEvent(new Event('beforeunload'));
  assert.equal(readPlaybackSession(store).position, 90.75);
  state.position = 92;
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(readPlaybackSession(store).position, 92);
  state.position = 93;
  h.unmount();
  assert.equal(readPlaybackSession(store).position, 93);
  const writes = store.writes;
  state.position = 94;
  audio.dispatchEvent(new Event('pause'));
  window.dispatchEvent(new Event('beforeunload'));
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(store.writes, writes);
  assert.equal(h.lateUpdates(), 0);
});

test('Missing artwork is rejected before URL parsing while supplied artwork keeps deep validation', () => {
  const OriginalURL = globalThis.URL;
  const parsed = [];
  globalThis.URL = class extends OriginalURL {
    constructor(value, ...rest) {
      parsed.push(value);
      super(value, ...rest);
    }
  };
  try {
    const state = input();
    const bare = {
      id: 'yt_empty',
      title: 'No artwork',
      source: 'youtube',
      duration: 10,
      artist: { name: 'A' },
      album: { title: 'B' },
    };
    state.track = bare;
    state.queue = [bare];
    state.queueIndex = 0;
    const store = memory();
    assert.equal(new PlaybackSessionWriter(store).save(state, true), true);
    assert.deepEqual(parsed, []);
    bare.artist.picture = 'https://images.example/artist.jpg';
    bare.artist.picture_medium = '';
    bare.album.cover = 'https://rr1.googlevideo.com/videoplayback?signature=secret';
    bare.album.cover_small = 'blob:https://example.test/temporary';
    bare.album.cover_medium = 'https://user:secret@example.test/image';
    bare.album.cover_big = 'not an absolute url';
    bare.album.cover_xl = 'file:///stable-cover.jpg';
    bare.cover_url = 'javascript:alert(1)';
    assert.equal(new PlaybackSessionWriter(store).save(state, true), true);
    const restored = readPlaybackSession(store);
    assert.equal(restored.track.artist.picture, 'https://images.example/artist.jpg');
    assert.equal(restored.track.album.cover_xl, 'file:///stable-cover.jpg');
    for (const field of ['cover', 'cover_small', 'cover_medium', 'cover_big'])
      assert.equal(restored.track.album[field], undefined);
    assert.equal(restored.track.cover_url, undefined);
    assert.ok(parsed.every((value) => value !== ''));
    assert.ok(!store.getItem(PLAYBACK_SESSION_KEY).includes('secret'));
  } finally {
    globalThis.URL = OriginalURL;
  }
});

test('Repeated checkpoints revalidate nested metadata when the same queue and track objects change', () => {
  const store = memory(),
    writer = new PlaybackSessionWriter(store),
    state = input();
  writer.save(state, true);
  state.queue[0].title = 'Updated title';
  state.queue[0].artist.picture = 'https://images.example/fresh.jpg';
  state.track.album.cover = 'https://user:secret@example.test/changed.jpg';
  state.position = 62;
  assert.equal(writer.save(state, true), true);
  const restored = readPlaybackSession(store);
  assert.equal(restored.queue[0].title, 'Updated title');
  assert.equal(restored.queue[0].artist.picture, 'https://images.example/fresh.jpg');
  assert.equal(restored.track.album.cover, undefined);
  assert.equal(restored.position, 62);
  assert.ok(!store.getItem(PLAYBACK_SESSION_KEY).includes('secret'));
});

test('Artwork validation is shared within a snapshot and discarded before the next checkpoint', () => {
  const OriginalURL = globalThis.URL,
    parsed = [];
  globalThis.URL = class extends OriginalURL {
    constructor(value, ...rest) {
      parsed.push(value);
      super(value, ...rest);
    }
  };
  try {
    const state = input(),
      store = memory(),
      writer = new PlaybackSessionWriter(store);
    const stable = 'https://images.example/shared.jpg',
      unsafe = 'https://user:secret@example.test/shared.jpg';
    for (const item of [state.track, ...state.queue]) {
      item.artist.picture = stable;
      item.artist.picture_medium = stable;
      item.album.cover = stable;
      item.album.cover_big = unsafe;
      item.cover_url = unsafe;
    }
    writer.save(state, true);
    assert.equal(parsed.filter((value) => value === stable).length, 1);
    assert.equal(parsed.filter((value) => value === unsafe).length, 1);
    parsed.length = 0;
    state.position = 63;
    writer.save(state, true);
    assert.equal(parsed.filter((value) => value === stable).length, 1);
    assert.equal(parsed.filter((value) => value === unsafe).length, 1);
    assert.ok(!store.getItem(PLAYBACK_SESSION_KEY).includes('secret'));
  } finally {
    globalThis.URL = OriginalURL;
  }
});
