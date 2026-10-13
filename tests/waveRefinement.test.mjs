import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWaveMemory,
  WAVE_MEMORY_KEY,
  WAVE_PLAYED_TTL,
  WAVE_OFFERED_TTL,
} from '../src/shared/services/waveMemory.ts';
import { gatherWaveDiscovery } from '../src/shared/services/waveDiscovery.ts';
import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';
import {
  normalizeWaveBatchContext,
  selectWaveRelatedSeeds,
} from '../src/shared/utils/waveRecommendations.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
const track = (id, artist, title = 'Song ' + id) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 200,
  preview: '',
  source: String(id).startsWith('yt_') ? 'youtube' : 'soundcloud',
});
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('Played memory survives reload while offered songs do not become played; caches contain only identity', () => {
  const saved = storage();
  let now = 100000;
  const memory = createWaveMemory(saved, () => now);
  const heard = {
    ...track('yt_abcdefghijk', 'Known'),
    resolvedStreamUrl: 'https://signed.invalid',
    resolvedStreamTimestamp: 1,
    preview: 'https://signed.invalid',
    cover_url: 'huge image',
  };
  const proposed = track('yt_bcdefghijkl', 'New');
  memory.recordOffered([heard, proposed]);
  assert.equal(memory.playedTracks().length, 0);
  assert.equal(memory.recordPlayback(heard, 0), false);
  assert.equal(memory.recordPlayback(heard, 1), false);
  assert.equal(memory.recordPlayback(heard, 5), true);
  const restored = createWaveMemory(saved, () => now);
  assert.deepEqual(
    restored.playedTracks().map((t) => t.id),
    [heard.id],
  );
  assert.deepEqual(
    restored.offeredTracks().map((t) => t.id),
    [proposed.id],
  );
  const raw = saved.getItem(WAVE_MEMORY_KEY);
  assert.ok(!raw.includes('signed.invalid'));
  assert.ok(!raw.includes('huge image'));
  now += WAVE_OFFERED_TTL + 1;
  assert.equal(restored.offeredTracks().length, 0);
  assert.equal(restored.playedTracks().length, 1);
  now += WAVE_PLAYED_TTL;
  assert.equal(restored.playedTracks().length, 0);
});
test('Wave memory bounds history, throttles ongoing writes, and recovers from corrupt or full storage', () => {
  const saved = storage();
  let writes = 0,
    now = 200000;
  const set = saved.setItem;
  saved.setItem = (...args) => {
    writes++;
    set(...args);
  };
  saved.setItem(WAVE_MEMORY_KEY, '{broken');
  const memory = createWaveMemory(saved, () => now);
  for (let i = 0; i < 340; i++) {
    now++;
    memory.recordPlayback(track(String(i), 'Singer ' + i), 3);
  }
  assert.equal(memory.playedTracks().length, 300);
  assert.equal(memory.playedTracks()[0].id, '40');
  const baseline = writes;
  assert.equal(memory.recordPlayback(track('339', 'Singer 99'), 4), false);
  assert.equal(writes, baseline);
  now += 10000;
  assert.equal(memory.recordPlayback(track('339', 'Singer 99'), 15), true);
  saved.setItem = () => {
    throw Error('full');
  };
  memory.recordPlayback(track('new', 'New singer'), 5);
  assert.equal(memory.playedTracks().at(-1).id, 'new');
});
test('Unheard proposals lose priority but remain available; heard reuploads are excluded', () => {
  const offered = track('one', 'Artist A', 'First melody'),
    fresh = track('two', 'Artist B', 'Second melody');
  const ordered = sequenceWaveTracks([offered, fresh], 'default', [], 25, {
    offeredTracks: [offered],
  });
  assert.equal(ordered[0].id, 'two');
  assert.equal(ordered.length, 2);
  assert.equal(
    sequenceWaveTracks([offered], 'default', [], 25, { offeredTracks: [offered] }).length,
    1,
  );
  const copy = track('copy', 'Artist A', 'First melody (Official Audio)');
  assert.deepEqual(
    sequenceWaveTracks([copy, fresh], 'default', [], 25, { recentTracks: [offered] }).map(
      (t) => t.id,
    ),
    ['two'],
  );
});
test('Anchor rotation explores other liked songs, keeps artist diversity and source balance', () => {
  const seeds = [
    track('yt_abcdefghijk', 'A'),
    track('yt_bcdefghijkl', 'B'),
    track('sc_12345', 'C'),
    track('yt_cdefghijklm', 'D'),
    track('sc_67890', 'E'),
  ];
  const initial = selectWaveRelatedSeeds(seeds, {}, 3, () => 0);
  const rotated = selectWaveRelatedSeeds(
    seeds,
    {},
    3,
    () => 0,
    initial.map((t) => String(t.id)),
  );
  assert.ok(rotated.some((t) => t.artist.name === 'D'));
  assert.ok(rotated.some((t) => t.artist.name === 'E'));
  assert.equal(new Set(rotated.map((t) => t.artist.name)).size, 3);
  assert.equal(new Set(rotated.map((t) => t.source)).size, 2);
});
test('Discovery expands a narrow taste radio through nearby music with at most two extra requests', async () => {
  const seed = track('yt_abcdefghijk', 'Favorite'),
    nearA = track('yt_bcdefghijkl', 'Near A'),
    nearB = track('yt_cdefghijklm', 'Near B');
  const calls = [],
    accepted = new Set();
  const result = await gatherWaveDiscovery(
    [seed],
    {},
    {
      familiarArtists: ['Favorite'],
      async related(anchor) {
        calls.push(anchor.id);
        return anchor.id === seed.id
          ? [nearA, nearB]
          : Array.from({ length: 6 }, (_, i) =>
              track(
                'yt_vid' + String(i).padStart(8, '0'),
                'Discovered ' + anchor.id + ' ' + i,
                'New tune ' + anchor.id + ' ' + i,
              ),
            );
      },
      accept(t) {
        if (accepted.has(t.id)) return false;
        accepted.add(t.id);
        return true;
      },
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(result.expanded, true);
  assert.ok(result.tracks.length >= 8);
  assert.ok(result.tracks.every((t) => t.artist.name !== 'Favorite'));
});
test('Broad discovery interleaves anchor ranks, adds no second hop, and stays under its candidate budget', async () => {
  const seeds = [
    track('yt_abcdefghijk', 'A'),
    track('yt_bcdefghijkl', 'B'),
    track('yt_cdefghijklm', 'C'),
  ];
  let calls = 0;
  const result = await gatherWaveDiscovery(
    seeds,
    {},
    {
      familiarArtists: ['A', 'B', 'C'],
      async related(anchor) {
        calls++;
        return Array.from({ length: 20 }, (_, i) =>
          track('id_' + anchor.id + '_' + i, anchor.artist.name + ' nearby ' + i),
        );
      },
      accept: () => true,
    },
  );
  assert.equal(calls, 3);
  assert.equal(result.expanded, false);
  assert.equal(result.tracks.length, 18);
  assert.equal(
    new Set(result.tracks.slice(0, 3).map((t) => t.artist.name.split(' nearby')[0])).size,
    3,
  );
});
test('Provider failure is contained and rejected recordings do not consume discovery slots', async () => {
  const seeds = [track('yt_abcdefghijk', 'A'), track('yt_bcdefghijkl', 'B')];
  let calls = 0;
  const result = await gatherWaveDiscovery(
    seeds,
    {},
    {
      familiarArtists: ['A', 'B'],
      async related(anchor) {
        calls++;
        if (anchor.artist.name === 'A') throw Error('offline');
        return [
          track('bad', 'Noise'),
          ...Array.from({ length: 10 }, (_, i) => track('valid' + i, 'Fresh ' + i)),
        ];
      },
      accept: (t) => t.id !== 'bad',
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.tracks.length, 6);
  assert.ok(!result.tracks.some((t) => t.id === 'bad'));
});
test('New exposure context is bounded and strips artwork, audio links and invalid reaction data', () => {
  const context = normalizeWaveBatchContext({
    offeredTracks: Array.from({ length: 140 }, (_, i) => ({
      ...track(String(i), 'Singer'),
      preview: 'https://signed.invalid',
      album: { title: 'Album', cover: 'large data' },
    })),
  });
  assert.equal(context.offeredTracks.length, 80);
  assert.equal(context.offeredTracks[0].id, '60');
  assert.equal(context.offeredTracks[0].preview, '');
  assert.equal(context.offeredTracks[0].album.cover, undefined);
});
test('Desktop wave can reoffer an unheard proposal but never a recently heard recording', async (t) => {
  const oldMemory = WaveEngine.sessionPrints,
    oldAnchors = WaveEngine.relatedAnchorIds;
  WaveEngine.sessionPrints = [];
  WaveEngine.relatedAnchorIds = [];
  t.after(() => {
    WaveEngine.sessionPrints = oldMemory;
    WaveEngine.relatedAnchorIds = oldAnchors;
  });
  const seed = track('yt_abcdefghijk', 'Favorite', 'Liked tune');
  const proposal = track('sc_12345', 'Favorite', 'Unheard song');
  t.mock.method(YouTubeMusicService, 'getRadioTracks', async () => []);
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  t.mock.method(SoundCloudService, 'search', async () => ({ data: [proposal] }));
  t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
  assert.ok((await WaveEngine.getWaveBatch('default', [seed])).some((t) => t.id === proposal.id));
  assert.ok((await WaveEngine.getWaveBatch('default', [seed])).some((t) => t.id === proposal.id));
  assert.ok(
    !(
      await WaveEngine.getWaveBatch('default', [seed], [], [], [], { recentTracks: [proposal] })
    ).some((t) => t.id === proposal.id),
  );
});

test('Conservative discovery stays with direct taste radios and ignores their low-ranked tail', async () => {
  const seeds = [track('yt_abcdefghijk', 'Favorite A'), track('yt_bcdefghijkl', 'Favorite B')];
  const calls = [];
  const result = await gatherWaveDiscovery(
    seeds,
    {},
    {
      familiarArtists: ['Favorite A', 'Favorite B'],
      allowExpansion: false,
      perRadio: 3,
      maxRadioPosition: 5,
      related: async (anchor) => {
        calls.push(anchor.id);
        return Array.from({ length: 20 }, (_, i) =>
          track('radio_' + anchor.id + '_' + i, 'Neighbor ' + anchor.id + ' nearby ' + i),
        );
      },
      accept: () => true,
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(result.expanded, false);
  assert.equal(result.tracks.length, 6);
  assert.ok(result.tracks.every((t) => Number(t.artist.name.split(' nearby ')[1]) < 5));
});

test('Default wave reserves three of four slots for familiar artists on a sufficiently diverse catalog', () => {
  const known = Array.from({ length: 20 }, (_, i) => track('known' + i, 'Favorite ' + i));
  const unknown = Array.from({ length: 20 }, (_, i) => track('new' + i, 'Discovery ' + i));
  const result = sequenceWaveTracks(
    [...unknown, ...known],
    'default',
    known.map((t) => t.artist.name),
    16,
  );
  assert.equal(result.filter((t) => t.id.startsWith('known')).length, 12);
});
