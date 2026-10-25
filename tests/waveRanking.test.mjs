import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { waveComputeFixture } from './helpers/waveComputeFixture.mjs';
import { moods, rankingCase } from './helpers/waveRankingCases.mjs';
import * as reference from './fixtures/waveBeforeFullRust.mjs';
import { encodeSongs, encodeNumbers } from '../src/shared/compute/songPacket.ts';
const bytes = fs.readFileSync(new URL('../public/compute/soso-core.wasm', import.meta.url));
assert.equal(
  await reference.initializeRustCompute(
    fs.readFileSync(new URL('./fixtures/waveBeforeFullRust.wasm', import.meta.url)),
  ),
  true,
);

test('A single Rust job preserves exact order across six moods, likes, history, feedback and genre tastes', async () => {
  const api = await waveComputeFixture();
  assert.equal(await api.initializeRustCompute(bytes), true);
  for (let seed = 0; seed < 12; seed++) {
    const c = rankingCase(80 + seed * 7, seed % 2 ? 40 : 80, seed % 3 ? 25 : 120, seed);
    c.options.recentTracks.push({ ...c.tracks[3], id: 'heard-copy' });
    c.options.offeredTracks = c.options.offeredTracks.slice(0, 79);
    c.options.offeredTracks.push({ ...c.tracks[7], id: 'offered-copy' });
    c.tracks.push({ ...c.tracks[9], id: 'version-copy', title: c.tracks[9].title + ' (Live)' });
    if (seed % 2 === 0) c.options.recentTracks.push({ ...c.tracks[19], waveSeedWeight: 2 });
    c.options.artistFeedback.set('nirvana artist 0', seed % 2 ? Infinity : -Infinity);
    if (seed % 3 === 0)
      c.options.libraryGenres = [
        { name: 'jazz', share: 0.65, tracks: 8 },
        { name: 'rock', share: 0.35, tracks: 4 },
      ];
    for (const mood of moods) {
      const args = [c.tracks, mood, c.familiar, c.limit, c.options];
      const before = api.computeObservations.rustBatches;
      const actual = api.sequenceWaveTracks(...args);
      assert.deepEqual(actual, reference.sequenceWaveTracks(...args), `seed ${seed}, ${mood}`);
      assert.equal(api.computeObservations.rustBatches, before + 1);
      assert.equal(api.computeObservations.matrices, 0, 'no matrix roundtrip via JS');
      assert.equal(
        api.computeObservations.comparisons,
        0,
        'no per-pair calls from queue preparation',
      );
      for (const item of actual) assert.ok(c.tracks.includes(item), 'keep original Track objects');
    }
  }
});
test('Small jobs, fractional limits, empty queues and huge offsets use Rust with unchanged results', async () => {
  const api = await waveComputeFixture();
  assert.equal(await api.initializeRustCompute(bytes), true);
  for (const [count, limit, offset] of [
    [0, 25, 0],
    [20, 25, 0],
    [100, 2, 0],
    [100, 25.5, 0],
    [100, 0, 0],
    [100, Infinity, 0],
    [100, NaN, 0],
    [100, 25, 1e20],
  ]) {
    const c = rankingCase(count, 0, limit);
    c.options.sequenceOffset = offset;
    const args = [c.tracks, 'mix', c.familiar, limit, c.options],
      before = api.computeObservations.rustBatches;
    assert.deepEqual(api.sequenceWaveTracks(...args), reference.sequenceWaveTracks(...args));
    assert.equal(api.computeObservations.rustBatches, before + 1, 'no JS fallback for small work');
  }
});
test('Rust ABI rejects malformed integrated jobs and recovers without an alternative implementation', async () => {
  const { instance } = await WebAssembly.instantiate(bytes, {}),
    c = instance.exports;
  const songs = encodeSongs([]),
    numbers = encodeNumbers([0x46574f53, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const valid = new Uint8Array(4 + songs.length + numbers.length);
  new DataView(valid.buffer).setUint32(0, songs.length, true);
  valid.set(songs, 4);
  valid.set(numbers, 4 + songs.length);
  const run = (data) => {
    const p = c.reserve(data.length);
    new Uint8Array(c.memory.buffer, p, data.length).set(data);
    return c.sequence_wave(data.length);
  };
  assert.equal(run(valid), 0);
  for (const end of [0, 3, 4, 16, valid.length - 1]) assert.equal(run(valid.slice(0, end)), -1);
  for (const [word, value] of [
    [0, 0],
    [1, 2],
    [2, 6],
    [3, 4097],
    [4, -1],
    [4, Infinity],
    [6, 1],
    [13, 2],
    [14, 65537],
    [16, 41],
  ]) {
    const bad = valid.slice();
    new DataView(bad.buffer).setFloat64(4 + songs.length + word * 8, value, true);
    assert.equal(run(bad), -1, `invalid field ${word}`);
  }
  assert.equal(c.sequence_wave(8 * 1024 * 1024 + 1), -1);
  assert.equal(run(valid), 0);
});
test('Production contains one scorer and no JavaScript duplicate detection or selection fallback', () => {
  for (const name of [
    'src/shared/utils/waveCandidateRanking.ts',
    'src/shared/compute/waveRanking.ts',
  ])
    assert.equal(fs.existsSync(new URL('../' + name, import.meta.url)), false);
  const read = (name) => fs.readFileSync(new URL('../src/shared/' + name, import.meta.url), 'utf8');
  assert.doesNotMatch(
    read('utils/trackFingerprint.ts'),
    /function (?:levenshtein|tokensMatch|countOverlappingTokens)/,
  );
  assert.doesNotMatch(read('utils/waveIdentity.ts'), /function oneCharacterApart/);
  assert.doesNotMatch(
    read('utils/waveMusicProfile.ts'),
    /function similarity|negativeEvidence|decay \*\*/,
  );
  assert.doesNotMatch(read('utils/waveQueue.ts'), /bestScore|scoreWaveCandidate|while \(remaining/);
  assert.doesNotMatch(read('compute/rustCore.ts'), /using JavaScript|fallback/i);
});
