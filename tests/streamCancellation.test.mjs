import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SharedStreamResolver } from '../src/desktop/main/services/sharedStreamResolver.ts';
import { StreamRequestRegistry } from '../src/desktop/main/services/streamRequestRegistry.ts';
import {
  runStreamResolve,
  streamShared,
  streamWait,
  streamRequestInit,
  currentStreamResolveSignal,
} from '../src/desktop/main/services/streamResolveContext.ts';
import { invokeStreamRequest } from '../src/shared/utils/streamRequest.ts';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const track = { id: 'yt_recording', source: 'youtube', title: 'test', artist: { name: 'artist' } };

test('stream sharing promotes playback, survives one cancellation, and releases recovery authority with its owner', async () => {
  const pool = new SharedStreamResolver(),
    a = new AbortController(),
    b = new AbortController(),
    latch = deferred(),
    entered = deferred();
  let count = 0,
    operation,
    promoted;
  const task = async (_track, options) => {
    count++;
    operation = currentStreamResolveSignal();
    promoted = options;
    entered.resolve();
    return streamWait(latch.promise);
  };
  const first = pool.resolve(track, {}, a.signal, task);
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  await entered.promise;
  const second = pool.resolve(track, { allowSessionRecovery: true }, b.signal, task);
  assert.equal(promoted.allowSessionRecovery, true);
  a.abort();
  await firstRejected;
  assert.equal(operation.aborted, false);
  assert.equal(count, 1);
  latch.resolve('media');
  assert.equal(await second, 'media');
});
test('cancelled playback loses recovery permission while prefetch still owns the operation', async () => {
  const pool = new SharedStreamResolver(),
    prefetch = new AbortController(),
    playback = new AbortController(),
    latch = deferred(),
    entered = deferred();
  let options;
  const task = async (_, settings) => {
    options = settings;
    entered.resolve();
    return streamWait(latch.promise);
  };
  const a = pool.resolve(track, {}, prefetch.signal, task);
  await entered.promise;
  const b = pool.resolve(track, { allowSessionRecovery: true }, playback.signal, task);
  const rejected = assert.rejects(b, { name: 'AbortError' });
  assert.equal(options.allowSessionRecovery, true);
  playback.abort();
  await rejected;
  assert.equal(options.allowSessionRecovery, false);
  latch.resolve('ok');
  assert.equal(await a, 'ok');
});
test('last stream owner aborts transport and an old completion cannot delete its replacement', async () => {
  const pool = new SharedStreamResolver(),
    a = new AbortController(),
    entered = deferred(),
    stale = deferred(),
    next = deferred();
  let signal,
    calls = 0;
  const task = async () => {
    calls++;
    signal = currentStreamResolveSignal();
    entered.resolve();
    return stale.promise;
  };
  const first = pool.resolve(track, {}, a.signal, task);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await entered.promise;
  a.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  const second = pool.resolve(track, {}, undefined, async () => {
    calls++;
    return next.promise;
  });
  await Promise.resolve();
  stale.resolve('obsolete');
  await Promise.resolve();
  await Promise.resolve();
  const third = pool.resolve(track, {}, undefined, () => {
    throw Error('replacement must be reused');
  });
  next.resolve('current');
  assert.deepEqual(await Promise.all([second, third]), ['current', 'current']);
  assert.equal(calls, 2);
});
test('pre-aborted stream has no task side effects and invalidation separates new account requests', async () => {
  const pool = new SharedStreamResolver(),
    a = new AbortController();
  a.abort();
  let calls = 0;
  assert.throws(
    () =>
      pool.resolve(track, {}, a.signal, async () => {
        calls++;
        return 'bad';
      }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
  const latch = deferred();
  const old = pool.resolve(track, {}, undefined, () => latch.promise);
  pool.invalidate();
  assert.equal(
    await pool.resolve(track, {}, undefined, async () => {
      calls++;
      return 'new';
    }),
    'new',
  );
  latch.resolve('old');
  assert.equal(await old, 'old');
  assert.equal(calls, 1);
});
test('bootstrap is detached but its aborted waiter rejects immediately and does not commit operation data', async () => {
  const c = new AbortController(),
    latch = deferred();
  let bootstrapSignal = 'unset',
    bootstrapCommitted = false,
    operationCommitted = false;
  const task = runStreamResolve(c.signal, async () => {
    await streamShared(async () => {
      bootstrapSignal = currentStreamResolveSignal();
      await latch.promise;
      bootstrapCommitted = true;
      return 'key';
    });
    operationCommitted = true;
  });
  const rejected = assert.rejects(task, { name: 'AbortError' });
  c.abort();
  await rejected;
  assert.equal(bootstrapSignal, undefined);
  assert.equal(operationCommitted, false);
  latch.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(bootstrapCommitted, true);
});
test('request context composes existing deadline/caller signal, and abort rejects a late successful response', async () => {
  const a = new AbortController(),
    b = new AbortController(),
    latch = deferred();
  let merged;
  const task = runStreamResolve(a.signal, async () => {
    merged = streamRequestInit({ signal: b.signal }).signal;
    await streamWait(latch.promise);
    throw Error('late success escaped');
  });
  const rejected = assert.rejects(task, { name: 'AbortError' });
  a.abort();
  assert.equal(merged.aborted, true);
  await rejected;
  latch.resolve('late');
  const standalone = streamRequestInit({ signal: b.signal });
  assert.equal(standalone.signal, b.signal);
});
test('main stream IDs are sender-scoped; destruction cancels legacy and named leases and removes listeners', () => {
  const registry = new StreamRequestRegistry(),
    a = new EventEmitter(),
    b = new EventEmitter();
  const a1 = registry.begin(a, 'same'),
    b1 = registry.begin(b, 'same'),
    legacy = registry.begin(a);
  registry.cancel(b, 'unknown');
  registry.cancel(a, 'same');
  assert.equal(a1.signal.aborted, true);
  assert.equal(b1.signal.aborted, false);
  a.emit('destroyed');
  assert.equal(legacy.signal.aborted, true);
  a1.finish();
  legacy.finish();
  b1.finish();
  assert.equal(a.listenerCount('destroyed'), 0);
  assert.equal(b.listenerCount('destroyed'), 0);
  assert.throws(() => registry.begin(a, 'bad id'), /Invalid/);
});
test('bridge sends an ID rather than a signal and rejects cancellation without awaiting native completion', async () => {
  const c = new AbortController(),
    latch = deferred();
  let id, cancelled;
  const task = invokeStreamRequest(
    (requestId) => {
      id = requestId;
      return latch.promise;
    },
    (requestId) => {
      cancelled = requestId;
    },
    c.signal,
  );
  const rejected = assert.rejects(task, { name: 'AbortError' });
  c.abort();
  await rejected;
  assert.match(id, /^stream-/);
  assert.equal(cancelled, id);
  latch.resolve('obsolete');
  const aborted = new AbortController();
  aborted.abort();
  assert.throws(
    () =>
      invokeStreamRequest(
        () => {
          throw Error('must not invoke');
        },
        undefined,
        aborted.signal,
      ),
    { name: 'AbortError' },
  );
});
