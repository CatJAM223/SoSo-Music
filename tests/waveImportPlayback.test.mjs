import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sequenceWaveTracks,
  resequenceWaveQueue,
  spreadWaveSeedArtists,
} from '../src/shared/utils/waveQueue.ts';
import { scoreImportCandidate, matchImportedTrack } from '../src/shared/services/playlistImport.ts';
import { decodePlaylistText } from '../src/shared/services/externalPlaylist.ts';
import { transformSCTrack } from '../src/shared/services/parsers/soundCloudParser.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';

const track = (id, artist, title = `Song ${id}`, source = 'soundcloud', duration = 200) => ({
  id,
  title,
  artist: { name: artist },
  source,
  duration,
});

for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites']) {
  test(`Wave ${mood}: spreads a favored artist across a rolling twelve-song window`, () => {
    const titles = [
      'Crimson rivers',
      'Velvet clouds',
      'Copper mountains',
      'Silent orchards',
      'Frozen oceans',
    ];
    const tracks = Array.from({ length: 8 }, (_, artist) =>
      Array.from({ length: 5 }, (_, song) =>
        track(`${artist}_${song}`, `Musician ${artist}`, titles[song]),
      ),
    ).flat();
    const result = sequenceWaveTracks(tracks, mood, ['Musician 0'], 25, {
      artistFeedback: new Map([['musician 0', 3]]),
    });
    assert.equal(result.length, 25);
    for (let offset = 0; offset <= result.length - 12; offset++) {
      const counts = new Map();
      for (const t of result.slice(offset, offset + 12))
        counts.set(t.artist.name, (counts.get(t.artist.name) || 0) + 1);
      assert.ok(Math.max(...counts.values()) <= 2, `${mood}: ${JSON.stringify([...counts])}`);
    }
  });
  test(`Wave ${mood}: desktop queries both catalogs and rejects unsupported streams`, async (t) => {
    const sources = new Set();
    const queries = [];
    t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
    t.mock.method(SoundCloudService, 'search', async (query) => {
      sources.add('soundcloud');
      queries.push(query);
      return {
        data: [{ ...track('bad_' + mood + query, query), playbackUnavailable: true }],
      };
    });
    t.mock.method(YouTubeMusicService, 'search', async (query) => {
      sources.add('youtube');
      return {
        data: [
          track(
            'good_' + mood + query,
            mood === 'discover' ? 'New Musician' : query,
            `Unique ${mood} ${query}`,
            'youtube',
            215,
          ),
        ],
      };
    });
    const result = await WaveEngine.getWaveBatch(mood, [track('seed_' + mood, `Taste ${mood}`)]);
    assert.deepEqual([...sources].sort(), ['soundcloud', 'youtube']);
    assert.ok(result.length > 0);
    assert.ok(result.every((t) => t.source === 'youtube' && !t.playbackUnavailable));
    if (mood === 'energy' || mood === 'chill')
      assert.ok(
        queries.every(
          (query) =>
            query === `Taste ${mood}` ||
            query === `Taste ${mood}` + (mood === 'energy' ? ' energetic' : ' chill'),
        ),
        'personal moods must not inject unrelated curated artists',
      );
  });
}

test('Wave remembers artist frequency when skipping or merging the next batch', () => {
  const history = Array.from({ length: 12 }, (_, i) =>
    track('history' + i, i % 3 === 0 ? 'Frequent' : `Old ${i}`),
  );
  const current = history.at(-1);
  const pending = [
    track('frequent', 'Frequent', 'Scarlet skies'),
    ...Array.from({ length: 8 }, (_, i) => track('fresh' + i, `Fresh ${i}`)),
  ];
  const next = resequenceWaveQueue(
    [...history, ...pending],
    history.length - 1,
    'default',
    ['Frequent'],
    new Map([['frequent', 3]]),
  );
  assert.deepEqual(next.slice(0, history.length), history);
  assert.equal(next[history.length - 1], current);
  assert.ok(next.findIndex((t) => t.id === 'frequent') >= history.length + 6);
  assert.deepEqual(
    spreadWaveSeedArtists(
      ['Frequent', 'Fresh'],
      Array.from({ length: 10 }, () => ['frequent']),
    ),
    ['Fresh', 'Frequent'],
  );
});

