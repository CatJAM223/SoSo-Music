import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfflineAudioFiles } from '../src/desktop/main/services/offlineAudioFiles.ts';
import { setDesktopFetch } from '../src/desktop/main/services/desktopFetch.ts';
import { downloadAudioBytes } from '../src/desktop/main/services/audioDownload.ts';

const url = 'https://rr1.googlevideo.com/audio';
const payload = Buffer.alloc(23000, 7);
payload.write('ftyp', 4);
test('offline files publish complete audio atomically, survive a new store instance and reject foreign paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-disk-test-'));
  setDesktopFetch(
    async () => new Response(payload, { headers: { 'content-length': String(payload.length) } }),
  );
  try {
    const store = new OfflineAudioFiles(root);
    const result = await store.download(url, new AbortController().signal);
    assert.equal(result.size, payload.length);
    const local = store.url(result.id);
    assert.match(local, /^media:\/\/offline\//);
    assert.deepEqual(fs.readFileSync(new OfflineAudioFiles(root).resolve(local)), payload);
    assert.equal(store.resolve('media://offline/../../secret'), null);
    assert.equal(store.resolve('media://foreign/' + result.id), null);
    store.remove(result.id);
    assert.equal(store.url(result.id), null);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    setDesktopFetch(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('truncated, non-audio and cancelled downloads leave no partial files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-disk-test-'));
  try {
    const store = new OfflineAudioFiles(root);
    for (const response of [
      new Response(payload, { headers: { 'content-length': '24000' } }),
      new Response(Buffer.alloc(23000)),
    ]) {
      setDesktopFetch(async () => response);
      await assert.rejects(store.download(url, new AbortController().signal));
      assert.deepEqual(fs.readdirSync(root), []);
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(store.download(url, controller.signal));
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    setDesktopFetch(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('range sink reconstructs offsets without returning a whole-file IPC buffer', async () => {
  const size = 2 * 1024 * 1024 + 31,
    source = Buffer.alloc(size);
  for (let i = 0; i < size; i++) source[i] = i % 251;
  const output = Buffer.alloc(size);
  const result = await downloadAudioBytes(url, {
    rangeMode: 'force',
    sink: {
      write: async (offset, bytes) => {
        output.set(bytes, offset);
      },
      reset: async () => {},
    },
    fetcher: async (_url, init) => {
      const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      const start = Number(a),
        end = Math.min(Number(b), size - 1);
      return new Response(source.subarray(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${size}` },
      });
    },
  });
  assert.equal(result.length, 0);
  assert.deepEqual(output, source);
});
