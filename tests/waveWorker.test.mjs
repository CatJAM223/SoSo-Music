import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WaveWorkerTransport } from '../src/shared/compute/waveWorkerTransport.ts';
import { createNativeWaveWorker } from './helpers/nativeWaveWorker.mjs';
import { resequenceWaveQueue } from '../src/shared/utils/waveQueue.ts';
import { rankingCase, moods } from './helpers/waveRankingCases.mjs';
const bytes = () =>
  new Uint8Array(fs.readFileSync(new URL('../public/compute/soso-core.wasm', import.meta.url)));
const argsFor = (c) => [
  c.tracks,
  -1,
  'mix',
  c.familiar,
  c.options.artistFeedback,
  c.options.recentTracks,
  c.options.offeredTracks,
  c.options,
];
test('Real background worker executes the same Rust pipeline for all modes while keeping the parent responsive', async () => {
  const transport = new WaveWorkerTransport(createNativeWaveWorker, bytes);
  try {
    const c = rankingCase(160, 40, 160);
    for (const mood of moods) {
      const args = argsFor(c);
      args[2] = mood;
      const indices = await transport.resequence(args);
      assert.deepEqual(
        indices.map((i) => c.tracks[i]),
        resequenceWaveQueue(...args),
      );
    }
    let ticks = 0;
    const timer = setInterval(() => ticks++, 2);
    const large = rankingCase(1000, 300, 1000);
    const indices = await transport.resequence(argsFor(large));
    clearInterval(timer);
    assert.equal(indices.length, 1000);
    assert.ok(ticks > 2, 'parent event loop must continue during compute');
  } finally {
    transport.dispose();
  }
});
test('Idle termination releases the worker and the next request initializes a fresh Rust instance', async () => {
  let created = 0,
    terminated = 0;
  const transport = new WaveWorkerTransport(
    () => {
      created++;
      const port = createNativeWaveWorker();
      const stop = port.terminate;
      port.terminate = () => {
        terminated++;
        stop();
      };
      return port;
    },
    bytes,
    15,
  );
  try {
    const c = rankingCase(40, 0, 40);
    await transport.resequence(argsFor(c));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(terminated, 1);
    await transport.resequence(argsFor(c));
    assert.equal(created, 2);
  } finally {
    transport.dispose();
  }
});
test('Cancelling a queued job rejects its result and a later request still uses Rust', async () => {
  const transport = new WaveWorkerTransport(createNativeWaveWorker, bytes);
  try {
    const c = rankingCase(30, 0, 30);
    await transport.resequence(argsFor(c));
    const controller = new AbortController();
    const pending = transport.resequence(argsFor(rankingCase(1000, 40, 1000)), controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    const result = await transport.resequence(argsFor(c));
    assert.equal(result.length, 30);
  } finally {
    transport.dispose();
  }
});
test('Worker failure rejects queued jobs and a future request creates a new native worker', async () => {
  let created = 0;
  let port;
  const transport = new WaveWorkerTransport(() => {
    created++;
    port = createNativeWaveWorker();
    return port;
  }, bytes);
  try {
    const args = argsFor(rankingCase(30, 0, 30));
    await transport.resequence(args);
    const pending = transport.resequence(args);
    await Promise.resolve();
    port.onerror({ message: 'forced worker failure', preventDefault() {} });
    await assert.rejects(pending, /forced worker failure/);
    await transport.resequence(args);
    assert.equal(created, 2);
  } finally {
    transport.dispose();
  }
});

test('Worker startup failure and startup cancellation reject explicitly without blocking the caller', async () => {
  const args = argsFor(rankingCase(20, 0, 20));
  const unavailable = new WaveWorkerTransport(() => {
    throw Error('No Worker available');
  }, bytes);
  await assert.rejects(unavailable.resequence(args), /No Worker available/);
  unavailable.dispose();
  let terminated = 0;
  const port = {
    postMessage() {},
    terminate() {
      terminated++;
    },
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  const transport = new WaveWorkerTransport(() => port, bytes, 1000, 25);
  const controller = new AbortController(),
    pending = transport.resequence(args, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  transport.dispose();
  assert.equal(terminated, 1);
});
test('A silent worker times out, releases pending jobs and can be replaced', async () => {
  let terminated = 0;
  const transport = new WaveWorkerTransport(
    () => ({
      postMessage() {},
      terminate() {
        terminated++;
      },
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    }),
    bytes,
    1000,
    20,
  );
  try {
    await assert.rejects(transport.resequence(argsFor(rankingCase(20, 0, 20))), /timed out/);
    assert.equal(terminated, 1);
  } finally {
    transport.dispose();
  }
});
