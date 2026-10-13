import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { registerWaveHandlers } from '../src/desktop/main/ipc/waveHandlers.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
import {
  WaveRequestScheduler,
  waveAbortError,
} from '../src/shared/services/waveRequestScheduler.ts';
import { WaveBatchRequestRegistry } from '../src/desktop/main/services/waveBatchRequestRegistry.ts';
import { SoundCloudTransport } from '../src/desktop/main/services/soundcloudTransport.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';

import { requestSignal } from '../src/shared/utils/requestSignal.ts';

const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}
const aborted = { name: 'AbortError' };

test('Aborting an obsolete batch removes queued work and aborts an exclusively owned active task', async () => {
  const scheduler = new WaveRequestScheduler(1, 1),
    controller = new AbortController();
  const batch = scheduler.createBatch(controller.signal);
  let calls = 0,
    signal;
  const running = batch('running', async (ownerSignal) => {
    calls++;
    signal = ownerSignal;
    await new Promise((_, reject) =>
      ownerSignal.addEventListener('abort', () => reject(ownerSignal.reason), { once: true }),
    );
  });
  const queued = batch('queued', async () => {
    calls++;
  });
  const replies = Promise.allSettled([running, queued]);
  await turn();
  controller.abort();
  assert.equal(signal.aborted, true);
  assert.ok(
    (await replies).every(
      (reply) => reply.status === 'rejected' && reply.reason.name === 'AbortError',
    ),
  );
  await turn();
  assert.equal(calls, 1);
  assert.equal(await scheduler.createBatch()('fresh', async () => 42), 42);
});

test('A shared active request survives one owner cancellation and aborts only after its last owner leaves', async () => {
  const scheduler = new WaveRequestScheduler(1),
    a = new AbortController(),
    b = new AbortController();
  let calls = 0,
    signal;
  const task = async (ownerSignal) => {
    calls++;
    signal = ownerSignal;
    return new Promise((_, reject) =>
      ownerSignal.addEventListener('abort', () => reject(ownerSignal.reason), { once: true }),
    );
  };
  const first = scheduler.createBatch(a.signal)('shared', task),
    second = scheduler.createBatch(b.signal)('shared', task);
  const firstRejected = assert.rejects(first, aborted),
    secondRejected = assert.rejects(second, aborted);
  await turn();
  a.abort();
  await firstRejected;
  assert.equal(signal.aborted, false);
  assert.equal(calls, 1);
  b.abort();
  await secondRejected;
  assert.equal(signal.aborted, true);
  await turn();
});

test('Cancelling one owner of queued shared work retains it for the other owner', async () => {
  const scheduler = new WaveRequestScheduler(1),
    block = deferred(),
    a = new AbortController();
  const hold = scheduler.createBatch()('hold', () => block.promise);
  let calls = 0;
  const first = scheduler.createBatch(a.signal)('shared', async () => {
    calls++;
    return 7;
  });
  const second = scheduler.createBatch()('shared', async () => {
    throw Error('duplicate');
  });
  const rejected = assert.rejects(first, aborted);
  a.abort();
  await rejected;
  block.resolve();
  await hold;
  assert.equal(await second, 7);
  assert.equal(calls, 1);
});

test('Unabortable native work retains its slot, but obsolete queued jobs cannot occupy the bounded queue', async () => {
  const scheduler = new WaveRequestScheduler(1, 1),
    controller = new AbortController(),
    native = deferred();
  let obsoleteCalls = 0,
    freshCalls = 0;
  const batch = scheduler.createBatch(controller.signal);
  const running = batch('native', () => native.promise),
    queued = batch('obsolete', async () => {
      obsoleteCalls++;
    });
  const replies = Promise.allSettled([running, queued]);
  await turn();
  controller.abort();
  await replies;
  const fresh = scheduler.createBatch()('fresh', async () => {
    freshCalls++;
    return 'fresh';
  });
  await turn();
  assert.equal(freshCalls, 0, 'Cancelling a subscriber must not pretend native HTTP finished');
  native.resolve();
  assert.equal(await fresh, 'fresh');
  assert.equal(obsoleteCalls, 0);
});

test('Pre-aborted/disposed batches never start tasks, and normal disposal removes its abort listener', async () => {
  const scheduler = new WaveRequestScheduler(1),
    controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    scheduler.createBatch(controller.signal)('never', async () => {
      calls++;
    }),
    aborted,
  );
  const live = new AbortController();
  let added = 0,
    removed = 0;
  const add = live.signal.addEventListener.bind(live.signal),
    remove = live.signal.removeEventListener.bind(live.signal);
  live.signal.addEventListener = (...args) => {
    added++;
    return add(...args);
  };
  live.signal.removeEventListener = (...args) => {
    removed++;
    return remove(...args);
  };
  const batch = scheduler.createBatch(live.signal);
  assert.equal(await batch('ok', async () => 1), 1);
  batch.dispose();
  batch.dispose();
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(calls, 0);
});

test('Main cancellation registry scopes IDs to their sender and cleans listeners on finish or window destruction', () => {
  const registry = new WaveBatchRequestRegistry(),
    a = new EventEmitter(),
    b = new EventEmitter();
  const first = registry.begin(a, 'same'),
    second = registry.begin(b, 'same');
  registry.cancel(a, 'same');
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  first.finish();
  assert.equal(a.listenerCount('destroyed'), 0);
  b.emit('destroyed');
  assert.equal(second.signal.aborted, true);
  second.finish();
  assert.throws(() => registry.begin(a, ''), /Invalid/);
  assert.throws(() => registry.begin(a, {}), /Invalid/);
  const many = Array.from({ length: 8 }, (_, i) => registry.begin(a, String(i)));
  assert.throws(() => registry.begin(a, 'extra'), /Too many/);
  many.forEach((request) => request.finish());
  assert.equal(a.listenerCount('destroyed'), 0);
});

