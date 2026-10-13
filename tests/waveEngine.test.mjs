import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCoreTitle,
  buildTrackPrintFromTrack,
  areTracksDuplicates,
} from '../src/shared/utils/trackFingerprint.ts';

import { WaveEngine, SUPPORTED_WAVE_MOODS } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import {
  matchesDislikedWaveTrack,
  moveDifferentArtistAfterSkip,
  sequenceWaveTracks,
} from '../src/shared/utils/waveQueue.ts';

import { LastFmService } from '../src/desktop/main/services/lastfm.ts';

// These cases exercise wave ordering/fallback with a deterministic catalog, not live Last.fm.
beforeEach((t) => t.mock.method(LastFmService, 'getSimilarArtists', async () => []));

const filterWaveTracks = WaveEngine.filterWaveTracks;

test('Wave queue starts with familiar music and spaces repeated artists', () => {
  const tracks = [
    { id: 'a1', artist: { name: 'Favorite' }, source: 'soundcloud' },
    { id: 'a2', artist: { name: 'Favorite' }, source: 'soundcloud' },
    { id: 'b1', artist: { name: 'New One' }, source: 'youtube' },
    { id: 'c1', artist: { name: 'New Two' }, source: 'soundcloud' },
  ];
  const flow = sequenceWaveTracks(tracks, 'default', ['Favorite']);
  assert.equal(flow[0].id, 'a1');
  assert.notEqual(flow[1].artist.name, flow[0].artist.name);
  const discover = sequenceWaveTracks(tracks, 'discover', ['Favorite']);
  assert.notEqual(discover[0].artist.name, 'Favorite');
});

test('Wave balances familiarity with discovery and reacts to a quick skip', () => {
  const make = (id, artist) => ({
    id,
    title: `Track ${id}`,
    artist: { name: artist },
    duration: 200,
  });
  const tracks = [
    make('1', 'Known 1'),
    make('2', 'Known 2'),
    make('3', 'Known 3'),
    make('4', 'New 1'),
    make('5', 'New 2'),
    make('6', 'New 3'),
  ];
  const ordered = sequenceWaveTracks(tracks, 'default', ['Known 1', 'Known 2', 'Known 3']);
  assert.deepEqual(
    ordered.slice(0, 4).map((track) => track.artist.name),
    ['Known 1', 'Known 2', 'Known 3', 'New 1'],
  );
  const afterSkip = sequenceWaveTracks(tracks, 'default', ['Known 1', 'Known 2'], 6, {
    artistFeedback: new Map([['known 1', -3]]),
  });
  assert.notEqual(afterSkip[0].artist.name, 'Known 1');
  const swapped = moveDifferentArtistAfterSkip(
    [make('a', 'Same'), make('b', 'Same'), make('c', 'Other')],
    0,
  );
  assert.equal(swapped[1].artist.name, 'Other');
});

test('Disliked recording is blocked across source IDs without blocking distinct variants', () => {
  const disliked = { id: 'sc_1', title: 'Favorite Song', artist: 'Artist' };
  const youtubeCopy = {
    id: 'yt_2',
    title: 'Artist - Favorite Song (Official Audio)',
    artist: { name: 'Artist' },
    duration: 205,
  };
  const remix = {
    id: 'yt_3',
    title: 'Favorite Song (Remix)',
    artist: { name: 'Artist' },
    duration: 230,
  };
  assert.equal(matchesDislikedWaveTrack(youtubeCopy, disliked), true);
  assert.equal(matchesDislikedWaveTrack(remix, disliked), false);
});

