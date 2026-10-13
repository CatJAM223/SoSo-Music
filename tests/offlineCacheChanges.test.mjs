import { stripModuleImports } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

function cacheHarness(native = false) {
  const files = new Map(),
    parts = new Map();

  const records = new Map();
  const metadata = new Map();
  let fail = false;
  let pendingFetch;
  const db = {
    transaction(_stores, mode) {
      const operations = [];
      const tx = {
        objectStore(name) {
          const store = name === 'cached_meta' ? metadata : records;
          return {
            get(key) {
              const request = {};
              queueMicrotask(() => {
                request.result = store.get(key);
                request.onsuccess?.();
              });
              return request;
            },
            put(record) {
              operations.push(() => store.set(record.trackId, record));
            },
            clear() {
              operations.push(() => store.clear());
            },
            delete(key) {
              operations.push(() => store.delete(key));
            },
            getAll() {
              const request = {};
              queueMicrotask(() => {
                request.result = [...store.values()];
                request.onsuccess?.();
              });
              return request;
            },
          };
        },
      };
      if (mode === 'readwrite')
        queueMicrotask(() => {
          if (fail) tx.onerror?.();
          else {
            operations.forEach((op) => op());
            tx.oncomplete?.();
          }
        });
      return tx;
    },
  };
  const bytes = new Uint8Array(32000);
  bytes.set([73, 68, 51]);
  class Reader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onload?.();
      });
    }
  }
  const source = stripModuleImports(
    readFileSync(new URL('../src/shared/services/offlineCacheService.ts', import.meta.url), 'utf8'),
  ).replace(/^export /gm, '');
  const context = vm.createContext({
    Blob,
    Response,
    URL,
    FileReader: Reader,
    window: {},
    queueMicrotask,
    console: { error() {}, warn() {}, info() {} },
    indexedDB: {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = db;
          request.onsuccess();
        });
        return request;
      },
    },
    fetch: async () => {
      if (pendingFetch) await pendingFetch;
      return new Response(bytes, {
        headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) },
      });
    },
  });
  vm.runInContext(
    stripTypeScriptTypes(source) +
      '\nthis.service = offlineCacheService; this.subscribe = subscribeOfflineCacheChanges;',
    context,
  );
  return {
    service: context.service,
    files,
    subscribe: context.subscribe,
    records,
    metadata,
    fail: (value) => {
      fail = value;
    },
    delay: (promise) => {
      pendingFetch = promise;
    },
  };
}

test('Offline mutations notify only after both audio and metadata changes have committed', async () => {
  const h = cacheHarness();
  const snapshots = [];
  const unsubscribe = h.subscribe(() => snapshots.push([h.records.size, h.metadata.size]));
  const track = { id: 'sc_fixture', title: 'Fixture', artist: { name: 'Artist' } };
  assert.equal(await h.service.cacheTrack(track, 'https://cf-media.sndcdn.com/a.mp3'), true);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0][0], 1);
  assert.ok(snapshots[0][1] > 0);
  assert.equal(await h.service.removeCachedTrack(track.id), true);
  assert.deepEqual(snapshots[1], [0, 0]);
  await h.service.cacheTrack(track, 'https://cf-media.sndcdn.com/a.mp3');
  assert.equal(await h.service.clearCache(), true);
  assert.deepEqual(snapshots.at(-1), [0, 0]);
  unsubscribe();
  const count = snapshots.length;
  await h.service.clearCache();
  assert.equal(snapshots.length, count);
});

test('Failed clearing leaves records intact and does not announce successful removal', async () => {
  const h = cacheHarness();
  await h.service.cacheTrack({ id: 'sc_fixture' }, 'https://cf-media.sndcdn.com/a.mp3');
  let notices = 0;
  h.subscribe(() => notices++);
  h.fail(true);
  assert.equal(await h.service.clearCache(), false);
  assert.equal(notices, 0);
  assert.equal(h.records.size, 1);
  assert.ok(h.metadata.size > 0);
});

test('A download that was already running cannot restore tracks after cache clearing', async () => {
  const h = cacheHarness();
  let release;
  h.delay(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = h.service.cacheTrack({ id: 'sc_inflight' }, 'https://cf-media.sndcdn.com/a.mp3');
  assert.equal(await h.service.clearCache(), true);
  release();
  assert.equal(await pending, false);
  assert.equal(h.records.size, 0);
  assert.equal(h.metadata.size, 0);
});
