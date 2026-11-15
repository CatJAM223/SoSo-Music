import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaveLearning, WAVE_LEARNING_KEY } from '../src/shared/services/waveLearning.ts';
import {
  attributeWaveBatch,
  markWaveDislike,
  markWaveLike,
  readWaveRecommendation,
  WaveQualityEpisode,
} from '../src/shared/services/waveQuality.ts';
import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';
import { WaveCandidatePool } from '../src/desktop/main/services/waveCandidatePool.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';

const song = (id, title, artist, source = 'soundcloud') => ({
  id,
  source,
  title,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 180,
  preview: '',
});
const storage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
};

test('Rust distinguishes known recordings, other songs by a known artist and new artists', () => {
  const old = { ...song('100', 'Scarlet forest', 'Juniper'), waveSeedWeight: 2 };
  const alias = song('yt_12345678901', old.title, old.artist.name, 'youtube');
  const known = song('101', 'Cobalt ocean', 'Juniper');
  const unknown = song('102', 'Hidden canyon', 'Night Garden');
  const offered = { ...unknown, waveSeedWeight: 0.25 };
  const result = sequenceWaveTracks(
    [alias, known, unknown],
    'default',
    ['Juniper'],
    3,
    {
      novelty: 'balanced',
      tasteTracks: [old, offered],
      offeredTracks: [unknown],
    },
    true,
  );
  assert.deepEqual(Object.fromEntries(result.map((track) => [track.id, track.waveFamiliarity])), {
    [alias.id]: 'heard',
    [known.id]: 'unheard_known_artist',
    [unknown.id]: 'unheard_new_artist',
  });
  assert.ok(
    sequenceWaveTracks([alias, known], 'default', ['Juniper'], 2, {
      novelty: 'familiar',
      recentTracks: [old],
    }).every((track) => track.id !== alias.id),
  );
  const [fromHistory] = sequenceWaveTracks(
    [known],
    'default',
    [],
    1,
    {
      novelty: 'balanced',
      recentTracks: [old],
    },
    true,
  );
  assert.equal(fromHistory.waveFamiliarity, 'unheard_known_artist');
});

test('Novelty changes the number of new artists near the start and respects Favorites', () => {
  const tracks = Array.from({ length: 36 }, (_, i) =>
    song(String(i), 'Unique ' + (12345 * (i + 17)).toString(36), 'Music Artist ' + i),
  );
  const familiar = tracks.slice(0, 24).map((track) => track.artist.name);
  const tasteTracks = tracks.slice(0, 12).map((track) => ({ ...track, waveSeedWeight: 2 }));
  const run = (mood, novelty, options = {}) =>
    sequenceWaveTracks(tracks, mood, familiar, 12, { tasteTracks, novelty, ...options }, true);
  const freshStarts = (mood, novelty) =>
    run(mood, novelty).filter((item) => item.waveFamiliarity === 'unheard_new_artist').length;
  assert.ok(freshStarts('chill', 'fresh') > freshStarts('chill', 'familiar'));
  assert.ok(freshStarts('discover', 'familiar') > freshStarts('default', 'familiar'));
  const ids = (items) => items.map((track) => track.id);
  assert.deepEqual(ids(run('favorites', 'fresh')), ids(run('favorites')));
});

test('Candidate duplicates preserve the same capped attribution regardless of arrival order', () => {
  const a = song('100', 'Scarlet forest', 'Juniper');
  const b = song('yt_12345678901', a.title, a.artist.name, 'youtube');
  const provenance = (reverse) => {
    const pool = new WaveCandidatePool({
      mood: 'default',
      excluded: [],
      disliked: [],
      familiarArtists: [],
      heard: [],
    });
    const inputs = [
      [a, 'genre', 'rock'],
      [b, 'radio', '17'],
      [a, 'similar', 'Juniper'],
      [a, 'artist', 'Juniper'],
    ];
    for (const input of reverse ? inputs.reverse() : inputs) pool.add(...input);
    assert.equal(pool.size, 1);
    return pool.values().map((track) => track.waveProvenance);
  };
  const left = provenance(false);
  const right = provenance(true);
  assert.deepEqual(left, right);
  assert.deepEqual(
    left[0].map((path) => path.method),
    ['radio', 'similar', 'genre'],
  );
  const [track] = attributeWaveBatch(
    [{ ...a, waveProvenance: left[0] }],
    'default',
    [],
    () => {},
    undefined,
    { source: 'all', revision: 0, enabled: true },
  );
  assert.deepEqual(
    readWaveRecommendation(JSON.parse(JSON.stringify(track.waveRecommendation))),
    track.waveRecommendation,
  );
});

