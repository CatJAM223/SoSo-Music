import test from 'node:test';
import assert from 'node:assert/strict';
import { readExternalPlaylist } from '../src/shared/services/externalPlaylist.ts';
import {
  attachPlaylistCover,
  isVkCoverUrl,
} from '../src/desktop/main/services/playlistImportCover.ts';
import { saveImportedPlaylist } from '../src/shared/services/playlistImport.ts';
import { playlistDescription } from '../src/shared/utils/playlistDescription.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

const url = 'https://vk.ru/audio_playlist305328431_14';
const cover = 'https://sun9-1.userapi.com/playlist.jpg';
const dataUrl = 'data:image/jpeg;base64,aW1hZ2U=';
const playlist = { source: 'vk', url, title: 'VK songs', tracks: [], coverUrl: cover };

test('VK artwork survives pagination and is read beside desktop playlist metadata', async () => {
  const result = await readExternalPlaylist(url, async (_url, options) => {
    const offset = Number(new URLSearchParams(options.body).get('offset'));
    return JSON.stringify({
      data: [
        {
          playlist: {
            id: 14,
            ownerId: 305328431,
            title: 'VK songs',
            ...(offset ? {} : { thumb: { photo_68: 'small', photo_600: cover } }),
            totalCount: 2,
            hasMore: !offset,
          },
          list: [[offset + 1, 1, '', 'Song', 'Artist', 180]],
        },
      ],
    });
  });
  assert.equal(result.success, true);
  assert.equal(result.data.coverUrl, cover);
  assert.equal(result.data.tracks.length, 2);
});

test('VK artwork is downloaded once and returned as a bounded local image', async () => {
  let calls = 0;
  const result = await attachPlaylistCover(
    { success: true, data: playlist },
    async (url, init) => {
      calls++;
      assert.equal(url, cover);
      assert.equal(init.redirect, 'error');
      return new Response('image', { headers: { 'content-type': 'image/jpeg' } });
    },
    (bytes) => {
      assert.equal(bytes.toString(), 'image');
      return dataUrl;
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.data.coverUrl, dataUrl);
  assert.equal(result.data.title, playlist.title);
});

test('Missing, unsafe, oversized and invalid artwork preserve the successful track list', async () => {
  for (const url of [
    'http://userapi.com/a',
    'https://userapi.com.evil.test/a',
    'https://localhost/a',
    'file:///a',
    'https://u:p@userapi.com/a',
    'https://userapi.com:8080/a',
  ])
    assert.equal(isVkCoverUrl(url), false);
  let requests = 0;
  const invalid = await attachPlaylistCover(
    { success: true, data: { ...playlist, coverUrl: 'https://localhost/a' } },
    async () => {
      requests++;
    },
    () => dataUrl,
  );
  assert.equal(requests, 0);
  assert.equal(invalid.success, true);
  assert.equal(invalid.data.coverUrl, undefined);
  for (const response of [
    new Response('error', { status: 404 }),
    new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response('image', {
      headers: { 'content-type': 'image/jpeg', 'content-length': '11000000' },
    }),
  ]) {
    const result = await attachPlaylistCover(
      { success: true, data: playlist },
      async () => response,
      () => {
        throw new Error('Should not decode');
      },
    );
    assert.equal(result.success, true);
    assert.equal(result.data.coverUrl, undefined);
  }
  const decodeFailure = await attachPlaylistCover(
    { success: true, data: playlist },
    async () => new Response('bad', { headers: { 'content-type': 'image/png' } }),
    () => {
      throw new Error('Invalid image');
    },
  );
  assert.equal(decodeFailure.data.coverUrl, undefined);
});

test('Imported cover, simple provenance and tracks persist together in SQLite', async () => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  const track = {
    id: 'sc_123',
    title: 'Song',
    artist: { name: 'Artist' },
    duration: 180,
    source: 'soundcloud',
  };
  const saved = await saveImportedPlaylist(
    'Imported',
    { ...playlist, coverUrl: dataUrl },
    [{ track }],
    {
      createPlaylist: async (...args) => db.createPlaylist(...args),
      setPlaylistCover: async (...args) => db.setPlaylistCover(...args),
      addTrackToPlaylist: async (...args) => db.addTrackToPlaylist(...args),
      deletePlaylist: async (...args) => db.deletePlaylist(...args),
    },
  );
  const entry = db.getPlaylists().find((p) => p.id === saved.id);
  assert.equal(entry.cover_url, dataUrl);
  assert.equal(entry.description, 'Перенесено с VK Музыки');
  assert.equal(db.getPlaylistTracks(saved.id).length, 1);
  const removed = [];
  await assert.rejects(
    saveImportedPlaylist('Imported', { ...playlist, coverUrl: dataUrl }, [{ track }], {
      createPlaylist: async () => 'new',
      setPlaylistCover: async () => false,
      addTrackToPlaylist: async () => {
        throw new Error('Should not add');
      },
      deletePlaylist: async (id) => {
        removed.push(id);
        return true;
      },
    }),
    /обложку/,
  );
  assert.deepEqual(removed, ['new']);
});

test('Legacy generated links disappear while personal playlist descriptions remain intact', () => {
  assert.equal(playlistDescription(`Перенесено из VK Музыки: ${url}`), 'Перенесено с VK Музыки');
  assert.equal(
    playlistDescription(`Перенесено из Яндекс Музыки: https://music.yandex.ru/playlists/test`),
    'Перенесено с Яндекс Музыки',
  );
  assert.equal(playlistDescription('Мой плейлист https://vk.ru/'), 'Мой плейлист https://vk.ru/');
});