test('Wave candidate search skips a disliked re-upload and continues to the next result', async (t) => {
  t.mock.method(SoundCloudService, 'search', async () => ({
    data: [
      {
        id: 'sc_reupload',
        title: 'Artist - Favorite Song (Official Audio)',
        artist: { name: 'Artist' },
        duration: 205,
        source: 'soundcloud',
      },
      {
        id: 'sc_fresh',
        title: 'Another Great Track',
        artist: { name: 'Artist' },
        duration: 205,
        source: 'soundcloud',
      },
    ],
  }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  const result = await WaveEngine.getWaveBatch(
    'mix',
    [{ id: 'seed', title: 'Seed', artist: { name: 'Artist' }, duration: 200 }],
    [],
    [],
    [{ id: 'yt_disliked', title: 'Favorite Song', artist: 'Artist' }],
  );
  assert.ok(result.some((track) => track.id === 'sc_fresh'));
  assert.ok(result.every((track) => track.id !== 'sc_reupload'));
});

test('Wave remembers only delivered tracks, leaving unused candidates for the next batch', async (t) => {
  t.mock.method(SoundCloudService, 'search', async (query) => ({
    data: Array.from({ length: 12 }, (_, index) => ({
      id: `memory_${query}_${index}`,
      title: `Melody${index}${query.replace(/\s+/g, '')}`,
      artist: { name: `Artist ${query} ${index}` },
      duration: 180,
      source: 'soundcloud',
    })),
  }));
  const first = await WaveEngine.getWaveBatch('mix');
  const second = await WaveEngine.getWaveBatch(
    'mix',
    [],
    first.map((track) => track.id),
  );
  assert.equal(first.length, 25);
  assert.ok(second.length > 0);
  assert.ok(second.every((track) => !first.some((old) => old.id === track.id)));
});

test('WaveEngine: Exclude already played tracks and deduplicate by id', () => {
  const rawBatch = [
    { id: '101', title: 'Song 1', source: 'soundcloud' },
    { id: '102', title: 'Song 2', source: 'youtube' },
    { id: '103', title: 'Song 3', source: 'soundcloud' },
    { id: '101', title: 'Song 1 Duplicate', source: 'soundcloud' },
    { id: '104', title: 'Song 4', source: 'youtube' },
  ];

  const excludeIds = ['102', 104];
  const filtered = filterWaveTracks(rawBatch, excludeIds);

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, '101');
  assert.equal(filtered[1].id, '103');
});

test('WaveEngine: Mood definitions and properties', () => {
  assert.equal(SUPPORTED_WAVE_MOODS.length, 6);
  assert.ok(SUPPORTED_WAVE_MOODS.includes('default'));
  assert.ok(SUPPORTED_WAVE_MOODS.includes('energy'));
  assert.ok(SUPPORTED_WAVE_MOODS.includes('chill'));
  assert.ok(SUPPORTED_WAVE_MOODS.includes('discover'));
  assert.ok(SUPPORTED_WAVE_MOODS.includes('mix'));
  assert.ok(SUPPORTED_WAVE_MOODS.includes('favorites'));
});

test('WaveEngine: Track Fingerprinting detects re-uploads across sources', () => {
  const t1 = { title: 'Headplate - Delicate (Official Audio)', duration: 297 };
  const t2 = { title: 'Delicate', duration: 298 };

  const p1 = buildTrackPrintFromTrack(t1);
  const p2 = buildTrackPrintFromTrack(t2);

  assert.equal(
    areTracksDuplicates(p1, p2),
    true,
    'Official Audio suffix and artist prefix should be stripped to match Delicate',
  );
});

test('WaveEngine: Track Fingerprinting distinguishes genuine variants (remixes, slowed, acoustic)', () => {
  const original = { title: 'Blinding Lights', duration: 200 };
  const remix = { title: 'Blinding Lights (Chromatics Remix)', duration: 245 };
  const slowed = { title: 'Blinding Lights (Slowed + Reverb)', duration: 240 };
  const acoustic = { title: 'Blinding Lights (Acoustic)', duration: 198 };

  const pOriginal = buildTrackPrintFromTrack(original);
  const pRemix = buildTrackPrintFromTrack(remix);
  const pSlowed = buildTrackPrintFromTrack(slowed);
  const pAcoustic = buildTrackPrintFromTrack(acoustic);

  assert.equal(
    areTracksDuplicates(pOriginal, pRemix),
    false,
    'Remix is not a duplicate of original',
  );
  assert.equal(
    areTracksDuplicates(pOriginal, pSlowed),
    false,
    'Slowed version is not a duplicate of original',
  );
  assert.equal(
    areTracksDuplicates(pOriginal, pAcoustic),
    false,
    'Acoustic version is not a duplicate of original',
  );
});

test('WaveEngine: Duration guard prevents merging different songs sharing same generic title', () => {
  // Two different songs named "Wait" by different artists with different durations
  const trackA = { title: 'Wait', duration: 213 }; // Earshot - Wait (3:33)
  const trackB = { title: 'Wait', duration: 184 }; // NF - Wait (3:04)

  const pA = buildTrackPrintFromTrack(trackA);
  const pB = buildTrackPrintFromTrack(trackB);

  // 213 - 184 = 29s diff > 8s threshold
  assert.equal(
    areTracksDuplicates(pA, pB),
    false,
    'Songs with duration delta > 8s must not be flagged as duplicates',
  );
});

test('WaveEngine: getWaveBatch handles concurrent searches and survives rejection of one provider', async (t) => {
  // Mock SC search returning tracks
  t.mock.method(SoundCloudService, 'search', async (query, limit) => {
    return {
      data: [
        {
          id: `sc_trk_${query}_1`,
          title: `${query} Hit 1`,
          duration: 180,
          source: 'soundcloud',
          artist: { name: query },
        },
        {
          id: `sc_trk_${query}_2`,
          title: `${query} Hit 2`,
          duration: 200,
          source: 'soundcloud',
          artist: { name: query },
        },
      ],
      total: 2,
    };
  });

  // Mock YT search failing with network error
  t.mock.method(YouTubeMusicService, 'search', async () => {
    throw new Error('Network timeout in YouTube');
  });

  const seeds = [
    {
      id: 'seed_1',
      title: 'Song A',
      artist: { name: 'Artist Alpha' },
      duration: 180,
      source: 'soundcloud',
    },
    {
      id: 'seed_2',
      title: 'Song B',
      artist: { name: 'Artist Beta' },
      duration: 210,
      source: 'soundcloud',
    },
  ];

  const batch = await WaveEngine.getWaveBatch('mix', seeds, ['sc_trk_Artist Alpha_1']);

  assert.ok(Array.isArray(batch));
  assert.ok(batch.length > 0, 'Batch should still be generated despite YouTube failure');
  for (const track of batch) {
    assert.ok(track.id, 'Track must have an id');
    assert.ok(track.title, 'Track must have a title');
    assert.ok(
      track.artist && (track.artist.name || typeof track.artist === 'string'),
      'Track must have artist name',
    );
    assert.ok(
      typeof track.duration === 'number' && track.duration > 0,
      'Track must have positive duration',
    );
    assert.ok(track.source, 'Track must specify source');
  }
  // Verify excluded track was filtered
  assert.ok(
    !batch.some((t) => t.id === 'sc_trk_Artist Alpha_1'),
    'Excluded track must not be present',
  );
});

test('WaveEngine: unavailable taste never triggers unrelated curated music', async (t) => {
  let emergencyQueriesCalled = 0;

  t.mock.method(SoundCloudService, 'search', async (query, limit) => {
    // If user taste artist, return empty
    if (query.includes('ObscureBand')) {
      return { data: [], total: 0 };
    }
    // Emergency fallback queries
    emergencyQueriesCalled++;
    return {
      data: [
        {
          id: `sc_fb_${query}`,
          title: `${query} Song`,
          duration: 190,
          source: 'soundcloud',
          artist: { name: query },
        },
      ],
      total: 1,
    };
  });

  t.mock.method(YouTubeMusicService, 'search', async () => {
    return { data: [], total: 0 };
  });

  const seeds = [
    {
      id: 'seed_obscure',
      title: 'Lost Tape',
      artist: { name: 'ObscureBand' },
      duration: 180,
      source: 'soundcloud',
    },
  ];

  const batch = await WaveEngine.getWaveBatch('default', seeds);

  assert.equal(
    emergencyQueriesCalled,
    0,
    'A known profile must not request unrelated curated artists',
  );
  assert.equal(batch.length, 0, 'Empty personalized results should remain empty');
  for (const track of batch) {
    assert.ok(track.id, 'Fallback track must have an id');
    assert.ok(track.title, 'Fallback track must have a title');
    assert.ok(track.artist, 'Fallback track must have an artist');
    assert.ok(track.source, 'Fallback track must have a source');
  }
});

test('WaveEngine: getWaveBatch works correctly across distinct moods (energy, chill, discover)', async (t) => {
  const queriesReceived = [];
  t.mock.method(SoundCloudService, 'search', async (query, limit) => {
    queriesReceived.push(query);
    return {
      data: [
        {
          id: `sc_mood_${query}`,
          title: `Track for ${query}`,
          duration: 180,
          source: 'soundcloud',
          artist: { name: 'Various' },
        },
      ],
      total: 1,
    };
  });
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [], total: 0 }));

  // 1. Energy mood
  const energyBatch = await WaveEngine.getWaveBatch('energy', [], []);
  assert.ok(energyBatch.length > 0);
  for (const track of energyBatch) {
    assert.ok(track.id, 'Energy track must have an id');
    assert.ok(track.title, 'Energy track must have a title');
    assert.ok(track.artist, 'Energy track must have an artist');
  }
  assert.ok(
    queriesReceived.some(
      (q) =>
        q.includes('phonk') ||
        q.includes('DVRST') ||
        q.includes('Interworld') ||
        q.includes('Kordhell') ||
        q.includes('Nirvana') ||
        q.includes('Гражданская') ||
        q.includes('cupsize') ||
        q.includes('shadowraze'),
    ),
  );

  // 2. Chill mood
  queriesReceived.length = 0;
  const chillBatch = await WaveEngine.getWaveBatch('chill', [], []);
  assert.ok(chillBatch.length > 0);
  for (const track of chillBatch) {
    assert.ok(track.id, 'Chill track must have an id');
    assert.ok(track.title, 'Chill track must have a title');
    assert.ok(track.artist, 'Chill track must have an artist');
  }
  assert.ok(
    queriesReceived.some(
      (q) =>
        q.includes('snowfall') ||
        q.includes('leadwave') ||
        q.includes('antent') ||
        q.includes('ambient') ||
        q.includes('acoustic') ||
        q.includes('reidenshi') ||
        q.includes('empty') ||
        q.includes('Стрыкало') ||
        q.includes('акустика'),
    ),
  );

  // 3. Discover mood
  queriesReceived.length = 0;
  const discoverBatch = await WaveEngine.getWaveBatch(
    'discover',
    [
      {
        id: 's1',
        title: 'Indie Song',
        artist: { name: 'IndieArtist' },
        duration: 180,
        source: 'soundcloud',
      },
    ],
    [],
  );
  assert.ok(discoverBatch.length > 0);
  for (const track of discoverBatch) {
    assert.ok(track.id, 'Discover track must have an id');
    assert.ok(track.title, 'Discover track must have a title');
    assert.ok(track.artist, 'Discover track must have an artist');
  }
  assert.ok(
    queriesReceived.some((q) => q.includes('similar') || q.includes('indie') || q.includes('wave')),
  );
});

