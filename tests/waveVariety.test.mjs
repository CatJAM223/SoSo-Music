import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWaveMemory } from '../src/shared/services/waveMemory.ts';
import { gatherWaveDiscovery } from '../src/shared/services/waveDiscovery.ts';
import { selectWaveRelatedSeeds } from '../src/shared/utils/waveRecommendations.ts';
import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
import { registerWaveHandlers } from '../src/desktop/main/ipc/waveHandlers.ts';

const song = (id, artist, title = 'Melody ' + id) => ({
  id,
  artist: { name: artist },
  title,
  duration: 200,
  album: { title: 'Single' },
  source: String(id).startsWith('yt_') ? 'youtube' : 'soundcloud',
  preview: '',
});
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}
function offline(t) {
  t.mock.method(SoundCloudService, 'search', async () => ({ data: [] }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  t.mock.method(SoundCloudService, 'getRelatedTracks', async () => []);
  t.mock.method(YouTubeMusicService, 'getRadioTracks', async () => []);
  t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
}

test('wave proposals retain a soft cooldown across a later visit and storage reload', () => {
  const saved = storage();
  let now = 1000000;
  const previous = song('previous', 'Personal Artist', 'Copper fields');
  createWaveMemory(saved, () => now).recordOffered([previous]);
  now += 2 * 60 * 60 * 1000;
  const restored = createWaveMemory(saved, () => now);
  assert.equal(restored.offeredTracks().length, 1);
  assert.equal(restored.playedTracks().length, 0);
  const fresh = song('fresh', 'Personal Artist', 'Distant oceans');
  assert.equal(
    sequenceWaveTracks([previous, fresh], 'default', ['Personal Artist'], 2, {
      offeredTracks: restored.offeredTracks(),
    })[0].id,
    fresh.id,
  );
  assert.equal(
    sequenceWaveTracks([previous], 'default', ['Personal Artist'], 1, {
      offeredTracks: restored.offeredTracks(),
    }).length,
    1,
    'A tiny catalog still plays unheard proposals',
  );
});

test('artist searches rotate using durable listening history even without main-process session memory', async (t) => {
  offline(t);
  t.mock.method(Math, 'random', () => 0.999);
  const artists = Array.from({ length: 12 }, (_, i) => 'Personal ' + i);
  const seeds = artists.map((artist, i) => song('seed-' + i, artist));
  const saved = storage();
  const memory = createWaveMemory(saved);
  for (const artist of artists.slice(0, 8))
    memory.recordPlayback(song('heard-' + artist, artist), 180);
  const queries = [];
  t.mock.method(SoundCloudService, 'search', async (query) => {
    queries.push(query);
    return { data: [song('result-' + query, query)] };
  });
  await WaveEngine.getWaveBatch(
    'mix',
    seeds,
    [],
    [],
    [],
    {
      recentTracks: createWaveMemory(saved).playedTracks(),
    },
    false,
  );
  assert.ok(artists.slice(8).every((artist) => queries.includes(artist)));
  assert.ok(queries.indexOf(artists[8]) < queries.indexOf(artists[0]));
});

test('artist searches also rotate from persisted unplayed proposals after a restart', async (t) => {
  offline(t);
  t.mock.method(Math, 'random', () => 0.999);
  const artists = Array.from({ length: 12 }, (_, i) => 'Library ' + i);
  const memory = createWaveMemory(storage());
  memory.recordOffered(artists.slice(0, 8).map((artist, i) => song('offered-' + i, artist)));
  const queries = [];
  t.mock.method(SoundCloudService, 'search', async (query) => {
    queries.push(query);
    return { data: [] };
  });
  await WaveEngine.getWaveBatch(
    'mix',
    artists.map((artist, i) => song('seed-' + i, artist)),
    [],
    [],
    [],
    {
      offeredTracks: memory.offeredTracks(),
    },
    false,
  );
  assert.ok(artists.slice(8).every((artist) => queries.includes(artist)));
});

test('a heard top-ten catalog leads to deeper personal searches rather than an exhausted wave', async (t) => {
  offline(t);
  const titles = [
    'Amber skies',
    'Copper fields',
    'Silver moon',
    'Golden dawn',
    'Velvet stars',
    'Crimson sea',
    'Emerald horizon',
    'Frozen oceans',
    'Silent orchards',
    'Ivory mountains',
    'Uncharted midnight',
  ];
  const catalog = titles.map((title, i) => song('catalog-' + i, 'Personal Artist', title));
  const requested = [];
  t.mock.method(SoundCloudService, 'search', async (query, limit) => {
    requested.push(limit);
    return { data: query === 'Personal Artist' ? catalog.slice(0, limit) : [] };
  });
  const result = await WaveEngine.getWaveBatch(
    'mix',
    [song('seed', 'Personal Artist', 'Anchor melody')],
    [],
    [],
    [],
    {
      recentTracks: catalog.slice(0, 10),
      source: 'soundcloud',
    },
    false,
  );
  assert.ok(result.some((track) => track.id === 'catalog-10'));
  assert.ok(result.every((track) => track.id === 'catalog-10'));
  assert.ok(requested.every((limit) => limit <= 40));
});

test('default wave looks beyond the first five radio results when they have already played', async (t) => {
  offline(t);
  const seed = song('yt_abcdefghijk', 'Anchor Artist');
  const radio = Array.from({ length: 20 }, (_, i) => ({
    ...song('radio-' + i, 'Neighbor ' + i),
    source: 'youtube',
  }));
  let requests = 0;
  t.mock.method(YouTubeMusicService, 'getRadioTracks', async () => {
    requests++;
    return radio;
  });
  const result = await WaveEngine.getWaveBatch(
    'default',
    [seed],
    [],
    [],
    [],
    {
      recentTracks: radio.slice(0, 8),
    },
    false,
  );
  assert.equal(requests, 1);
  assert.ok(result.length > 0);
  assert.ok(result.every((track) => !radio.slice(0, 8).some((heard) => heard.id === track.id)));
});

test('radio quotas prefer fresh recordings over earlier proposals including another provider upload', async () => {
  const seed = song('yt_abcdefghijk', 'Anchor Artist');
  const radio = Array.from({ length: 12 }, (_, i) => song('radio-' + i, 'Neighbor ' + i));
  const offered = radio
    .slice(0, 8)
    .map((track) => ({ ...track, id: 'copy-' + track.id, source: 'youtube' }));
  const result = await gatherWaveDiscovery(
    [seed],
    { offeredTracks: offered },
    {
      familiarArtists: ['Anchor Artist'],
      allowExpansion: false,
      perRadio: 3,
      maxRadioPosition: 20,
      related: async () => radio,
      accept: () => true,
    },
  );
  assert.deepEqual(
    result.tracks.map((track) => track.id),
    ['radio-8', 'radio-9', 'radio-10'],
  );
  const tiny = await gatherWaveDiscovery(
    [seed],
    { offeredTracks: offered },
    {
      familiarArtists: ['Anchor Artist'],
      allowExpansion: false,
      perRadio: 3,
      maxRadioPosition: 20,
      related: async () => radio.slice(0, 2),
      accept: () => true,
    },
  );
  assert.equal(tiny.tracks.length, 2);
});

test('radio anchors rotate away from artists in the last offered queue', () => {
  const a = song('yt_abcdefghijk', 'Artist A');
  const b = song('yt_bcdefghijkl', 'Artist B');
  const offered = Array.from({ length: 4 }, (_, i) => song('offered-' + i, 'Artist A'));
  assert.equal(selectWaveRelatedSeeds([a, b], { offeredTracks: offered }, 1, () => 0)[0].id, b.id);
});

test('wave IPC samples likes beyond the fixed first profile page without mutating the library', async (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  const likes = Array.from({ length: 80 }, (_, i) => ({
    deezer_id: 'liked-' + i,
    title: 'Melody ' + i,
    artist: 'Library ' + i,
    duration: 200,
  }));
  const originalIds = likes.map((row) => row.deezer_id);
  const db = Object.fromEntries(
    [
      'getDislikedTrackIds',
      'getWaveTasteTracks',
      'getPlaylistWaveTracks',
      'getFollowedArtists',
      'getScrobbledTopArtists',
      'getDislikedWaveTracks',
    ].map((name) => [name, () => []]),
  );
  db.getLikedTracks = () => likes;
  t.mock.method(MusicAggregatorService, 'getWaveBatch', async (_mood, seeds) => seeds);
  const handlers = new Map();
  registerWaveHandlers({ handle: (name, callback) => handlers.set(name, callback) }, db);
  const seeds = await handlers.get('music:getWaveBatch')(
    { sender: new EventEmitter() },
    'default',
    [],
    [],
    {},
    'variety',
  );
  assert.equal(seeds.length, 48);
  assert.ok(seeds.some((track) => Number(String(track.id).replace('liked-', '')) >= 48));
  assert.ok(seeds.every((track) => track.waveSeedWeight === 2));
  assert.deepEqual(
    likes.map((row) => row.deezer_id),
    originalIds,
  );
});

test('five later visits rebuild the wave from different parts of the library with restored storage each time', async (t) => {
  offline(t);
  t.mock.method(Math, 'random', () => 0.999);
  const artists = Array.from({ length: 50 }, (_, i) => 'Visit Artist ' + i);
  const seeds = artists.map((artist, i) => song('seed-' + i, artist));
  const titles = [
    'Amber skies',
    'Copper fields',
    'Silver moon',
    'Golden dawn',
    'Velvet stars',
    'Crimson sea',
    'Emerald horizon',
    'Frozen oceans',
    'Silent orchards',
    'Ivory mountains',
  ];
  t.mock.method(SoundCloudService, 'search', async (artist, limit) => ({
    data: titles.slice(0, limit).map((title, i) => song(artist + ':' + i, artist, title)),
  }));
  const saved = storage();
  let now = 1000000;
  const visitedArtists = new Set();
  const heard = new Set();
  for (let visit = 0; visit < 5; visit++) {
    const memory = createWaveMemory(saved, () => now);
    const batch = await WaveEngine.getWaveBatch(
      'mix',
      seeds,
      [],
      [],
      [],
      {
        recentTracks: memory.playedTracks(),
        offeredTracks: memory.offeredTracks(),
        source: 'soundcloud',
      },
      false,
    );
    assert.ok(batch.length >= 12, 'The next visit must still have a substantial queue');
    assert.ok(
      batch.every((track) => !heard.has(track.id)),
      'A played song reappeared after restart',
    );
    batch.forEach((track) => visitedArtists.add(track.artist.name));
    memory.recordOffered(batch);
    for (const track of batch.slice(0, 3)) {
      memory.recordPlayback(track, 180);
      heard.add(track.id);
    }
    now += 2 * 60 * 60 * 1000;
  }
  assert.ok(
    visitedArtists.size >= 28,
    `Only ${visitedArtists.size} library artists across five visits`,
  );
});
