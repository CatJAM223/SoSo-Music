import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlaylistLink,
  readExternalPlaylist,
  parseVkTrack,
  parseYandexTrack,
} from '../src/shared/services/externalPlaylist.ts';
import {
  matchImportedTrack,
  matchImportedPlaylist,
  scoreImportCandidate,
  saveImportedPlaylist,
} from '../src/shared/services/playlistImport.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

const original = { id: '1', title: 'Captain', artist: 'Miyagi', duration: 215 };
const track = (source, extra = {}) => ({
  id: source === 'youtube' ? 'yt_abcdefghijk' : 'sc_123',
  title: 'Captain',
  artist: { name: 'Miyagi' },
  album: { title: 'Album' },
  duration: 215,
  preview: '',
  source,
  ...extra,
});
const playlist = {
  source: 'vk',
  url: 'https://vk.ru/audio_playlist305328431_14',
  title: 'Music',
  tracks: [original],
};

test('Playlist import: accepts old/new Yandex and VK shared/mobile playlist URLs', () => {
  assert.equal(
    parsePlaylistLink('https://music.yandex.ru/users/yamusic-top/playlists/1000').owner,
    'yamusic-top',
  );
  assert.equal(
    parsePlaylistLink(
      'https://music.yandex.ru/playlists/ge.d7aed00b-5de3-4973-873d-a950bd03e0fb?utm_source=share',
    ).uuid,
    'ge.d7aed00b-5de3-4973-873d-a950bd03e0fb',
  );
  assert.equal(parsePlaylistLink(playlist.url).owner, '305328431');
  assert.equal(parsePlaylistLink('https://vk.com/music/playlist/-1_14_aabb').hash, 'aabb');
  assert.equal(
    parsePlaylistLink('https://m.vk.ru/audio?act=audio_playlist305328431_14&access_hash=aabb').hash,
    'aabb',
  );
});

