import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { sequenceWaveTracks } from '../../src/shared/utils/waveQueue.ts';
import { initializeRustCompute } from '../../src/shared/compute/rustCore.ts';
import * as before from '../../tests/fixtures/waveBeforeFullRust.mjs';
import { rankingCase, moods } from '../../tests/helpers/waveRankingCases.mjs';
const root = new URL('../../', import.meta.url);
assert.equal(
  await before.initializeRustCompute(
    fs.readFileSync(new URL('tests/fixtures/waveBeforeFullRust.wasm', root)),
  ),
  true,
);
assert.equal(
  await initializeRustCompute(fs.readFileSync(new URL('public/compute/soso-core.wasm', root))),
  true,
);
const samples = Number(process.env.SOSO_BENCH_SAMPLES || 31);
assert.ok(Number.isSafeInteger(samples) && samples >= 5);
const warmup = 12;
const report = {
  date: new Date().toISOString(),
  node: process.version,
  cpu: os.cpus()[0].model.trim(),
  platform: process.platform,
  arch: process.arch,
  samples,
  warmup,
  artifact: JSON.parse(fs.readFileSync(new URL('public/compute/soso-core.json', root), 'utf8')),
  method:
    'Paired alternating warm runs; exact saved production snapshot immediately before complete migration, including its own ABI 2 WASM, vs current required ABI 3 single-job pipeline. Full synchronous sequenceWaveTracks call: text metadata, packing, transfer, all Rust work, result copy/mapping. Deterministic offline inputs; timing mood=mix. Initialization excluded. p95 nearest rank. Worker responsiveness is measured separately in Chromium.',
  cases: [],
};
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samplesMs: values,
  };
}
for (const [count, history, limit] of [
  [30, 0, 25],
  [60, 40, 25],
  [120, 300, 25],
  [200, 300, 25],
  [200, 40, 200],
  [500, 300, 500],
  [1000, 300, 25],
  [1000, 300, 1000],
]) {
  const c = rankingCase(count, history, limit),
    args = [c.tracks, 'mix', c.familiar, limit, c.options];
  for (const mood of moods) {
    const a = [c.tracks, mood, c.familiar, limit, c.options];
    assert.deepEqual(
      sequenceWaveTracks(...a),
      before.sequenceWaveTracks(...a),
      `${count}/${limit}/${mood}`,
    );
  }
  for (let i = 0; i < warmup; i++) {
    before.sequenceWaveTracks(...args);
    sequenceWaveTracks(...args);
  }
  const old = [],
    rust = [];
  const run = (fn, out) => {
    const t = performance.now();
    fn(...args);
    out.push(performance.now() - t);
  };
  for (let i = 0; i < samples; i++) {
    if (i % 2) {
      run(sequenceWaveTracks, rust);
      run(before.sequenceWaveTracks, old);
    } else {
      run(before.sequenceWaveTracks, old);
      run(sequenceWaveTracks, rust);
    }
  }
  const entry = {
    count,
    history,
    limit,
    selectedCount: sequenceWaveTracks(...args).length,
    before: stats(old),
    rust: stats(rust),
  };
  entry.speedup = entry.before.medianMs / entry.rust.medianMs;
  report.cases.push(entry);
  console.log(
    `${count} -> ${limit}: before ${entry.before.medianMs.toFixed(2)} ms, Rust ${entry.rust.medianMs.toFixed(2)} ms, ${entry.speedup.toFixed(2)}x`,
  );
}
fs.writeFileSync(
  new URL('scratch/wave-full-rust-benchmark.json', root),
  JSON.stringify(report, null, 2) + '\n',
);
console.log('Report: scratch/wave-full-rust-benchmark.json');