test('Source learning deduplicates episodes, upgrades late likes, and clears stale evidence', () => {
  const saved = storage();
  let clock = 1000;
  const now = () => clock;
  let model = createWaveLearning(saved, now);
  const track = song('101', 'Cobalt ocean', 'Juniper');
  const emit = (event) => {
    model.observe(event, 3);
    model.observe(event, 3);
  };
  const episode = (i, reason, seconds, initiallyStarted = true) => {
    const [attributed] = attributeWaveBatch(
      [{ ...track, waveProvenance: [{ method: 'similar' }] }],
      'default',
      [],
      emit,
      undefined,
      { source: 'soundcloud', revision: 3, enabled: true },
    );
    const item = new WaveQualityEpisode(attributed, 'ep-' + i, emit);
    if (initiallyStarted) item.started();
    item.finish(seconds, 180, reason);
    return attributed;
  };
  for (let i = 0; i < 5; i++) episode(i, 'error', 3);
  episode('offline', 'skip', 4, false);
  episode('interrupted', 'interrupted', 3);
  assert.equal(model.scores('default', 'soundcloud', 3), undefined);
  let last;
  for (let i = 0; i < 5; i++) last = episode(i, 'ended', 175);
  assert.equal(model.scores('default', 'soundcloud', 3).similar, (0.45 * 5) / 11);
  model.flush();
  model = createWaveLearning(saved, now);
  new WaveQualityEpisode(last, 'ep-4', emit).started();
  markWaveLike(last, emit);
  assert.equal(model.scores('default', 'soundcloud', 3).similar, (0.45 * 4 + 1) / 11);
  markWaveDislike(last, emit);
  assert.ok(
    Math.abs(model.scores('default', 'soundcloud', 3).similar - (0.45 * 4 - 1) / 11) < 1e-12,
  );
  assert.equal(model.scores('default', 'youtube', 3), undefined);
  clock += 30 * 86_400_000;
  assert.equal(model.scores('default', 'soundcloud', 3), undefined);
  model.sync(4);
  markWaveLike(last, emit);
  model.flush();
  assert.deepEqual(JSON.parse(saved.getItem(WAVE_LEARNING_KEY)).groups, []);
});

test('A long listening run respects episode and storage budgets when storage is full or corrupt', () => {
  const saved = storage();
  saved.setItem(WAVE_LEARNING_KEY, '{truncated');
  const model = createWaveLearning(saved, () => 1000);
  const example = {
    ranker: 'rust-sequence-v3',
    method: 'artist',
    selectedSource: 'all',
    tasteRevision: 0,
    mood: 'default',
    rank: 0,
    familiar: true,
    schema: 1,
    recordingId: 'rec:sc:123',
  };
  for (let i = 0; i < 3000; i++) {
    const event = { ...example, recommendationId: 'offer-' + i, episodeId: 'episode-' + i };
    model.observe({ ...event, event: 'started' }, 0);
    model.observe(
      { ...event, event: 'outcome', playedSeconds: 179, durationSeconds: 180, reason: 'ended' },
      0,
    );
  }
  model.flush();
  const data = saved.getItem(WAVE_LEARNING_KEY);
  assert.ok(Buffer.byteLength(data) <= 128 * 1024);
  assert.equal(JSON.parse(data).episodes.length, 512);
  assert.equal(JSON.parse(data).groups[0][2], 3000);
  const full = createWaveLearning(
    {
      getItem: () => data,
      setItem: () => {
        throw Error('quota');
      },
    },
    () => 1000,
  );
  assert.ok(full.scores('default', 'all', 0).artist > 0);
  full.sync(1);
  assert.doesNotThrow(full.flush);
  assert.equal(full.scores('default', 'all', 1), undefined);
});

test('Flow trades one catalog artist search for a better performing method at the same request cost', async (t) => {
  const calls = [];
  const artists = Array.from({ length: 10 }, (_, i) => ({ name: 'Familiar ' + i }));
  const candidates = (source) => async (query) => {
    calls.push(source + ':' + query);
    return {
      data: [
        song(source + ':' + query + ':1', 'Sky ' + query, query, source),
        song(source + ':' + query + ':2', 'Ocean ' + query, query, source),
      ],
    };
  };
  t.mock.method(Math, 'random', () => 0.99);
  t.mock.method(SoundCloudService, 'search', candidates('soundcloud'));
  t.mock.method(YouTubeMusicService, 'search', candidates('youtube'));
  t.mock.method(LastFmService, 'getSimilarArtists', async (artist) => {
    calls.push('similar:' + artist);
    return Array.from({ length: 6 }, (_, i) => ({ name: 'Discovery ' + i }));
  });
  const run = async (context) => {
    calls.length = 0;
    const tracks = await WaveEngine.getWaveBatch('default', [], [], artists, [], context, false);
    return {
      requests: calls.length,
      discoveries: calls.filter((call) => /^(youtube|soundcloud):Discovery/.test(call)).length,
      tracks,
    };
  };
  const baseline = await run({});
  const adaptive = await run({ novelty: 'balanced', methodScores: { similar: 0.6, artist: -0.4 } });
  const disabled = await run({ methodScores: { similar: 0.6, artist: -0.4 } });
  assert.equal(baseline.requests, 25);
  assert.equal(adaptive.requests, baseline.requests);
  assert.equal(adaptive.discoveries, baseline.discoveries + 2);
  assert.deepEqual(disabled, baseline);
  assert.ok(adaptive.tracks.some((track) => track.waveProvenance[0].method === 'similar'));
});

test('Flow with learned preferences still uses artist radio when ordinary search returns no songs', async (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  const artists = Array.from({ length: 8 }, (_, i) => ({ name: 'Familiar ' + i }));
  const radio = [];
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  t.mock.method(SoundCloudService, 'search', async (query) => {
    if (!query.endsWith(' radio')) return { data: [] };
    radio.push(query);
    return { data: [song('sc_' + radio.length, 'Unique melody ' + radio.length * 817, query)] };
  });
  t.mock.method(LastFmService, 'getSimilarArtists', async () =>
    Array.from({ length: 6 }, (_, i) => ({ name: 'Discovery ' + i })),
  );
  const result = await WaveEngine.getWaveBatch(
    'default',
    [],
    [],
    artists,
    [],
    { novelty: 'balanced', methodScores: { similar: 0.8, artist: -0.5 } },
    false,
  );
  assert.equal(radio.length, 3);
  assert.ok(result.length > 0);
});
