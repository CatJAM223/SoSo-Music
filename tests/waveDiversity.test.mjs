import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWaveArtistNames,
  getWaveArtistKeys,
  buildWaveSongIdentity,
  areSameWaveSong,
  matchesWaveArtist,
} from '../src/shared/utils/waveIdentity.ts';
import {
  sequenceWaveTracks,
  resequenceWaveQueue,
  isWaveTempoEdit,
} from '../src/shared/utils/waveQueue.ts';
import { createWaveMemory, WAVE_PLAYED_TTL } from '../src/shared/services/waveMemory.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';

const make = (id, title, artist, duration = 200) => ({
  id,
  title,
  artist: { name: artist },
  duration,
  source: 'soundcloud',
});

test('Wave counts collaborators and embedded credits without splitting band names', () => {
  assert.deepEqual(getWaveArtistNames('greyrock, tewiq и madk1d'), ['greyrock', 'tewiq', 'madk1d']);
  assert.deepEqual(
    getWaveArtistNames(make('1', 'айсберг (feat. тёмный принц)', 'greyrock и tewiq')),
    ['greyrock', 'tewiq', 'тёмный принц'],
  );
  for (const band of [
    'AC/DC',
    'Earth, Wind & Fire',
    'Король и Шут',
    'Taylor Swift',
    'succubus/club',
  ]) {
    assert.deepEqual(getWaveArtistNames(band), [band]);
  }
  assert.ok(
    getWaveArtistKeys(make('2', 'MADK1D VILLIAN 8 миля', 'sodi'), ['madk1d']).includes('madk1d'),
  );
});

test('Wave artist search accepts credited re-uploads and rejects unrelated videos', () => {
  assert.equal(
    matchesWaveArtist(make('1', 'Madk1d/CUPSIZE- ВирусИ)', 'Desomorph1ne'), 'madk1d'),
    true,
  );
  assert.equal(matchesWaveArtist(make('2', 'Minecraft Parody', 'Twi Shorts'), 'madk1d'), false);
  assert.equal(matchesWaveArtist(make('3', 'Something', 'Madk1dFan'), 'madk1d'), false);
});

test('Wave offers one version of MARTINE ROSE, preferring the ordinary track', () => {
  const original = make(
    'original',
    'madk1d, tewiq, 2kizz & greyrock — MARTINE ROSE',
    'madk1d, tewiq, 2kizz & greyrock',
    111,
  );
  const alternate = make('alternate', 'MARTIN ROSE + madk1d, tewiq', 'greyrock', 138);
  const nightcore = make(
    'nightcore',
    'martine rose (madk1d, greyrock, tewiq alt ver) nightcore+bassboost',
    'sheggan, madk1d, tewiq, greyrock',
    122,
  );
  const tracks = [nightcore, original, alternate, make('other', 'Fresh song', 'New musician')];
  const result = sequenceWaveTracks(tracks, 'default', ['madk1d', 'greyrock', 'tewiq']);
  assert.equal(result[0].id, 'original');
  assert.deepEqual(new Set(result.map((track) => track.id)), new Set(['original', 'other']));
  assert.equal(isWaveTempoEdit(nightcore), true);
});

test('Wave groups Jealous and распять versions but preserves unrelated songs with the same title', () => {
  const pairs = [
    [
      make(
        'a',
        '9mice & ЕГОР КРИД & тёмный принц & madk1d — Jealous (Зависть)',
        '9mice & Егор Крид & тёмный принц & madk1d',
      ),
      make(
        'b',
        '9mice & тёмный принц & madk1d — Jealous (без Крида)',
        '9mice & тёмный принц & madk1d',
      ),
    ],
    [
      make('a', 'распять', 'greyrock, tewiq и madk1d', 120),
      make('b', 'все хотят меня распять', 'Madk1d Greyrock Tewiq, Пошлая Молли', 104),
    ],
  ];
  for (const [a, b] of pairs) {
    const names = [...getWaveArtistNames(a), ...getWaveArtistNames(b)];
    assert.equal(
      areSameWaveSong(buildWaveSongIdentity(a, names), buildWaveSongIdentity(b, names)),
      true,
    );
  }
  const homonyms = [make('nf', 'Wait', 'NF'), make('earshot', 'Wait', 'Earshot')];
  assert.equal(sequenceWaveTracks(homonyms, 'default', []).length, 2);
});

test('Skipped collaborator moves down the existing queue; history and current index stay intact', () => {
  const history = make('past', 'Past song', 'Other');
  const current = make('current', 'распять', 'greyrock, tewiq и madk1d');
  const queue = [
    history,
    current,
    make('collab', 'Unheard collaboration', 'madk1d & тёмный принц'),
    make('edit', 'распять (slowed + reverb)', 'greyrock, tewiq и madk1d', 145),
    make('fresh1', 'New chapter', 'Another'),
    make('fresh2', 'Distant shores', 'Third'),
  ];
  const result = resequenceWaveQueue(queue, 1, 'default', ['madk1d'], new Map([['madk1d', -3]]));
  assert.equal(result[0], history);
  assert.equal(result[1], current);
  assert.equal(result[2].id, 'fresh1');
  assert.equal(result.at(-1).id, 'collab');
  assert.ok(!result.some((track) => track.id === 'edit'));
  assert.deepEqual(
    queue.map((track) => track.id),
    ['past', 'current', 'collab', 'edit', 'fresh1', 'fresh2'],
  );
});

