import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioCrossfade } from '../src/shared/services/audioCrossfade.ts';
import { loadGenreCatalog } from '../src/shared/services/genreCatalog.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';

const fakeAudio = (position = 15) => ({
  currentTime: position,
  duration: 18,
  volume: 0.8,
  paused: false,
  ended: false,
  error: null,
  released: false,
  pause() {
    this.paused = true;
  },
  removeAttribute() {
    this.released = true;
  },
  load() {},
});

test('YouTube search ignores C and POSIX process locales instead of sending invalid language codes', () => {
  const originalLang = process.env.LANG;
  try {
    for (const locale of ['C.UTF-8', 'POSIX', 'und']) {
      process.env.LANG = locale;
      const client = YouTubeMusicService.getClientContext().client;
      assert.match(client.hl, /^[a-z]{2,3}$/);
      assert.notEqual(client.hl, 'und');
    }
  } finally {
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }
});

test('Crossfade retains outgoing audio until incoming plays, overlaps volumes, and releases its stream', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const outgoing = fakeAudio();
  const incoming = fakeAudio(0);
  const transition = new AudioCrossfade();
  let disposed = 0;
  transition.hold(outgoing, () => disposed++);
  assert.equal(outgoing.paused, false, 'Resolver latency must not silence outgoing playback');
  transition.start(incoming, 3, () => 0.8);
  now = 1500;
  t.mock.timers.tick(25);
  assert.ok(outgoing.volume > 0 && incoming.volume > 0);
  assert.ok(Math.abs(outgoing.volume ** 2 + incoming.volume ** 2 - 0.8 ** 2) < 0.001);
  now = 3000;
  t.mock.timers.tick(25);
  assert.equal(incoming.volume, 0.8);
  assert.equal(outgoing.paused, true);
  assert.equal(outgoing.released, true);
  assert.equal(disposed, 1);
  assert.equal(transition.active, false);
});

test('Crossfade mute and pause stop both sources from leaking outgoing audio', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const transition = new AudioCrossfade();
  const outgoing = fakeAudio();
  const incoming = fakeAudio(0);
  transition.hold(outgoing);
  transition.start(incoming, 3, () => 0);
  t.mock.timers.tick(25);
  assert.equal(outgoing.volume, 0);
  assert.equal(incoming.volume, 0);
  incoming.paused = true;
  t.mock.timers.tick(25);
  assert.equal(outgoing.paused, true);
  assert.equal(transition.active, false);
});

test('YouTube genre catalog uses exact curated songs and rejects covers and title-only false matches', async () => {
  const queries = [];
  const result = await loadGenreCatalog(8, 'youtube', {
    soundcloud: async () => {
      throw Error('SoundCloud must not be required for YouTube');
    },
    youtube: async (query) => {
      queries.push(query);
      return {
        data: [
          {
            id: 'bad',
            source: 'youtube',
            title: 'Smells Like Teen Spirit (cover)',
            artist: { name: 'Nirvana' },
            duration: 300,
          },
          {
            id: 'wrong',
            source: 'youtube',
            title: 'Creep',
            artist: { name: 'Wrong artist' },
            duration: 200,
          },
          {
            id: 'yt_nirvana',
            source: 'youtube',
            title: 'Smells Like Teen Spirit',
            artist: { name: 'Nirvana' },
            duration: 302,
          },
          {
            id: 'yt_radiohead',
            source: 'youtube',
            title: 'Creep',
            artist: { name: 'Radiohead' },
            duration: 238,
          },
        ],
      };
    },
  });
  assert.deepEqual(
    result.data.map((track) => track.id),
    ['yt_nirvana', 'yt_radiohead'],
  );
  assert.ok(queries.includes('Nirvana - Smells Like Teen Spirit'));
  assert.ok(queries.includes('Radiohead - Creep'));
  assert.ok(queries.includes('Deftones') && queries.includes('Muse'));
});

test('Genre catalog survives either provider failing and preserves SoundCloud-only selection', async () => {
  const track = {
    id: 'sc1',
    title: 'Genre track',
    artist: { name: 'Artist' },
    source: 'soundcloud',
    duration: 200,
    genre: 'alternative rock',
  };
  const providers = {
    soundcloud: async () => ({ data: [track] }),
    youtube: async () => {
      throw Error('offline');
    },
  };
  assert.deepEqual((await loadGenreCatalog(8, 'all', providers)).data, [track]);
  assert.deepEqual(
    (
      await loadGenreCatalog(8, 'soundcloud', {
        ...providers,
        youtube: () => {
          assert.fail('Must not query YouTube');
        },
      })
    ).data,
    [track],
  );
  assert.deepEqual((await loadGenreCatalog(999, 'all', providers)).data, []);
});

test('Playlist membership lookup returns only playlist IDs and treats track ID as data', async () => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  try {
    const first = db.createPlaylist('First');
    const second = db.createPlaylist('Second');
    const empty = db.createPlaylist('Empty');
    const track = {
      id: "yt_' OR 1=1 --",
      title: 'Track',
      artist: 'Artist',
      duration: 180,
      source: 'youtube',
    };
    db.addTrackToPlaylist(first.id, { ...track, deezer_id: track.id });
    db.addTrackToPlaylist(second.id, { ...track, deezer_id: track.id });
    assert.deepEqual(new Set(db.getTrackPlaylistIds(track.id)), new Set([first.id, second.id]));
    assert.deepEqual(db.getTrackPlaylistIds('missing'), []);
    assert.ok(!db.getTrackPlaylistIds(track.id).includes(empty.id));
  } finally {
    db.db?.close();
  }
});
