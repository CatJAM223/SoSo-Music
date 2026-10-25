import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { initializeRustCompute } from '../../src/shared/compute/rustCore.ts';
import { RustTsDemuxer, RustLoudnessMeter } from '../../src/shared/compute/audioCore.ts';
import { rankImportCandidates } from '../../src/shared/services/playlistImport.ts';
import { scoreImportCandidate as reference } from '../../tests/fixtures/importBeforeRust.ts';
import { transportFixture } from '../../tests/helpers/mpegTsFixture.mjs';
await initializeRustCompute(
  fs.readFileSync(new URL('../../public/compute/soso-core.wasm', import.meta.url)),
);
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples,
  };
};
const measure = (fn, n = 31) => {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return stats(samples);
};
const original = {
  id: 'o',
  title: 'Falling into the ocean',
  artist: 'Example Artist',
  duration: 205,
};
const candidates = Array.from({ length: 24 }, (_, i) => ({
  id: 'yt_' + i,
  title:
    i % 4 === 0
      ? 'Falling into the ocean (Official Audio)'
      : i % 4 === 1
        ? 'Falling into the ocean remix'
        : i % 4 === 2
          ? 'Falling into the ocean stars'
          : 'Example Artist - Falling into the ocean',
  artist: { name: i % 5 === 0 ? 'Other Artist' : 'Example Artist' },
  source: 'youtube',
  duration: 200 + (i % 12),
}));
const before = () =>
  candidates
    .map((track) => ({ track, ...reference(original, track) }))
    .sort((a, b) => b.score - a.score);
const after = () => rankImportCandidates(original, candidates);
assert.deepEqual(after(), before());
for (let i = 0; i < 20; i++) {
  before();
  after();
}
const oldSamples = [],
  newSamples = [];
for (let i = 0; i < 31; i++) {
  const run = (fn, out) => {
    const t = performance.now();
    for (let j = 0; j < 100; j++) fn();
    out.push((performance.now() - t) / 100);
  };
  if (i % 2) {
    run(after, newSamples);
    run(before, oldSamples);
  } else {
    run(before, oldSamples);
    run(after, newSamples);
  }
}
const payload = Uint8Array.from({ length: 1048576 * 4 }, (_, i) => i & 255);
const fixture = transportFixture(payload, { video: true });
const demux = () => {
  const d = new RustTsDemuxer();
  let count = 0;
  for (let i = 0; i < fixture.bytes.length; i += 1024 * 1024)
    for (const b of d.push(fixture.bytes.subarray(i, i + 1024 * 1024))) count += b.length;
  assert.equal(count, payload.length);
  d.finish();
};
for (let i = 0; i < 6; i++) demux();
const demuxStats = measure(demux);
const left = Float32Array.from({ length: 128 }, (_, i) => 0.2 * Math.sin(i * 0.13)),
  right = Float32Array.from(left, (x) => x * 0.75);
const pcm = () => {
  const meter = new RustLoudnessMeter();
  for (let i = 0; i < (48000 * 30) / 128; i++) meter.push([left, right]);
  meter.gap();
  assert.ok(Number.isFinite(meter.read().gainDb));
};
for (let i = 0; i < 3; i++) pcm();
const pcmStats = measure(pcm, 15);
const result = {
  date: new Date().toISOString(),
  cpu: os.cpus()[0].model,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  methodology:
    'Warm local measurements. Import: 31 alternating paired runs, 100 real 24-candidate calls/run; all metadata preparation, Rust transfer and output mapping included. TS is the independent pre-port scorer from git. Demux: 31 runs including isolated instance creation and input/output copies, 1 MiB chunks. DSP: 15 runs of 30 seconds stereo PCM at 48 kHz in 128-frame blocks, including isolated instance creation, PCM copies and final stats. No network, audio decode or app packaging.',
  import: { candidates: 24, before: stats(oldSamples), rust: stats(newSamples) },
  demux: { inputBytes: fixture.bytes.length, outputBytes: payload.length, ...demuxStats },
  loudness: { audioSeconds: 30, channels: 2, sampleRate: 48000, quantum: 128, ...pcmStats },
};
fs.mkdirSync(new URL('../../docs/benchmarks/', import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL('../../docs/benchmarks/rust-audio-2026-10-24.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      ...result,
      import: { beforeMs: result.import.before.medianMs, rustMs: result.import.rust.medianMs },
      demux: { inputBytes: fixture.bytes.length, medianMs: demuxStats.medianMs },
      loudness: { audioSeconds: 30, medianMs: pcmStats.medianMs },
    },
    null,
    2,
  ),
);
