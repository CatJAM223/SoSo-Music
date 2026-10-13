import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectWaveLibraryGenres,
  includeWaveGenreDiscovery,
} from '../src/desktop/main/services/waveGenreDiscovery.ts';
import { WaveCandidatePool } from '../src/desktop/main/services/waveCandidatePool.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import {
  libraryGenreAffinity,
  boundedLibraryGenreScore,
} from '../src/shared/utils/libraryTaste.ts';
import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';
import { setDesktopFetch } from '../src/desktop/main/services/desktopFetch.ts';

const genre = (name, share = 1) => ({ name, share, tracks: 10 });
const track = (
  id,
  title = 'Silver Echo',
  artist = 'Fresh Artist',
  source = 'youtube',
  tags = [],
) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 200,
  preview: '',
  source,
  tags,
});
function options(overrides = {}) {
  const queries = [];
  const pool = new WaveCandidatePool({
    mood: 'default',
    excluded: [],
    disliked: [],
    familiarArtists: [],
    heard: [],
  });
  return {
    queries,
    pool,
    mood: 'default',
    artists: [],
    seeds: [],
    hasTaste: true,
    rotate: (artists) => artists,
    catalog: {
      genreTracks: async () => [{ title: 'Silver Echo', artist: 'Fresh Artist' }],
      both: async (query) => {
        queries.push(query);
        return { data: [track('yt_fresh')] };
      },
    },
    ...overrides,
  };
}

test('genre discovery samples the saved taste, respects mood and leaves favorites alone', () => {
  const genres = [
    genre('metal', 0.8),
    genre('ambient', 0.4),
    genre('grunge', 0.6),
    genre('jazz', 0),
  ];
  assert.deepEqual(
    selectWaveLibraryGenres(genres, 'default', () => 0).map((item) => item.name),
    ['metal', 'grunge'],
  );
  assert.deepEqual(
    selectWaveLibraryGenres(genres, 'chill', () => 0).map((item) => item.name),
    ['grunge', 'ambient'],
  );
  assert.deepEqual(
    selectWaveLibraryGenres(genres, 'energy', () => 0).map((item) => item.name),
    ['metal', 'grunge'],
  );
  assert.deepEqual(selectWaveLibraryGenres(genres, 'favorites'), []);
  assert.deepEqual(selectWaveLibraryGenres([], 'default'), []);
  assert.equal(genres.length, 4);
});

test('Last.fm introduces an actual new recording and rejects unrelated provider search results', async () => {
  const f = options();
  f.catalog.both = async (query) => {
    f.queries.push(query);
    return {
      data: [
        track('wrong-title', 'Foreign Song'),
        track('wrong-artist', 'Silver Echo', 'Other Artist'),
        track('preview', 'Silver Echo', 'Fresh Artist', 'soundcloud', []),
        track('valid'),
      ],
    };
  };
  // Subscription previews still pass through the shared candidate validation.
  const original = f.catalog.both;
  f.catalog.both = async (query) => {
    const result = await original(query);
    result.data[2].playbackUnavailable = true;
    return result;
  };
  await includeWaveGenreDiscovery(f, [genre('grunge')]);
  assert.deepEqual(f.queries, ['Fresh Artist Silver Echo']);
  assert.deepEqual(
    f.pool.values().map((item) => item.id),
    ['valid'],
  );
  assert.deepEqual(f.pool.values()[0].tags, ['grunge']);
});

test('genre discovery skips heard songs, deduplicates artists and bounds additional searches', async () => {
  const f = options();
  f.catalog.genreTracks = async () =>
    Array.from({ length: 50 }, (_, index) => ({
      title: 'Recording ' + index,
      artist: 'Artist ' + index,
    }));
  f.catalog.both = async (query) => {
    f.queries.push(query);
    return { data: [] };
  };
  await includeWaveGenreDiscovery(f, [genre('grunge'), genre('punk')]);
  assert.equal(f.queries.length, 6);
  assert.equal(new Set(f.queries).size, 6);
  const heard = options();
  await includeWaveGenreDiscovery(heard, [genre('grunge')], [track('old')]);
  assert.equal(heard.queries.length, 0);
});

