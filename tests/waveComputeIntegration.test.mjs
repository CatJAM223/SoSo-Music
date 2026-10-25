import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { waveComputeFixture } from './helpers/waveComputeFixture.mjs';

const bytes = fs.readFileSync(new URL('../public/compute/soso-core.wasm', import.meta.url));
const track = (id, title, artist = 'Fixture Artist') => ({
  id,
  source: 'soundcloud',
  title,
  artist: { name: artist },
  duration: 200,
  album: { title: 'Single' },
});
const filler = () =>
  Array.from({ length: 85 }, (_, i) =>
    track('filler-' + i, 'Distant Mountain Chapter ' + i, 'Artist ' + (i % 17)),
  );
function scenario() {
  const heard = track('heard', 'Smells Like Teen Spirit', 'Nirvana');
  return {
    tracks: [
      track('heard-copy', 'Smells Like Teen Spirit', 'Nirvana'),
      track('heard-live', 'Smells Like Teen Spirit (Live)', 'Nirvana'),
      track('ordinary', 'Golden Horizon Beyond Mountains', 'Artist A'),
      track('alternative', 'Golden Horizon Beyond Mountains (Live)', 'Artist A'),
      track('home-a', 'Home', 'Artist A'),
      track('home-b', 'Home', 'Artist B'),
      { ...track('unavailable', 'Unavailable'), playbackUnavailable: true },
      ...filler(),
    ],
    options: { recentTracks: [heard], offeredTracks: [] },
  };
}
function assertQueueContract(queue) {
  const ids = queue.map((item) => item.id);
  assert.ok(!ids.includes('heard-copy') && !ids.includes('heard-live'), 'heard family returned');
  assert.ok(ids.includes('ordinary'), 'ordinary recording disappeared');
  assert.ok(!ids.includes('alternative'), 'alternative version returned');
  assert.ok(
    ids.includes('home-a') && ids.includes('home-b'),
    'different songs sharing a short title must survive',
  );
  assert.ok(!ids.includes('unavailable'), 'unavailable track returned');
}
const moods = ['default', 'energy', 'chill', 'discover', 'mix', 'favorites'];

test('Public wave queue uses the Rust results for history, deduplication and exposure', async () => {
  const api = await waveComputeFixture(process.env.SOSO_WAVE_TEST_MUTATION || '');
  assert.equal(await api.initializeRustCompute(bytes), true);
  for (const mood of moods) {
    const { tracks, options } = scenario();
    const before = { ...api.computeObservations };
    const queue = api.sequenceWaveTracks(tracks, mood, [], 200, options);
    assert.equal(
      api.computeObservations.calls,
      before.calls + 1,
      'wave must call the Rust adapter',
    );
    assert.equal(
      api.computeObservations.rustBatches,
      before.rustBatches + 1,
      'supported public wave batch must use Rust',
    );
    assertQueueContract(queue);
  }
  const offered = track('offered', 'Ivory Horizon', 'Offer Artist'),
    fresh = track('fresh', 'Silver Mountain', 'Offer Artist');
  const queue = api.sequenceWaveTracks(
    [offered, fresh, ...filler()],
    'favorites',
    ['Offer Artist'],
    25,
    { offeredTracks: [offered] },
  );
  assert.equal(queue[0]?.id, 'fresh', 'offered songs must lose priority');
});

test('Missing, corrupt or old Rust modules fail explicitly without a JS algorithm fallback', async () => {
  for (const bytes of [
    null,
    new Uint8Array([0, 1, 2, 3]),
    fs.readFileSync(new URL('./fixtures/waveBeforeFullRust.wasm', import.meta.url)),
  ]) {
    const api = await waveComputeFixture();
    if (bytes) assert.equal(await api.initializeRustCompute(bytes), false);
    const { tracks, options } = scenario();
    assert.throws(() => api.sequenceWaveTracks(tracks, 'default', [], 200, options), /Rust/);
    assert.equal(api.computeObservations.rustBatches, 0);
  }
});
test('Former JS fallback sizes and small jobs now execute the same required Rust pipeline', async () => {
  const api = await waveComputeFixture();
  assert.equal(await api.initializeRustCompute(bytes), true);
  for (const options of [
    {
      recentTracks: Array.from({ length: 301 }, (_, i) =>
        track('past-' + i, 'Past Journey ' + i, 'Past Artist'),
      ),
    },
    {
      offeredTracks: Array.from({ length: 81 }, (_, i) =>
        track('offered-' + i, 'Past Journey ' + i, 'Past Artist'),
      ),
    },
    {},
  ]) {
    const before = api.computeObservations.rustBatches;
    const input = filler().slice(0, options.recentTracks ? 85 : 10);
    assert.ok(api.sequenceWaveTracks(input, 'default', [], 25, options).length);
    assert.equal(api.computeObservations.rustBatches, before + 1);
  }
});
test('A native calculation failure propagates; later queued music is not fabricated in JS', async () => {
  const api = await waveComputeFixture('reject-ranking');
  assert.equal(await api.initializeRustCompute(bytes), true);
  const { tracks, options } = scenario();
  assert.throws(
    () => api.sequenceWaveTracks(tracks, 'mix', [], 25, options),
    /Forced Rust rejection/,
  );
  assert.equal(api.computeObservations.rustBatches, 0);
});
