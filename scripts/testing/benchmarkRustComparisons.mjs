import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { initializeRustCompute } from '../../src/shared/compute/rustCore.ts';
import {
  compareWaveSongs,
  createSongDeduplicator,
} from '../../src/shared/compute/waveSongMatrix.ts';

assert.equal(
  await initializeRustCompute(
    fs.readFileSync(new URL('../../public/compute/soso-core.wasm', import.meta.url)),
  ),
  true,
);
const song = (id) => {
  const tokens = ['golden', 'mountain', 'recording' + id];
  return {
    artists: ['artist' + (id % 9)],
    print: {
      tokens,
      set: new Set(tokens),
      variants: new Set(),
      dur: 180 + (id % 5),
    },
  };
};
function previous(songs) {
  const accepted = [];
  for (let i = 0; i < songs.length; i++) {
    if (!accepted.some((left) => compareWaveSongs(songs[left], songs[i]))) accepted.push(i);
  }
  return accepted;
}
function current(songs) {
  const deduper = createSongDeduplicator(songs, (value) => value);
  const accepted = [];
  for (let i = 0; i < songs.length; i++) {
    if (!deduper.hasDuplicate(i)) {
      deduper.accept(i);
      accepted.push(i);
    }
  }
  return accepted;
}
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
const rows = [];
for (const [name, count, families] of [
  ['small-distinct', 24, 24],
  ['catalog-distinct', 96, 96],
  ['reuploads', 96, 12],
]) {
  const songs = Array.from({ length: count }, (_, i) => song(i % families));
  const expected = previous(songs);
  assert.deepEqual(current(songs), expected);
  for (let i = 0; i < 20; i++) {
    previous(songs);
    current(songs);
  }
  const samples = { previous: [], current: [] };
  for (let i = 0; i < 31; i++) {
    for (const [label, run] of i % 2
      ? [
          ['current', current],
          ['previous', previous],
        ]
      : [
          ['previous', previous],
          ['current', current],
        ]) {
      const start = performance.now();
      for (let repeat = 0; repeat < 5; repeat++) run(songs);
      samples[label].push((performance.now() - start) / 5);
    }
  }
  const before = stats(samples.previous),
    after = stats(samples.current);
  rows.push({
    name,
    count,
    retained: expected.length,
    previous: before,
    current: after,
    medianSpeedup: before.medianMs / after.medianMs,
  });
}
const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  method:
    '31 paired alternating warm samples, 5 complete deduplication calls per sample. Previous individual production Rust comparisons vs current production batched deduplicator on the same WASM binary. Includes accepted-list traversal, packet encoding, WASM, copying and output mapping. Unchanged text identity preparation and WASM initialization excluded. At most 96 candidates: previous dense-matrix threshold cannot trigger. Deterministic synthetic metadata; not provider or whole-player latency.',
  rows,
};
fs.mkdirSync(new URL('../../scratch/', import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL('../../scratch/rust-comparisons-benchmark.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