test('favorites, empty profiles, failed Last.fm and cancellation preserve the ordinary wave path', async () => {
  for (const f of [options({ mood: 'favorites' }), options()]) {
    await includeWaveGenreDiscovery(f, f.mood === 'favorites' ? [genre('grunge')] : []);
    assert.equal(f.queries.length, 0);
  }
  const failed = options();
  failed.catalog.genreTracks = async () => {
    throw Error('offline');
  };
  await includeWaveGenreDiscovery(failed, [genre('grunge')]);
  assert.equal(failed.queries.length, 0);
  const cancelled = options();
  const controller = new AbortController();
  cancelled.catalog.genreTracks = async () => {
    controller.abort();
    return [{ title: 'Silver Echo', artist: 'Fresh Artist' }];
  };
  await assert.rejects(
    includeWaveGenreDiscovery(cancelled, [genre('grunge')], [], controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(cancelled.queries.length, 0);
});

test('genre affinity visibly changes ranking but feedback, artist spacing and unknown metadata stay meaningful', () => {
  const genres = [genre('grunge', 0.6), genre('jazz', 0.1)];
  assert.equal(libraryGenreAffinity(new Set(['grunge']), genres), 6);
  assert.equal(libraryGenreAffinity(new Set(['pop']), genres), -2);
  assert.equal(libraryGenreAffinity(new Set(), genres), 0);
  assert.equal(libraryGenreAffinity(new Set(['rock']), []), 0);
  assert.equal(boundedLibraryGenreScore(Infinity), 0);
  const pool = [
    track('known', 'Blue Horizon', 'Known Artist', 'youtube', ['pop']),
    track('fresh', 'Silver Echo', 'Fresh Artist', 'youtube', ['grunge']),
  ];
  assert.equal(sequenceWaveTracks(pool, 'default', ['Known Artist'], 1)[0].id, 'known');
  assert.equal(
    sequenceWaveTracks(pool, 'default', ['Known Artist'], 1, { libraryGenres: genres })[0].id,
    'fresh',
  );
  const carried = pool.map((item) => ({
    ...item,
    waveGenreScore: libraryGenreAffinity(new Set(item.tags), genres),
  }));
  assert.equal(sequenceWaveTracks(carried, 'default', ['Known Artist'], 1)[0].id, 'fresh');
  assert.equal(
    sequenceWaveTracks(carried, 'default', ['Known Artist'], 1, {
      artistFeedback: new Map([['fresh artist', -3]]),
    })[0].id,
    'known',
  );
  assert.equal(
    sequenceWaveTracks(carried, 'default', ['Known Artist'], 1, {
      recentArtists: ['Fresh Artist'],
    })[0].id,
    'known',
  );
});

test('a wave batch resolves Last.fm genre discoveries on the selected provider and carries their genre score', async (t) => {
  const searches = [];
  t.mock.method(LastFmService, 'getGenreTracks', async (tag) => {
    assert.equal(tag, 'grunge');
    return [{ title: 'Silver Echo', artist: 'Fresh Artist' }];
  });
  t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
  t.mock.method(YouTubeMusicService, 'getRadioTracks', async () => []);
  t.mock.method(YouTubeMusicService, 'search', async (query) => {
    searches.push(query);
    return {
      data:
        query === 'Fresh Artist Silver Echo'
          ? [track('yt_fresh')]
          : [track('yt_known', 'Blue Horizon', 'Known Artist', 'youtube', ['jazz'])],
    };
  });
  t.mock.method(SoundCloudService, 'search', async () => {
    throw Error('SoundCloud queried for YouTube-only wave');
  });
  WaveEngine.setTasteProvider({
    report: () => ({ genres: [genre('grunge')] }),
    enrichCached: (tracks) => tracks,
    enrichCandidates: async (tracks) => tracks,
  });
  t.after(() => WaveEngine.setTasteProvider(undefined));
  const batch = await WaveEngine.getWaveBatch(
    'default',
    [track('seed', 'Seed Melody', 'Known Artist', 'youtube', ['jazz'])],
    [],
    [],
    [],
    { source: 'youtube' },
    false,
  );
  assert.ok(searches.includes('Fresh Artist Silver Echo'));
  assert.equal(batch[0].id, 'yt_fresh');
  assert.equal(batch[0].waveGenreScore, 6);
  assert.ok(batch.every((item) => item.source === 'youtube'));
});

test('Last.fm tag track API validates entries, caches successful results and retries failures', async (t) => {
  LastFmService.configureApiKey('00000000000000000000000000000001');
  t.after(() => LastFmService.configureApiKey(''));
  let calls = 0;
  let fail = true;
  setDesktopFetch(async (input) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.searchParams.get('method'), 'tag.getTopTracks');
    assert.equal(url.searchParams.get('limit'), '50');
    if (fail) return new Response('', { status: 503 });
    return new Response(
      JSON.stringify({
        tracks: {
          track: [
            { name: 'Silver Echo', artist: { name: 'Fresh Artist' } },
            { name: '', artist: { name: 'Invalid' } },
            { name: 'No artist' },
          ],
        },
      }),
      { status: 200 },
    );
  });
  t.after(() => setDesktopFetch(null));
  assert.deepEqual(await LastFmService.getGenreTracks('fixture grunge'), []);
  fail = false;
  assert.deepEqual(await LastFmService.getGenreTracks('fixture grunge'), [
    { title: 'Silver Echo', artist: 'Fresh Artist' },
  ]);
  assert.deepEqual(await LastFmService.getGenreTracks('fixture grunge'), [
    { title: 'Silver Echo', artist: 'Fresh Artist' },
  ]);
  assert.equal(calls, 2);
});