test('Wave keeps actual likes when search is unavailable and respects exclusions and heard recordings', async (t) => {
  t.mock.method(SoundCloudService, 'search', async () => ({ data: [], total: 0 }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [], total: 0 }));
  const likes = Array.from({ length: 6 }, (_, i) => ({
    id: 'liked-' + i,
    title: 'Saved melody ' + i,
    artist: { name: 'Liked artist ' + i },
    duration: 200,
    source: 'soundcloud',
    waveSeedWeight: 2,
  }));
  const batch = await WaveEngine.getWaveBatch(
    'default',
    likes,
    ['liked-0'],
    [],
    [],
    { recentTracks: [likes[1]] },
    false,
  );
  assert.equal(batch.length, 4);
  assert.ok(batch.every((track) => track.waveSeedWeight === 2));
  assert.ok(!batch.some((track) => track.id === 'liked-0' || track.id === 'liked-1'));
  assert.equal((await WaveEngine.getWaveBatch('discover', likes, [], [], [], {}, false)).length, 0);
});

test('A like has identity-based priority even without provider genre metadata', () => {
  const make = (id, artist) => ({
    id,
    title: 'Distinct melody ' + id,
    artist: { name: artist },
    duration: 200,
    source: 'soundcloud',
  });
  const history = make('history', 'History artist'),
    liked = make('liked', 'Liked artist');
  const result = sequenceWaveTracks(
    [history, liked],
    'default',
    ['History artist', 'Liked artist'],
    25,
    { tasteTracks: [{ ...liked, waveSeedWeight: 2 }] },
  );
  assert.equal(result[0].id, 'liked');
  const skipped = sequenceWaveTracks(
    [history, liked],
    'default',
    ['History artist', 'Liked artist'],
    25,
    {
      tasteTracks: [{ ...liked, waveSeedWeight: 2 }],
      artistFeedback: new Map([['liked artist', -1]]),
    },
  );
  assert.equal(skipped[0].id, 'history');
});
