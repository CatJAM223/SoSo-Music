import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { sequenceWaveTracks } from '../../src/shared/utils/waveQueue.ts';
import { initializeRustCompute } from '../../src/shared/compute/rustCore.ts';
import * as before from '../../tests/fixtures/waveBeforeFullRust.mjs';
import { rankingCase, moods } from '../../tests/helpers/waveRankingCases.mjs';
import { createWaveLearning, WAVE_LEARNING_KEY } from '../../src/shared/services/waveLearning.ts';
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
    'Warm rotated runs on deterministic offline inputs. Each sample measures the historical pre-migration snapshot, current legacy policy, and current balanced policy with attribution. Timing mood=mix. Initialization excluded. p95 nearest rank.',
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
  const adaptive = () =>
    sequenceWaveTracks(
      c.tracks,
      'mix',
      c.familiar,
      limit,
      { ...c.options, novelty: 'balanced' },
      true,
    );
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
    adaptive();
  }
  const old = [],
    rust = [],
    adaptiveSamples = [];
  const run = (fn, out) => {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  };
  const calls = [
    [() => before.sequenceWaveTracks(...args), old],
    [() => sequenceWaveTracks(...args), rust],
    [adaptive, adaptiveSamples],
  ];
  for (let i = 0; i < samples; i++)
    for (let j = 0; j < calls.length; j++) run(...calls[(i + j) % calls.length]);
  const entry = {
    count,
    history,
    limit,
    selectedCount: sequenceWaveTracks(...args).length,
    before: stats(old),
    rust: stats(rust),
    adaptive: stats(adaptiveSamples),
  };
  entry.speedup = entry.before.medianMs / entry.rust.medianMs;
  report.cases.push(entry);
  console.log(
    `${count} -> ${limit}: historical ${entry.before.medianMs.toFixed(2)} ms, legacy ${entry.rust.medianMs.toFixed(2)} ms, adaptive ${entry.adaptive.medianMs.toFixed(2)} ms`,
  );
}
let saved;
const learning = createWaveLearning(
  {
    getItem: () => null,
    setItem: (key, value) => {
      if (key === WAVE_LEARNING_KEY) saved = value;
    },
  },
  () => 1000,
);
function feed(index) {
  const event = {
    recommendationId: 'recommendation-' + index,
    episodeId: 'episode-' + index,
    tasteRevision: 0,
    mood: 'default',
    selectedSource: 'all',
    method: 'similar',
  };
  learning.observe({ ...event, event: 'started' }, 0);
  learning.observe(
    { ...event, event: 'outcome', playedSeconds: 179, durationSeconds: 180, reason: 'ended' },
    0,
  );
}
global.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const observations = 10000;
const start = performance.now();
for (let i = 0; i < observations; i++) feed(i);
const updateMs = performance.now() - start;
learning.flush();
global.gc?.();
report.learning = {
  observations,
  updateMs,
  storageBytes: Buffer.byteLength(saved),
  episodes: JSON.parse(saved).episodes.length,
  retainedHeapDeltaBytes: global.gc ? process.memoryUsage().heapUsed - heapBefore : null,
};
fs.writeFileSync(
  new URL('scratch/wave-full-rust-benchmark.json', root),
  JSON.stringify(report, null, 2) + '\n',
);
console.log('Report: scratch/wave-full-rust-benchmark.json');
console.log('Learning:', report.learning);