test('Wave removes AMVs, parodies and snippets but keeps ordinary music videos and remixes', () => {
  const titles = [
    'Naruto AMV - Blood // Water',
    'Creative - Golden Minecraft Parody',
    'Alive Snippet',
    'Song (Official Music Video)',
    'Song (Folk Remix)',
  ];
  const result = sequenceWaveTracks(
    titles.map((title, index) => make(String(index), title, `Artist ${index}`)),
    'mix',
    [],
  );
  assert.deepEqual(new Set(result.map((track) => track.id)), new Set(['3', '4']));
});

test('Desktop wave splits seed artists and excludes irrelevant search results before accepting a quota', async (t) => {
  const queries = [];
  t.mock.method(SoundCloudService, 'search', async (query) => {
    queries.push(query);
    return {
      data: [
        make(`junk_${query}`, 'Minecraft Parody', 'Twi Shorts'),
        make(`wrong_${query}`, 'Random unrelated song', 'Unrelated'),
        make(`good_${query}`, `Fresh tune ${query}`, query),
      ],
    };
  });
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  const result = await WaveEngine.getWaveBatch('mix', [
    make('seed', 'Seed title', 'Diversity A & Diversity B'),
  ]);
  assert.ok(queries.includes('Diversity A') && queries.includes('Diversity B'));
  assert.ok(!queries.some((query) => query.includes('Seed title')));
  assert.ok(result.length > 0);
  assert.ok(result.every((track) => track.id.startsWith('good_')));
});

test('Desktop wave rotates the first artist instead of anchoring every batch to them', async (t) => {
  const queries = [];
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
  t.mock.method(SoundCloudService, 'search', async (artist) => {
    queries.push(artist);
    return {
      data: ['Amber skies', 'Copper fields'].map((title, index) =>
        make(`${artist}_${index}`, title, artist, 200 + Number(artist.at(-1)) * 40 + index * 9),
      ),
    };
  });
  t.mock.method(YouTubeMusicService, 'search', async (artist) => ({
    data: ['Silver moon', 'Golden dawn'].map((title, index) =>
      make(`yt_${artist}_${index}`, title, artist, 218 + Number(artist.at(-1)) * 40 + index * 9),
    ),
  }));
  const artists = Array.from({ length: 10 }, (_, index) => `Rotation ${index}`);
  await WaveEngine.getWaveBatch(
    'default',
    artists.map((artist, index) => make(`seed${index}`, 'Seed', artist)),
  );
  assert.ok(!queries.includes(artists[0]));
  assert.equal(new Set(queries).size, 8);
});

test('Several edits of one song do not consume the search quota before a fresh song or its original', async (t) => {
  t.mock.method(SoundCloudService, 'search', async () => ({
    data: [
      make('quota_slow', 'Velvet stars (Slowed)', 'Quota Artist', 260),
      make('quota_fast', 'Velvet stars (Nightcore)', 'Quota Artist', 170),
      make('quota_original', 'Velvet stars', 'Quota Artist', 210),
      make('quota_fresh', 'Crimson sea', 'Quota Artist', 220),
    ],
  }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  const result = await WaveEngine.getWaveBatch('mix', [make('quota_seed', 'Seed', 'Quota Artist')]);
  assert.deepEqual(
    new Set(result.map((track) => track.id)),
    new Set(['quota_original', 'quota_fresh']),
  );
});

test('Desktop heard-song cooldown blocks another version and expires after a day', async (t) => {
  let now = Date.now();
  let version = 'original';
  t.mock.method(Date, 'now', () => now);
  t.mock.method(SoundCloudService, 'search', async (query) => ({
    data:
      query === 'Cooldown Artist'
        ? [
            make(
              version,
              version === 'original' ? 'Emerald horizon' : 'Emerald horizon (Remix)',
              'Cooldown Artist',
              version === 'original' ? 200 : 270,
            ),
          ]
        : [],
  }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  const seed = make('seed_cooldown', 'Seed', 'Cooldown Artist');
  const memory = createWaveMemory({ getItem: () => null, setItem() {} }, () => now);
  const first = await WaveEngine.getWaveBatch('mix', [seed]);
  assert.equal(first[0].id, 'original');
  memory.recordPlayback(first[0], 180);
  version = 'remix';
  assert.equal(
    (
      await WaveEngine.getWaveBatch('mix', [seed], [], [], [], {
        recentTracks: memory.playedTracks(),
      })
    ).length,
    0,
  );
  now += WAVE_PLAYED_TTL + 1;
  assert.equal(
    (
      await WaveEngine.getWaveBatch('mix', [seed], [], [], [], {
        recentTracks: memory.playedTracks(),
      })
    )[0].id,
    'remix',
  );
});

test('Changing a reused artist list cannot leave stale credits in the next batch', () => {
  const artists = ['Nirvana'];
  const upload = make('credit', 'Muse - Resistance', 'Uploader');
  assert.deepEqual(getWaveArtistKeys(upload, artists), ['uploader']);
  artists[0] = 'Muse';
  assert.deepEqual(getWaveArtistKeys(upload, artists), ['uploader', 'muse']);
  artists.push('Placebo');
  assert.ok(
    getWaveArtistKeys(make('other', 'Placebo - Every You Every Me', 'Uploader'), artists).includes(
      'placebo',
    ),
  );
});
