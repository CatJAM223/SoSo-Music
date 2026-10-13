import { stripModuleImports } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { attachPlaylistCover } from '../src/desktop/main/services/playlistImportCover.ts';
import {
  decodePlaylistResponse,
  parsePlaylistLink,
  readExternalPlaylist,
  readVkPlaylist,
  PlaylistImportError,
} from '../src/shared/services/externalPlaylist.ts';
import { isVkImportUrl, isVkPlaylistPage } from '../src/desktop/main/services/vkImportPolicy.ts';

// Run the actual Electron service against an in-memory browser boundary. No login,
// credentials, network or user library is touched by these lifecycle tests.
function harness(responseFactory) {
  const windows = [];
  const requests = [];
  const session = {
    setPermissionRequestHandler(handler) {
      this.permissions = handler;
    },
    async clearStorageData() {
      this.cleared = true;
    },
    async fetch(url, options) {
      requests.push({ url, options });
      return responseFactory
        ? responseFactory(url, options)
        : new Response(
            '<!json>' +
              JSON.stringify({
                payload: [
                  0,
                  [
                    {
                      playlist: { id: 14, ownerId: 305328431, title: 'VK fixture', totalCount: 1 },
                      list: [[1, 2, '', 'Song', 'Artist', 180]],
                    },
                  ],
                ],
              }),
          );
    },
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.loads = [];
      this.webContents = new EventEmitter();
      this.webContents.session = session;
      this.webContents.setWindowOpenHandler = (handler) => {
        this.open = handler;
      };
      this.webContents.getURL = () => this.url || '';
      windows.push(this);
    }
    async loadURL(url) {
      this.url = url;
      this.loads.push(url);
    }
    isDestroyed() {
      return !!this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    close() {
      this.destroy();
    }
  }
  const source = stripModuleImports(
    readFileSync(
      new URL('../src/desktop/main/services/playlistImport.ts', import.meta.url),
      'utf8',
    ),
  ).replace(/^export /gm, '');
  const context = vm.createContext({
    BrowserWindow: Window,
    attachPlaylistCover,
    desktopFetch: () => {
      throw new Error('No anonymous transport allowed');
    },
    decodePlaylistResponse,
    parsePlaylistLink,
    readExternalPlaylist,
    readVkPlaylist,
    PlaylistImportError,
    isVkImportUrl,
    isVkPlaylistPage,
    URL,
    URLSearchParams,
    AbortSignal,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  vm.runInContext(stripTypeScriptTypes(source), context);
  return { service: context, windows, requests, session };
}

test('VK window opens the supplied canonical page and reads authenticated rows after page load', async () => {
  const h = harness();
  const pending = h.service.loadVkPlaylistInWindow('https://vk.ru/audio_playlist305328431_14');
  const win = h.windows[0];
  assert.equal(win.url, 'https://vk.ru/audio_playlist305328431_14');
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.ok(!win.options.webPreferences.partition.startsWith('persist:'));
  win.webContents.emit('did-finish-load');
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(result.data.tracks.length, 1);
  assert.equal(h.requests[0].url, 'https://vk.ru/al_audio.php');
  assert.equal(h.requests[0].options.credentials, 'include');
  assert.equal(h.requests[0].options.headers.Origin, 'https://vk.ru');
  assert.equal(win.isDestroyed(), true);
  assert.equal(h.session.cleared, true);
});

test('VK cover is downloaded in the temporary session before its storage is cleared', async () => {
  const cover = 'https://sun9-1.userapi.com/cover.jpg';
  const h = harness(async (url) => {
    assert.equal(h.session.cleared, undefined);
    if (url === cover) return new Response('image', { headers: { 'content-type': 'image/jpeg' } });
    return new Response(
      JSON.stringify({
        data: [
          {
            playlist: { id: 14, ownerId: 305328431, thumb: { photo_600: cover }, totalCount: 1 },
            list: [[1, 2, '', 'Song', 'Artist', 180]],
          },
        ],
      }),
    );
  });
  h.service.nativeImage = {
    createFromBuffer(bytes) {
      assert.equal(bytes.toString(), 'image');
      return {
        isEmpty: () => false,
        getSize: () => ({ width: 800, height: 600 }),
        crop: () => ({ resize: () => ({ toJPEG: () => Buffer.from('saved') }) }),
      };
    },
  };
  const pending = h.service.loadVkPlaylistInWindow('https://vk.ru/audio_playlist305328431_14');
  h.windows[0].webContents.emit('did-finish-load');
  const result = await pending;
  assert.equal(
    result.data.coverUrl,
    `data:image/jpeg;base64,${Buffer.from('saved').toString('base64')}`,
  );
  assert.deepEqual(
    h.requests.map((r) => r.url),
    ['https://vk.ru/al_audio.php', cover],
  );
  assert.equal(h.requests[1].options.credentials, 'include');
  assert.equal(h.session.cleared, true);
});

function cp1251(text) {
  const decoder = new TextDecoder('windows-1251');
  const encoding = new Map(
    Array.from({ length: 256 }, (_, n) => [decoder.decode(Uint8Array.of(n)), n]),
  );
  return Uint8Array.from(
    [...text].map((character) => {
      assert.ok(encoding.has(character));
      return encoding.get(character);
    }),
  );
}

for (const contentType of ['text/plain; charset=windows-1251', 'text/html'])
  test(`VK authenticated response preserves Cyrillic with ${contentType}`, async () => {
    const rows = [
      [1, 305328431, '', 'сдвг', 'madk1d', 133],
      [2, 305328431, '', 'засосы', 'madk1d', 99],
      [3, 305328431, '', 'ты че обиделась', 'madk1d, тёмный принц', 90],
    ];
    const bytes = cp1251(
      '<!json>' +
        JSON.stringify({
          payload: [
            0,
            [
              {
                playlist: { id: 14, ownerId: 305328431, title: 'Русский плейлист', totalCount: 3 },
                list: rows,
              },
            ],
          ],
        }),
    );
    // Reproduce the former transport corruption before exercising the fixed boundary.
    assert.ok((await new Response(bytes).text()).includes('\uFFFD'));
    const h = harness(() => new Response(bytes, { headers: { 'content-type': contentType } }));
    const pending = h.service.loadVkPlaylistInWindow('https://vk.ru/audio_playlist305328431_14');
    h.windows[0].webContents.emit('did-finish-load');
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(result.data.title, 'Русский плейлист');
    assert.deepEqual(
      result.data.tracks.map((t) => t.title),
      rows.map((row) => row[3]),
    );
    assert.equal(result.data.tracks[2].artist, 'madk1d, тёмный принц');
  });

test('Playlist byte decoder preserves UTF-8 and VK rejects already destroyed names', async () => {
  const text = 'сдвг, засосы, тёмный принц 🎵';
  assert.equal(
    decodePlaylistResponse(
      new TextEncoder().encode(text).buffer,
      'application/json; charset=utf-8',
      true,
    ),
    text,
  );
  const result = await readExternalPlaylist('https://vk.ru/audio_playlist305328431_14', async () =>
    JSON.stringify({ data: [{ list: [[1, 2, '', '�����', 'madk1d', 119]], hasMore: false }] }),
  );
  assert.equal(result.success, false);
  assert.equal(result.code, 'incomplete');
  assert.match(result.error, /повреждённые/);
});

test('VK login popups share the isolated session, external navigation is denied and cancel closes children', async () => {
  const h = harness();
  const pending = h.service.loadVkPlaylistInWindow('https://vk.ru/audio_playlist305328431_14');
  const win = h.windows[0];
  assert.equal(win.open({ url: 'https://id.vk.ru/auth' }).action, 'allow');
  assert.equal(win.open({ url: 'about:blank' }).action, 'allow');
  assert.equal(win.open({ url: 'https://evil.example/auth' }).action, 'deny');
  const options = win.open({ url: 'https://id.vk.ru/auth' }).overrideBrowserWindowOptions;
  assert.equal(options.webPreferences.session, h.session);
  const child = new win.constructor(options);
  win.webContents.emit('did-create-window', child);
  let prevented = false;
  child.webContents.emit(
    'will-redirect',
    {
      preventDefault() {
        prevented = true;
      },
    },
    'https://evil.example/',
  );
  assert.equal(prevented, true);
  h.service.cancelVkPlaylistRead();
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(child.isDestroyed(), true);
  assert.equal(win.loads.length, 1);
  assert.equal(h.session.cleared, true);
  assert.equal(h.requests.length, 0);
});
