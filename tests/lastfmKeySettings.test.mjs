import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LastFmKeyStore } from '../src/desktop/main/services/lastfmKeyStore.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { LibraryTasteService } from '../src/desktop/main/services/libraryTaste.ts';
import { registerLibraryTasteHandlers } from '../src/desktop/main/ipc/libraryTasteHandlers.ts';
import { setDesktopFetch } from '../src/desktop/main/services/desktopFetch.ts';
const key = 'a'.repeat(32);

test('A Last.fm key persists outside the library and an invalid update preserves it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-lastfm-key-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new LastFmKeyStore(dir);
  assert.equal(store.read(), '');
  assert.equal(store.save(' ' + key + ' '), key);
  assert.equal(new LastFmKeyStore(dir).read(), key);
  assert.throws(() => store.save('not-a-key'), /Invalid/);
  assert.equal(store.read(), key);
  assert.deepEqual(fs.readdirSync(dir), ['lastfm-api-key.json']);
  store.save('');
  assert.equal(store.read(), '');
});

test('Credential IPC returns only configured status and rejects foreign renderers before reading or writing', () => {
  const handlers = new Map(),
    webContents = { mainFrame: {} };
  const win = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  let saved = '',
    reads = 0;
  registerLibraryTasteHandlers(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    () => win,
    {
      report: () => ({ genres: [], running: false }),
      analyze: () => ({}),
      cancel: () => ({}),
      setAutoAnalyze: () => ({}),
    },
    {
      status: () => {
        reads++;
        return { configured: !!saved };
      },
      save: (value) => {
        assert.equal(value, key);
        saved = value;
        return { configured: true };
      },
    },
  );
  assert.throws(
    () => handlers.get('lastfm:keyStatus')({ sender: {}, senderFrame: {} }),
    /main application window/,
  );
  assert.equal(reads, 0);
  assert.throws(
    () => handlers.get('lastfm:saveKey')({ sender: {}, senderFrame: {} }, key),
    /main application window/,
  );
  assert.equal(saved, '');
  assert.deepEqual(handlers.get('lastfm:saveKey')(event, key), { configured: true });
  assert.deepEqual(handlers.get('lastfm:keyStatus')(event), { configured: true });
  const report = handlers.get('libraryTaste:status')(event);
  assert.equal(report.apiKeyConfigured, true);
  assert.ok(!JSON.stringify(report).includes(key));
});

test('Without a key Last.fm sends no requests; adding a key enables requests without a bundled fallback', async (t) => {
  let requests = 0;
  LastFmService.configureApiKey('');
  setDesktopFetch(async (url) => {
    requests++;
    assert.equal(new URL(url).searchParams.get('api_key'), key);
    return Response.json({ toptags: { tag: [{ name: 'rock', count: '10' }] } });
  });
  t.after(() => {
    setDesktopFetch(null);
    LastFmService.configureApiKey('');
  });
  assert.deepEqual(await LastFmService.getGenreTracks('rock'), []);
  await assert.rejects(LastFmService.getTopTags('Artist'), /Добавьте ключ/);
  assert.equal(requests, 0);
  LastFmService.configureApiKey(key);
  assert.deepEqual(await LastFmService.getTopTags('Artist'), ['rock']);
  assert.equal(requests, 1);
});

test('Automatic genre analysis remains idle until the local Last.fm key is available', () => {
  let requested = 0;
  const service = new LibraryTasteService(
    () => null,
    () => {},
    async () => {
      requested++;
      return ['rock'];
    },
    0,
    () => false,
  );
  assert.equal(service.analyze().running, false);
  service.libraryChanged();
  assert.equal(requested, 0);
  service.dispose();
});

test('Last.fm transport diagnostics and exposed errors redact the configured key', async (t) => {
  const logs = [];
  const debug = console.debug;
  console.debug = (...args) => logs.push(args.join(' '));
  LastFmService.configureApiKey(key);
  setDesktopFetch(async (url) => {
    throw new Error('Failed to fetch ' + url);
  });
  t.after(() => {
    console.debug = debug;
    setDesktopFetch(null);
    LastFmService.configureApiKey('');
  });
  assert.deepEqual(await LastFmService.getGenreTracks('rock'), []);
  assert.ok(logs.length > 0);
  assert.ok(!logs.join(' ').includes(key));
  await assert.rejects(
    LastFmService.getTopTags('Artist'),
    (error) => !error.message.includes(key) && error.message.includes('[redacted]'),
  );
});
