import { StreamRequestRegistry } from '../src/desktop/main/services/streamRequestRegistry.ts';
import { extractEventRegistration } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { readExternalPlaylist } from '../src/shared/services/externalPlaylist.ts';
import { downloadAudioBytes } from '../src/desktop/main/services/audioDownload.ts';

const main = readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');

test('Desktop ad blocker allows Yandex Music API while still blocking advertising hosts', () => {
  const registration = main.match(
    /session\.defaultSession\.webRequest\.onBeforeRequest\([\s\S]*?\n    \);/,
  )[0];
  let urls;
  vm.runInNewContext(registration, {
    session: {
      defaultSession: {
        webRequest: {
          onBeforeRequest(filter, callback) {
            urls = filter.urls;
            callback({}, (result) => assert.equal(result.cancel, true));
          },
        },
      },
    },
  });
  const blocked = (url) =>
    urls.some((pattern) => {
      const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
      return new RegExp(`^${expression}$`).test(url);
    });
  assert.equal(
    blocked('https://api.music.yandex.net/playlist/lk.94ed18e6-c1a7-4ece-9879-650d490f3515'),
    false,
  );
  assert.equal(blocked('https://api.music.yandex.net/tracks'), false);
  assert.equal(blocked('https://avatars.yandex.net/get-music-content/cover'), false);
  assert.equal(blocked('https://x.yabs.yandex.net/ad'), true);
  assert.equal(blocked('https://x.an.yandex.net/ad'), true);
  assert.equal(blocked('https://x.doubleclick.net/ad'), true);
});

test('Yandex iOS liked-playlist link preserves lk prefix and ignores share tracking parameters', async () => {
  const result = await readExternalPlaylist(
    'https://music.yandex.ru/playlists/lk.94ed18e6-c1a7-4ece-9879-650d490f3515?ref_id=example&utm_source=mobile_ios',
    async (url) => {
      assert.equal(
        url,
        'https://api.music.yandex.net/playlist/lk.94ed18e6-c1a7-4ece-9879-650d490f3515?page=0&page-size=1000',
      );
      return JSON.stringify({
        result: {
          title: 'Мне нравится',
          trackCount: 1,
          visibility: 'public',
          tracks: [
            {
              id: 123,
              track: { id: 123, title: 'Song', artists: [{ name: 'Artist' }], durationMs: 180000 },
            },
          ],
        },
      });
    },
  );
  assert.equal(result.success, true);
  assert.equal(result.data.tracks.length, 1);
  assert.equal(result.data.url.includes('?'), false);
});

function downloadHarness() {
  const registration = extractEventRegistration(main, 'music:downloadAudioBuffer');
  let handler;
  let time = 0;
  let requests = 0;
  const registry = new StreamRequestRegistry();
  vm.runInNewContext(stripTypeScriptTypes(registration), {
    audioDownloads: {
      begin(owner, id) {
        owner.once ??= () => {};
        owner.removeListener ??= () => {};
        return registry.begin(owner, id);
      },
    },
    ipcMain: {
      handle(_name, fn) {
        handler = fn;
      },
    },
    URL,
    AbortSignal,
    Buffer,
    Date: { now: () => (time += 150) },
    console: { warn() {}, error() {} },
    downloadAudioBytes: (url, options) =>
      downloadAudioBytes(url, {
        ...options,
        fetcher: async () => {
          requests++;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(Uint8Array.of(1, 2));
                controller.enqueue(Uint8Array.of(3, 4));
                controller.close();
              },
            }),
            { headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } },
          );
        },
      }),
  });
  return { handler, requests: () => requests };
}

test('Desktop audio download reports real bytes only to the requesting renderer and correlates requests', async () => {
  const h = downloadHarness();
  const events = [];
  const data = await h.handler(
    {
      sender: {
        isDestroyed: () => false,
        send: (channel, value) => events.push({ channel, ...value }),
      },
    },
    'https://cf-media.sndcdn.com/audio.mp3',
    'download-one',
  );
  assert.deepEqual([...data], [1, 2, 3, 4]);
  assert.ok(events.length >= 2);
  assert.equal(events[0].receivedBytes, 2);
  assert.equal(events.at(-1).receivedBytes, 4);
  assert.ok(
    events.every(
      (e) =>
        e.channel === 'music:audioDownloadProgress' &&
        e.requestId === 'download-one' &&
        e.totalBytes === 4,
    ),
  );
  let sent = false;
  await h.handler(
    {
      sender: {
        isDestroyed: () => true,
        send() {
          sent = true;
        },
      },
    },
    'https://cf-media.sndcdn.com/audio.mp3',
    'download-two',
  );
  assert.equal(sent, false);
});

test('Desktop progress change preserves CDN restrictions and compatibility with callers without progress IDs', async () => {
  const h = downloadHarness();
  assert.equal(
    await h.handler(
      { sender: { once() {}, removeListener() {} } },
      'https://localhost/audio.mp3',
      'blocked',
    ),
    null,
  );
  assert.equal(h.requests(), 0);
  const data = await h.handler(
    { sender: { once() {}, removeListener() {} } },
    'https://cf-media.sndcdn.com/audio.mp3',
  );
  assert.deepEqual([...data], [1, 2, 3, 4]);
});
