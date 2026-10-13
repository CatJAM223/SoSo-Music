import { stripModuleImports } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

function harness() {
  const records = new Map(),
    urls = new Set(),
    revoked = [];
  let gets = 0,
    counter = 0;
  const URLMock = {
    createObjectURL: () => {
      const url = 'blob:offline-' + ++counter;
      urls.add(url);
      return url;
    },
    revokeObjectURL: (url) => {
      urls.delete(url);
      revoked.push(url);
    },
  };
  const db = {
    transaction() {
      return {
        objectStore() {
          return {
            get(key) {
              gets++;
              const request = {};
              queueMicrotask(() => {
                request.result = records.get(key);
                request.onsuccess?.();
              });
              return request;
            },
            delete(key) {
              records.delete(key);
            },
          };
        },
      };
    },
  };
  const source = stripModuleImports(
    readFileSync(new URL('../src/shared/services/offlineCacheService.ts', import.meta.url), 'utf8'),
  ).replace(/^export /gm, '');
  const context = vm.createContext({
    Blob,
    URL: URLMock,
    window: {},
    queueMicrotask,
    console,
    usesNativeOfflineAudio: () => false,
    Capacitor: { isNativePlatform: () => false },
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
  });
  vm.runInContext(stripTypeScriptTypes(source) + '\nthis.service=offlineCacheService;', context);
  return { service: context.service, records, urls, revoked, gets: () => gets };
}

test('Sequential offline playback releases old RAM handles without deleting downloaded songs', async () => {
  const h = harness();
  for (let i = 0; i < 30; i++)
    h.records.set(String(i), { blob: new Blob([new Uint8Array(32000)]) });
  let current;
  for (let i = 0; i < 30; i++) {
    current = await h.service.getCachedTrackUrl(String(i));
    h.service.releaseUnusedTrackUrls([current]);
    assert.equal(h.urls.size, 1);
    assert.equal(h.service.ownsBlobUrl(current), true);
  }
  assert.equal(h.records.size, 30);
  assert.equal(h.revoked.length, 29);
  const again = await h.service.getCachedTrackUrl('0');
  assert.ok(again);
  assert.equal(h.records.size, 30);
});

test('Crossfade retains both streams until the outgoing one finishes; concurrent reads reuse the same URL', async () => {
  const h = harness();
  h.records.set('1', { blob: new Blob([new Uint8Array(32000)]) });
  h.records.set('2', { blob: new Blob([new Uint8Array(32000)]) });
  const [a, b] = await Promise.all([
    h.service.getCachedTrackUrl('1'),
    h.service.getCachedTrackUrl('1'),
  ]);
  assert.equal(a, b);
  assert.equal(h.urls.size, 1);
  assert.equal(h.gets(), 1);
  const incoming = await h.service.getCachedTrackUrl('2');
  h.service.releaseUnusedTrackUrls([a, incoming]);
  assert.equal(h.urls.size, 2);
  h.service.forgetBlobUrl(a);
  assert.equal(h.urls.size, 1);
  assert.equal(h.service.ownsBlobUrl(incoming), true);
  h.service.releaseUnusedTrackUrls([]);
  assert.equal(h.urls.size, 0);
  assert.equal(h.records.size, 2);
});