test('Wave adds related musicians beyond saved artists without filling the batch with one artist', async (t) => {
  const related = [
    'Amber Echo',
    'Bronze Lantern',
    'Indigo House',
    'Azure Pulse',
    'Silver Lily',
    'Ivory Moss',
  ].flatMap((artist, index) =>
    Array.from({ length: 4 }, (_, song) =>
      track(
        `related_new_${index}_${song}`,
        artist,
        ['Crimson rivers', 'Velvet clouds', 'Copper mountains', 'Silent orchards'][song],
      ),
    ),
  );
  t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
  t.mock.method(SoundCloudService, 'getRelatedTracks', async () => related);
  t.mock.method(SoundCloudService, 'search', async () => ({
    data: [track('known_related_song', 'Known related seed', 'Golden forest')],
  }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  const result = await WaveEngine.getWaveBatch('default', [
    track(981077101, 'Known related seed', 'Red moon'),
    track(981077102, 'Known related seed', 'Blue rain'),
    track(981077103, 'Known related seed', 'Bright morning'),
  ]);
  const fresh = result.filter((t) => String(t.id).startsWith('related_new_'));
  assert.ok(
    new Set(fresh.map((t) => t.artist.name)).size >= 2,
    JSON.stringify(result.map((t) => ({ id: t.id, artist: t.artist.name, title: t.title }))),
  );
  assert.ok(fresh.length <= 10);
  for (const artist of new Set(fresh.map((t) => t.artist.name)))
    assert.ok(fresh.filter((t) => t.artist.name === artist).length <= 2);
});

for (const mobile of [false])
  test(`${'Desktop'} wave preserves unrelated artists with the same title across batches`, async (t) => {
    const names = ['Desktop Amber Shore', 'Desktop Silver Dawn'];
    const originals = names.map((artist, index) =>
      track(`homonym_${mobile}_${index}`, artist, 'Silent prayer', 200),
    );
    const search = async (query) => ({
      data: originals.filter((t) => query === t.artist.name),
    });
    const engine = WaveEngine;
    {
      t.mock.method(SoundCloudService, 'search', search);
      t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
    }
    const heard = [];
    const request = (seeds) =>
      engine.getWaveBatch('mix', seeds, [], [], [], { recentTracks: heard });
    for (const [index, artist] of names.entries()) {
      const result = await request([
        track(`homonym_seed_${mobile}_${index}`, artist, 'Seed melody'),
      ]);
      assert.deepEqual(
        result.map((t) => t.id),
        [originals[index].id],
      );
      heard.push(result[0]);
    }
    assert.equal(
      (await request([track(`homonym_repeat_seed_${mobile}`, names[0], 'Seed melody')])).length,
      0,
    );
  });

test('Import handles composed artist names, collaborator credits and censored titles', () => {
  assert.equal(decodePlaylistText('&lt;b&gt;madk1d&lt;/b&gt;\u200b'), 'madk1d');
  const original = {
    id: 'vk1',
    artist: 'madk1d, CUPSIZE',
    title: '1 мая',
    duration: 128,
  };
  assert.equal(
    scoreImportCandidate(
      original,
      track('yt_1', 'Uploader', 'madk1d & CUPSIZE — 1 мая', 'youtube', 128),
    ).confident,
    true,
  );
  const censored = {
    id: 'vk2',
    artist: 'madk1d',
    title: 'так по***',
    duration: 108,
  };
  const result = scoreImportCandidate(
    censored,
    track('yt_2', 'madk1d', 'так похуй', 'youtube', 108),
  );
  assert.ok(result.score > 0);
  assert.equal(result.confident, false);
  assert.equal(
    scoreImportCandidate(censored, track('yt_3', 'madk1d', 'так похуй (ремикс)', 'youtube', 108))
      .score,
    0,
  );
  assert.equal(
    scoreImportCandidate(
      { ...original, title: 'питер паркер', duration: 2 },
      track('yt_4', 'madk1d', 'питер паркер', 'youtube', 120),
    ).confident,
    false,
  );
});

test('Import retries a cleaned query and retains the requested provider priority', async () => {
  const queries = [];
  const result = await matchImportedTrack(
    {
      id: 'vk',
      artist: 'madk1d',
      title: 'типичная ситуация (prod. by vhs)',
      duration: 130,
    },
    'youtube',
    async (q, n, source) => {
      queries.push(q);
      assert.equal(source, 'youtube');
      assert.equal(n, 24);
      return {
        data: q.includes('prod.')
          ? []
          : [track('yt_1', 'madk1d', 'типичная ситуация', 'youtube', 131)],
      };
    },
  );
  assert.equal(result.status, 'matched');
  assert.equal(result.track.source, 'youtube');
  assert.equal(queries.length, 2);
});

test('SoundCloud identifies encrypted records with only obsolete unencrypted alternatives', () => {
  const record = transformSCTrack({
    id: 909090,
    title: 'Song',
    duration: 180000,
    media: {
      transcodings: [
        {
          url: 'https://api-v2.soundcloud.com/encrypted',
          format: { protocol: 'cbc-encrypted-hls' },
        },
        {
          url: 'https://api-v2.soundcloud.com/old',
          format: { protocol: 'hls' },
          is_legacy_transcoding: true,
        },
      ],
    },
  });
  assert.equal(record.playbackUnavailable, true);
  assert.equal(sequenceWaveTracks([record], 'default', []).length, 0);
});

test('SoundCloud refresh replaces a cached URL; aggregator forwards refresh options', async (t) => {
  let generation = 0;
  let calls = 0;
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'public-client');
  t.mock.method(SoundCloudService, 'fetchWithRelay', async (url) => {
    calls++;
    return url.includes('/tracks/')
      ? {
          media: {
            transcodings: [
              {
                url: 'https://api-v2.soundcloud.com/media/test',
                format: { protocol: 'progressive' },
              },
            ],
          },
        }
      : { url: `https://cdn.sndcdn.com/generation${generation}.mp3` };
  });
  const input = track(987675401, 'Test');
  assert.ok((await SoundCloudService.getFullStreamUrl(input)).includes('generation0'));
  generation = 1;
  assert.ok((await SoundCloudService.getFullStreamUrl(input)).includes('generation0'));
  assert.equal(calls, 2);
  assert.ok(
    (
      await MusicAggregatorService.getFullStreamUrl(input, {
        forceRefresh: true,
      })
    ).includes('generation1'),
  );
  assert.equal(calls, 4);
});

test('Concurrent SoundCloud prefetch shares failed resolution and a fresh retry bypasses its short cache', async (t) => {
  let calls = 0;
  t.mock.method(SoundCloudService, 'resolveFullStreamUrl', async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return '';
  });
  const input = track(987675402, 'Unavailable');
  assert.deepEqual(
    await Promise.all(Array.from({ length: 3 }, () => SoundCloudService.getFullStreamUrl(input))),
    ['', '', ''],
  );
  await SoundCloudService.getFullStreamUrl(input);
  assert.equal(calls, 1);
  await SoundCloudService.getFullStreamUrl(input, { forceRefresh: true });
  assert.equal(calls, 2);
});