test('Bridge sends a serializable cancellation ID, never a signal, and removes its abort listener', async () => {
  const source = readFileSync(
    new URL('../src/shared/bridge/platformBridge.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  getWaveBatch: async ('),
    end = source.indexOf('  getFullStreamUrl:', start);
  const response = deferred(),
    requests = [],
    cancellations = [];
  const context = vm.createContext({
    AbortController,
    Promise,
    Date,
    waveAbortError,
    waveBatchRequestSequence: 0,
    nativeElectron: {
      getWaveBatch: async (...args) => {
        requests.push(args);
        return response.promise;
      },
      cancelWaveBatch: async (id) => {
        cancellations.push(id);
      },
    },
  });
  vm.runInContext(stripTypeScriptTypes('this.bridge={' + source.slice(start, end) + '};'), context);
  const controller = new AbortController();
  const result = context.bridge.getWaveBatch('mix', [], [], {}, controller.signal);
  const rejection = assert.rejects(result, aborted);
  controller.abort();
  response.resolve([]);
  await rejection;
  assert.equal(typeof requests[0][4], 'string');
  assert.equal(cancellations[0], requests[0][4]);
  const normal = new AbortController();
  await context.bridge.getWaveBatch('mix', [], [], {}, normal.signal);
  normal.abort();
  assert.equal(
    cancellations.length,
    1,
    'A normally completed bridge invocation removes its listener',
  );
});

for (const mobile of [false])
  test(
    'Desktop' + ' cancelled wave stops queued provider fanout and never launches fallback',
    async (t) => {
      const controller = new AbortController();
      let calls = 0,
        cancelled = 0;
      const search = async (...args) => {
        const signal = args.at(-1);
        assert.ok(signal instanceof AbortSignal);
        calls++;
        return new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              cancelled++;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      };
      {
        t.mock.method(SoundCloudService, 'search', search);
        t.mock.method(YouTubeMusicService, 'search', search);
      }
      const seeds = Array.from({ length: 7 }, (_, i) => ({
        id: 'seed' + i,
        title: 'Seed',
        artist: { name: 'Artist' + i },
        source: 'soundcloud',
        duration: 200,
      }));
      const result = WaveEngine.getWaveBatch('mix', seeds, [], [], [], {}, true, controller.signal);
      const rejection = assert.rejects(result, aborted);
      await turn();
      assert.equal(calls, 4);
      controller.abort();
      await rejection;
      await turn();
      assert.equal(calls, 4);
      assert.equal(cancelled, 4);
    },
  );

for (const transport of ['soundcloud', 'youtube'])
  test(transport + ' catalog abort really closes an in-flight HTTP connection', async (t) => {
    const received = deferred(),
      closed = deferred();
    const server = createServer((_request, _response) => {
      received.resolve();
    });
    server.on('connection', (socket) => socket.once('close', closed.resolve));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/catalog';
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const controller = new AbortController();
    let calls = 0;
    const forward = (_url, options) => {
      calls++;
      return fetch(url, options);
    };
    let response;
    if (transport === 'soundcloud') {
      t.mock.method(SoundCloudTransport, 'fetch', forward);
      response = SoundCloudTransport.fetchJson(
        'https://api-v2.soundcloud.com/search/tracks',
        'https://relay.invalid/',
        async () => {
          throw Error('No key refresh after cancellation');
        },
        false,
        false,
        false,
        controller.signal,
      );
    } else if (transport === 'youtube') {
      t.mock.method(YouTubeMusicTransport, 'fetch', forward);
      response = YouTubeMusicTransport.postMusic(
        '/youtubei/v1/search',
        {},
        5000,
        controller.signal,
      );
    } else throw new Error('Unknown transport');
    const rejected = assert.rejects(response, aborted);
    await received.promise;
    controller.abort();
    await rejected;
    await closed.promise;
    assert.equal(calls, 1, 'Cancellation must not start relay/fallback work');
  });

test('Main wave IPC forwards the registry signal and acknowledges cancellation without leaking the sender listener', async (t) => {
  const handlers = new Map();
  let signal;
  const db = Object.fromEntries(
    [
      'getDislikedTrackIds',
      'getWaveTasteTracks',
      'getLikedTracks',
      'getPlaylistWaveTracks',
      'getFollowedArtists',
      'getScrobbledTopArtists',
      'getDislikedWaveTracks',
    ].map((name) => [name, () => []]),
  );
  t.mock.method(MusicAggregatorService, 'getWaveBatch', async (...args) => {
    signal = args.at(-1);
    return new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  });
  registerWaveHandlers({ handle: (name, handler) => handlers.set(name, handler) }, db);
  const sender = new EventEmitter(),
    event = { sender };
  const result = handlers.get('music:getWaveBatch')(event, 'mix', [], [], {}, 'owned-request');
  handlers.get('music:cancelWaveBatch')(event, 'owned-request');
  assert.equal(signal.aborted, true);
  assert.equal((await result).length, 0);
  assert.equal(sender.listenerCount('destroyed'), 0);
});
