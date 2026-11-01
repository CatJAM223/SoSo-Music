import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveCandidatePool } from '../src/desktop/main/services/waveCandidatePool.ts';
import { waveTasteSnapshot } from '../src/desktop/main/services/waveTasteSnapshot.ts';
import { createWavePreferences } from '../src/shared/services/wavePreferences.ts';
import { waveMusicProfile } from '../src/shared/utils/waveMusicProfile.ts';
import { normalizeWaveBatchContext } from '../src/shared/utils/waveRecommendations.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
const song = (id, title = 'Silver River', artist = 'Fixture Band') => ({
  id,
  source: 'soundcloud',
  title,
  artist: { name: artist },
  duration: 180,
  album: { title: '' },
  preview: '',
});

test('Alternative provider uploads do not inflate refill capacity or remove playback alternatives', () => {
  const pool = new WaveCandidatePool({
    mood: 'default',
    excluded: [],
    disliked: [],
    familiarArtists: [],
    heard: [],
  });
  for (let i = 0; i < 20; i++) assert.equal(pool.add(song(String(i + 1))), true);
  assert.equal(pool.size, 1);
  assert.equal(pool.values().length, 20);
  pool.add(song('different', 'Winter Garden'));
  assert.equal(pool.size, 2);
});

test('Taste snapshot shares aggregates and invalidates on mutation and age', (t) => {
  let revision = 0,
    reads = 0,
    clock = 1000;
  t.mock.method(Date, 'now', () => clock);
  const db = {
    getChangeRevision: () => revision,
    getTasteLikedTracks: () => {
      reads++;
      return [song('liked')];
    },
    getDislikedTrackIds: () => [],
    getWaveTasteTracks: () => [],
    getFollowedArtists: () => [],
    getScrobbledTopArtists: () => [],
    getPlaylistWaveTracks: () => [],
    getTastePolicy: () => ({ revision: 0 }),
  };
  const first = waveTasteSnapshot(db);
  assert.equal(first, waveTasteSnapshot(db));
  assert.equal(reads, 1);
  revision++;
  assert.notEqual(first, waveTasteSnapshot(db));
  assert.equal(reads, 2);
  clock += 30_001;
  waveTasteSnapshot(db);
  assert.equal(reads, 3);
  const normalized = normalizeWaveBatchContext({ tasteTracks: first.waveSeeds });
  assert.equal(normalized.tasteTracks[0].waveSeedWeight, 2);
});

test('A verified copy cannot corroborate its own implicit taste evidence', () => {
  const prefs = createWavePreferences({ getItem: () => null, setItem() {} });
  const a = { ...song('one'), recordingId: 'rec:verified:same' },
    b = { ...song('two'), recordingId: 'rec:verified:same' };
  prefs.record(a, 0.35, true);
  prefs.record(b, 0.35, true);
  assert.equal(prefs.learnedTracks().length, 1);
  assert.equal(prefs.metrics().discoveries, 1);
});

test('New songs by known artists adjust exploration more cautiously than new artists', () => {
  const preference = () => createWavePreferences({ getItem: () => null, setItem() {} });
  const songs = preference(),
    artists = preference();
  for (let i = 0; i < 3; i++) {
    songs.record(song(String(i)), -0.6, 0.5);
    artists.record(song(String(i)), -0.6, 1);
  }
  assert.ok(songs.discoveryAdjustment() < 0);
  assert.ok(Math.abs(songs.discoveryAdjustment()) < Math.abs(artists.discoveryAdjustment()));
});

test('Artist-wide classification softly affects mood, track-specific tags retain full strength', () => {
  assert.equal(waveMusicProfile({ tags: ['metal'] }).energy, 1);
  assert.equal(waveMusicProfile({ tags: ['metal'], waveMetadataScope: 'artist' }).energy, 0.25);
  assert.equal(waveMusicProfile({ tags: ['calm'], waveMetadataScope: 'artist' }).energy, -0.25);
});

test('YouTube search expires cached empty results instead of keeping them for the whole session', async (t) => {
  let clock = 1000,
    calls = 0;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(YouTubeMusicService, 'postInnertube', async () => {
    calls++;
    return { contents: {} };
  });
  YouTubeMusicService.searchCache.clear();
  await YouTubeMusicService.search('unique cache fixture', 5);
  const initial = calls;
  assert.ok(initial > 0);
  await YouTubeMusicService.search('unique cache fixture', 5);
  assert.equal(calls, initial);
  clock += 30_001;
  await YouTubeMusicService.search('unique cache fixture', 5);
  assert.ok(calls > initial);
  YouTubeMusicService.searchCache.clear();
});

test('Worker encoding retains verified recording aliases across differently named uploads', async (t) => {
  const { createNativeWaveWorker } = await import('./helpers/nativeWaveWorker.mjs');
  const { resequenceWaveQueueInWorker, disposeWaveWorker } =
    await import('../src/shared/compute/waveWorkerClient.ts');
  const original = globalThis.Worker;
  globalThis.Worker = class {
    constructor() {
      return createNativeWaveWorker();
    }
  };
  t.after(() => {
    disposeWaveWorker();
    globalThis.Worker = original;
  });
  const current = { ...song('heard'), recordingId: 'rec:verified:alias' };
  const copy = {
    ...song('upload', 'Different metadata', 'Other uploader'),
    recordingId: current.recordingId,
  };
  const result = await resequenceWaveQueueInWorker([current, copy], 0, 'default', [], new Map());
  assert.deepEqual(
    result.map((track) => track.id),
    ['heard'],
  );
});

test('Optional candidate tags have one batch deadline and stop starting work after it', async (t) => {
  const { LibraryTasteService } = await import('../src/desktop/main/services/libraryTaste.ts');
  const { LastFmService } = await import('../src/desktop/main/services/lastfm.ts');
  const service = new LibraryTasteService(
    () => null,
    () => {},
  );
  t.mock.method(service, 'report', () => ({ genres: [{ name: 'rock', share: 1 }] }));
  t.mock.method(service, 'enrichCached', (tracks) => tracks);
  let calls = 0;
  t.mock.method(LastFmService, 'getArtistInfo', async (artist, signal) => {
    calls++;
    return new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  });
  const candidates = Array.from({ length: 12 }, (_, i) =>
    song(String(i), 'Unknown', 'Artist ' + i),
  );
  const keepAlive = setInterval(() => {}, 100);
  t.after(() => clearInterval(keepAlive));
  const began = performance.now();
  assert.deepEqual(await service.enrichCandidates(candidates), candidates);
  assert.ok(performance.now() - began < 3500);
  assert.equal(calls, 3);
});
