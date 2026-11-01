import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runStartupTask } from '../src/shared/utils/startupTask.ts';

test('Startup bounds silent loading, aborts its transport and ignores late completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, complete;
  const pending = runStartupTask((current) => {
    signal = current;
    return new Promise((resolve) => {
      complete = resolve;
    });
  }, 100);
  await Promise.resolve();
  const rejected = assert.rejects(pending, /PLAYER_STARTUP_TIMEOUT/);
  t.mock.timers.tick(100);
  await rejected;
  assert.equal(signal.aborted, true);
  complete('late');
  await assert.rejects(pending, /PLAYER_STARTUP_TIMEOUT/);
});

test('Startup failures release their deadline and allow an independent successful attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await assert.rejects(
    runStartupTask(() => {
      throw Error('missing file');
    }, 100),
    /missing file/,
  );
  assert.equal(await runStartupTask(async () => 'ready', 100), 'ready');
  t.mock.timers.tick(1000);
});

test('A rejected required Rust initialization can retry valid bytes and deduplicates concurrent calls', async () => {
  const { initializeRustCompute, requireRustCompute } =
    await import('../src/shared/compute/rustCore.ts?startup-retry');
  const first = initializeRustCompute(new Uint8Array([0, 1, 2]));
  assert.equal(initializeRustCompute(new Uint8Array([9])), first);
  assert.equal(await first, false);
  assert.throws(() => requireRustCompute(), /Rust/);
  const bytes = fs.readFileSync(new URL('../public/compute/soso-core.wasm', import.meta.url));
  assert.equal(await initializeRustCompute(bytes), true);
  assert.equal(requireRustCompute().abi_version(), 7);
});
