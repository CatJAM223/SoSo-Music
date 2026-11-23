import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { initializeRustCompute } from '../../src/shared/compute/rustCore.ts';
import { rankSearchTracks as rust } from '../../src/shared/utils/searchRanking.ts';
import { rankSearchTracks as before } from '../../tests/fixtures/searchRankingBeforeRust.mjs';
import { searchTracks } from '../../tests/helpers/searchRankingCases.mjs';
assert.equal(
  await initializeRustCompute(
    fs.readFileSync(new URL('../../public/compute/soso-core.wasm', import.meta.url)),
  ),
  true,
);
const stats = (samples) => {
  samples.sort((a, b) => a - b);
  return { medianMs: samples[15], p95Ms: samples[29] };
};
const rows = [];
for (const [count, query, distinct] of [
  [30, 'love', false],
  [200, 'love', false],
  [200, 'Radiohead - Paranoid Android', false],
  [2000, 'Radiohead - Paranoid Android', false],
  [2000, 'love', true],
  [2000, 'Radiohead - Paranoid Android', true],
]) {
  const tracks = searchTracks(count).map((track, index) =>
    distinct
      ? {
          ...track,
          title: track.title + ' distinct ' + index,
          artist: { name: track.artist.name + ' ' + index },
        }
      : track,
  );
  for (let i = 0; i < 10; i++) {
    rust(tracks, query);
    before(tracks, query);
  }
  const old = [],
    current = [];
  const sample = (fn) => {
    const start = performance.now();
    for (let i = 0; i < 5; i++) fn(tracks, query);
    return (performance.now() - start) / 5;
  };
  for (let i = 0; i < 31; i++) {
    if (i % 2) {
      current.push(sample(rust));
      old.push(sample(before));
    } else {
      old.push(sample(before));
      current.push(sample(rust));
    }
  }
  const previous = stats(old),
    next = stats(current);
  rows.push({
    count,
    query,
    distinctMetadata: Boolean(distinct),
    previous,
    current: next,
    medianSpeedup: previous.medianMs / next.medianMs,
  });
}
const report = {
  node: process.version,
  abi: 9,
  method:
    '31 alternating paired warm samples with five calls per sample. Frozen TypeScript baseline vs current Rust ranking, including serialization and copies. Synthetic inputs exclude provider latency and WASM startup.',
  rows,
};
console.log(JSON.stringify(report, null, 2));
