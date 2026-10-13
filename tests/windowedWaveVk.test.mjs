import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readVkPlaylist,
  parsePlaylistLink,
  readExternalPlaylist,
} from '../src/shared/services/externalPlaylist.ts';
import { isVkImportUrl, isVkPlaylistPage } from '../src/desktop/main/services/vkImportPolicy.ts';
import {
  getWaveArtistKeys,
  getWaveArtistNames,
  matchesWaveArtist,
} from '../src/shared/utils/waveIdentity.ts';
import { isWaveMixOrPodcast } from '../src/shared/utils/waveQueue.ts';
import { transformSCTrack } from '../src/shared/services/parsers/soundCloudParser.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';

const make = (id, title, artist) => ({
  id,
  title,
  artist: { name: artist },
  duration: 210,
  source: 'soundcloud',
});
const url = 'https://vk.ru/audio_playlist305328431_14';

test('VK desktop wrapper preserves rows, title and pagination beside playlist metadata', async () => {
  const offsets = [];
  const result = await readVkPlaylist(
    parsePlaylistLink(url),
    async (endpoint, options) => {
      assert.equal(endpoint, 'https://vk.ru/al_audio.php');
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('owner_id'), '305328431');
      assert.equal(params.get('playlist_id'), '14');
      assert.equal(params.get('al'), '1');
      const offset = Number(params.get('offset'));
      offsets.push(offset);
      return (
        '<!json>' +
        JSON.stringify({
          payload: [
            0,
            [
              {
                playlist: { id: 14, ownerId: 305328431, title: 'My &amp; songs', totalCount: 2 },
                list: [[offset + 1, 305328431, '', `Song ${offset + 1}`, 'Artist', 180]],
              },
            ],
          ],
        })
      );
    },
    true,
  );
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(result.title, 'My & songs');
  assert.deepEqual(
    result.tracks.map((t) => t.title),
    ['Song 1', 'Song 2'],
  );
});

test('VK nested playlist payload and wrong-playlist responses remain distinct', async () => {
  const nested = await readExternalPlaylist(url, async () =>
    JSON.stringify({
      payload: [0, [{ playlist: { list: [[1, 2, '', 'Song', 'Artist', 180]], hasMore: false } }]],
    }),
  );
  assert.equal(nested.success, true);
  const wrong = await readExternalPlaylist(url, async () =>
    JSON.stringify({ data: [{ id: 15, ownerId: 305328431, list: [] }] }),
  );
  assert.equal(wrong.success, false);
  assert.equal(wrong.code, 'access');
});

test('VK login allows VK ID and rejects external, spoofed and non-HTTPS navigation', () => {
  for (const allowed of [
    'https://id.vk.ru/auth',
    'https://oauth.vk.com/authorize',
    url,
    'https://vk.id/',
  ])
    assert.equal(isVkImportUrl(allowed), true);
  for (const denied of [
    'http://vk.ru/',
    'https://vk.ru.evil.example/',
    'https://evilvk.ru/',
    'https://user@vk.ru/',
    'https://vk.ru:444/',
    'file:///C:/test',
    'javascript:alert(1)',
  ])
    assert.equal(isVkImportUrl(denied), false);
  assert.equal(isVkPlaylistPage(url), true);
  assert.equal(isVkPlaylistPage('https://vk.ru/?to=playlist'), false);
  assert.equal(isVkPlaylistPage('https://id.vk.ru/auth'), false);
});

test('Wave does not infer title words, numeric credits or producers as performers', () => {
  assert.deepEqual(getWaveArtistKeys(make('a', 'Strah i Trepet', 'Rasta и Link'), ['trepet']), [
    'rasta',
    'link',
  ]);
  assert.deepEqual(getWaveArtistKeys(make('b', 'project 666', 'tewiq, GLORYOVISION'), ['666']), [
    'tewiq',
    'gloryovision',
  ]);
  assert.deepEqual(
    getWaveArtistKeys(make('c', 'Fallen Angel (prod. greyrock)', 'TER'), ['greyrock']),
    ['ter'],
  );
  assert.deepEqual(getWaveArtistNames(make('d', 'холодное оружие w/rizza', 'Sqwore')), [
    'Sqwore',
    'rizza',
  ]);
  assert.equal(
    matchesWaveArtist(make('e', 'Nirvana - Heart-Shaped Box (piano cover)', 'Pianist'), 'Nirvana'),
    false,
  );
});

test('Wave filters Russian compilations but preserves actual remixes and normal songs', () => {
  for (const title of ['паранойя гуфи микс III', 'Phonk сборник', 'DJ Mix 2026'])
    assert.equal(isWaveMixOrPodcast({ title, duration: 459 }), true);
  for (const title of ['Song (Remix)', 'Химикс', 'Mixture'])
    assert.equal(isWaveMixOrPodcast({ title, duration: 200 }), false);
});

test('SoundCloud excludes explicitly unavailable records, retaining metadata-only records', () => {
  const base = { id: 1, title: 'Song', duration: 180000 };
  assert.equal(transformSCTrack({ ...base, streamable: false }), null);
  assert.equal(transformSCTrack({ ...base, media: { transcodings: [] } }), null);
  assert.ok(transformSCTrack(base));
});

test('Wave fallback verifies the requested artist before accepting unrelated covers', async (t) => {
  t.mock.method(SoundCloudService, 'search', async (query) => ({
    data: [
      make(`wrong_${query}`, 'Heart-Shaped Box', 'Cello player'),
      make(`good_${query}`, 'Fresh song', query),
    ],
  }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  const result = await WaveEngine.getWaveBatch('default', []);
  assert.ok(result.length > 0);
  assert.ok(result.every((track) => track.id.startsWith('good_')));
});