test('Playlist import: rejects arbitrary hosts, credentials, ports and malformed links before fetching', async () => {
  for (const url of [
    'file:///C:/windows',
    'https://localhost/playlist',
    'https://vk.ru.evil.com/audio_playlist1_2',
    'https://u:p@vk.ru/audio_playlist1_2',
    'https://vk.ru:8000/audio_playlist1_2',
    'https://music.yandex.ru/users/%2e%2e%2fadmin/playlists/1',
    'https://music.yandex.ru/playlists/aaaaaaaa-aaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ]) {
    let calls = 0;
    const result = await readExternalPlaylist(url, async () => {
      calls++;
      return '{}';
    });
    assert.equal(result.success, false, url);
    assert.equal(result.code, 'invalid_url', url);
    assert.equal(calls, 0);
  }
});

test('Playlist import: Yandex preserves order, recording versions and metadata', async () => {
  const result = await readExternalPlaylist(
    'https://music.yandex.ru/users/test/playlists/1',
    async () =>
      JSON.stringify({
        result: {
          title: 'Rock &amp; roll',
          trackCount: 2,
          tracks: [
            {
              track: {
                id: 'b',
                title: 'Song',
                version: 'Live',
                artists: [{ name: 'A' }, { name: 'B' }],
                durationMs: 215000,
              },
            },
            { track: { id: 'a', title: 'Second', artists: [{ name: 'C' }], durationMs: 190000 } },
          ],
        },
      }),
  );
  assert.equal(result.success, true);
  assert.equal(result.data.title, 'Rock & roll');
  assert.deepEqual(
    result.data.tracks.map((t) => t.id),
    ['b', 'a'],
  );
  assert.equal(result.data.tracks[0].title, 'Song — Live');
  assert.equal(result.data.tracks[0].artist, 'A, B');
  assert.equal(result.data.tracks[0].duration, 215);
});

test('Playlist import: Yandex hydrates IDs without changing playlist order', async () => {
  const result = await readExternalPlaylist(
    'https://music.yandex.ru/users/test/playlists/1',
    async (url, options) => {
      if (!url.endsWith('/tracks'))
        return JSON.stringify({
          result: { title: 'Music', trackCount: 2, tracks: [{ id: 'a' }, { id: 'b' }] },
        });
      assert.equal(new URLSearchParams(options.body).get('track-ids'), 'a,b');
      return JSON.stringify({
        result: [
          { id: 'b', title: 'Second', artists: [{ name: 'B' }] },
          { id: 'a', title: 'First', artists: [{ name: 'A' }] },
        ],
      });
    },
  );
  assert.deepEqual(
    result.data.tracks.map((t) => t.title),
    ['First', 'Second'],
  );
});

test('Playlist import: refuses truncated or inaccessible Yandex playlists', async () => {
  const result = await readExternalPlaylist(
    'https://music.yandex.ru/users/test/playlists/1',
    async () =>
      JSON.stringify({
        result: { title: 'Music', trackCount: 2, tracks: [{ track: { id: 'a', title: 'First' } }] },
      }),
  );
  assert.equal(result.success, false);
  assert.equal(result.code, 'incomplete');
  const denied = await readExternalPlaylist(
    'https://music.yandex.ru/users/test/playlists/1',
    async () => JSON.stringify({ error: { name: 'access-denied' } }),
  );
  assert.equal(denied.code, 'access');
});

test('Playlist import: VK loads every page and decodes names without resolving audio URLs', async () => {
  const offsets = [];
  const result = await readExternalPlaylist(playlist.url, async (url, options) => {
    assert.equal(url, 'https://m.vk.ru/audio');
    const offset = Number(new URLSearchParams(options.body).get('offset'));
    offsets.push(offset);
    return JSON.stringify({
      data: [
        {
          title: 'VK songs',
          list:
            offset === 0
              ? [
                  [1, 2, 'unused', 'First &amp; song', 'Artist', 215],
                  [2, 2, 'unused', 'Second', 'Artist', 180],
                ]
              : [[3, 2, 'unused', 'Third', 'Artist', 190]],
          hasMore: offset === 0,
          totalCount: 3,
        },
      ],
    });
  });
  assert.equal(result.success, true);
  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(
    result.data.tracks.map((t) => t.title),
    ['First & song', 'Second', 'Third'],
  );
  assert.equal(result.data.tracks[0].duration, 215);
});

test('Playlist import: VK login redirect, repeat pages, incomplete rows and network failure are explicit', async () => {
  const login = await readExternalPlaylist(playlist.url, async () =>
    JSON.stringify({ location: 'https://login.vk.ru' }),
  );
  assert.equal(login.code, 'access');
  const loop = await readExternalPlaylist(playlist.url, async () =>
    JSON.stringify({ data: [{ list: [[1, 2, '', 'Song', 'Artist', 180]], hasMore: true }] }),
  );
  assert.equal(loop.code, 'incomplete');
  const incomplete = await readExternalPlaylist(playlist.url, async () =>
    JSON.stringify({ data: [{ list: [[1, 2]], hasMore: false }] }),
  );
  assert.equal(incomplete.code, 'incomplete');
  const network = await readExternalPlaylist(playlist.url, async () => {
    throw new Error('offline');
  });
  assert.equal(network.code, 'network');
});

for (const priority of ['soundcloud', 'youtube']) {
  test(`Playlist import: ${priority} priority wins and avoids unnecessary fallback search`, async () => {
    const calls = [];
    const result = await matchImportedTrack(original, priority, async (_q, _limit, source) => {
      calls.push(source);
      return { data: [track(source)] };
    });
    assert.equal(result.track.source, priority);
    assert.equal(result.status, 'matched');
    assert.deepEqual(calls, [priority]);
  });
}

test('Playlist import: wrong versions and wrong artists cannot win by source priority', async () => {
  const result = await matchImportedTrack(original, 'soundcloud', async (_q, _limit, source) => ({
    data:
      source === 'soundcloud'
        ? [
            track(source, { title: 'Captain (Remix)' }),
            track(source, { artist: { name: 'Other Artist' } }),
          ]
        : [track(source)],
  }));
  assert.equal(result.track.source, 'youtube');
  for (const title of [
    'Captain (Live)',
    'Captain (Cover)',
    'Captain (Slowed)',
    'Captain Karaoke',
    'Captain Sped Up',
  ])
    assert.equal(scoreImportCandidate(original, track('youtube', { title })).score, 0, title);
  assert.equal(scoreImportCandidate(original, track('youtube', { duration: 30 })).score, 0);
});

test('Playlist import: reuploads with artist in title match, uncertain durations require review', async () => {
  assert.equal(
    scoreImportCandidate(
      original,
      track('soundcloud', {
        title: 'Miyagi - Captain (Official Audio)',
        artist: { name: 'Uploader' },
      }),
    ).confident,
    true,
  );
  const result = await matchImportedTrack(original, 'youtube', async (_q, _limit, source) => ({
    data: [track(source, { duration: 229 })],
  }));
  assert.equal(result.status, 'review');
  assert.equal(result.track, undefined);
  assert.equal(result.candidates.length, 2);
});

test('Playlist import: a provider error still permits fallback and remains distinct from no matches', async () => {
  const result = await matchImportedTrack(original, 'youtube', async (_q, _limit, source) => {
    if (source === 'youtube') throw new Error('timeout');
    return { data: [track(source)] };
  });
  assert.equal(result.track.source, 'soundcloud');
  const failed = await matchImportedTrack(original, 'youtube', async () => {
    throw new Error('timeout');
  });
  assert.equal(failed.status, 'error');
  const missing = await matchImportedTrack(original, 'youtube', async () => ({ data: [] }));
  assert.equal(missing.status, 'missing');
});

test('Playlist import: concurrent search preserves order and cancellation stops fallback', async () => {
  const batch = { ...playlist, tracks: [original, { ...original, id: '2', title: 'Second' }] };
  const progress = [];
  const results = await matchImportedPlaylist(
    batch,
    'soundcloud',
    async (query, _limit, source) => {
      if (query.includes('Captain')) await new Promise((r) => setTimeout(r, 20));
      return {
        data: [
          track(source, { id: query, title: query.includes('Captain') ? 'Captain' : 'Second' }),
        ],
      };
    },
    (_matches, count) => progress.push(count),
  );
  assert.deepEqual(
    results.map((r) => r.original.id),
    ['1', '2'],
  );
  assert.deepEqual(progress, [1, 2]);
  const controller = new AbortController();
  let calls = 0;
  const promise = matchImportedTrack(
    original,
    'youtube',
    async () => {
      calls++;
      return new Promise(() => {});
    },
    controller.signal,
  );
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('Playlist import: selected tracks save to SQLite in original order with valid source IDs', async () => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  const first = track('soundcloud');
  const second = track('youtube', { title: 'Second' });
  const matches = [
    { original, track: first },
    { original, status: 'missing' },
    { original, track: second },
    { original, track: first },
  ];
  const result = await saveImportedPlaylist('Imported', playlist, matches, {
    createPlaylist: async (...args) => db.createPlaylist(...args),
    addTrackToPlaylist: async (...args) => db.addTrackToPlaylist(...args),
    deletePlaylist: async (...args) => db.deletePlaylist(...args),
  });
  assert.equal(result.count, 2);
  const saved = db.getPlaylistTracks(result.id);
  assert.deepEqual(
    saved.map((t) => t.track_deezer_id),
    ['sc_123', 'yt_abcdefghijk'],
  );
  assert.deepEqual(
    saved.map((t) => t.artist),
    ['Miyagi', 'Miyagi'],
  );
  assert.deepEqual(
    saved.map((t) => t.title),
    ['Captain', 'Second'],
  );
});

test('Playlist import: failed save removes only the newly created playlist', async () => {
  const removed = [];
  await assert.rejects(
    saveImportedPlaylist('Imported', playlist, [{ original, track: track('youtube') }], {
      createPlaylist: async () => 'new-only',
      addTrackToPlaylist: async () => false,
      deletePlaylist: async (id) => {
        removed.push(id);
        return true;
      },
    }),
    /Не удалось сохранить/,
  );
  assert.deepEqual(removed, ['new-only']);
  let created = false;
  await assert.rejects(
    saveImportedPlaylist('Imported', playlist, [], {
      createPlaylist: async () => {
        created = true;
        return 'id';
      },
    }),
    /Выберите/,
  );
  assert.equal(created, false);
});
