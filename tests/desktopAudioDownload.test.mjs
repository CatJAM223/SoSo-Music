import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadAudioBytes } from '../src/desktop/main/services/audioDownload.ts';

const url = 'https://rr1.googlevideo.com/videoplayback?signature=unchanged';
const size = 3 * 1024 * 1024 + 123;
const audio = Buffer.alloc(size);
for (let i = 0; i < size; i++) audio[i] = i % 251;

test('YouTube audio downloads bounded ranges, reconstructs out-of-order results, and reports whole-file bytes', async () => {
  const ranges = [],
    progress = [];
  let active = 0,
    peak = 0;
  const result = await downloadAudioBytes(url, {
    rangeMode: 'force',
    onProgress: (received, total) => progress.push([received, total]),
    fetcher: async (target, options) => {
      assert.equal(target, url, 'Signed query must not change');
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range).map(Number);
      const last = Math.min(end, size - 1);
      ranges.push([start, last]);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, start === 1024 * 1024 ? 15 : 1));
      active--;
      return new Response(audio.subarray(start, last + 1), {
        status: 206,
        headers: {
          'Content-Type': 'audio/webm',
          'Content-Length': String(last - start + 1),
          'Content-Range': `bytes ${start}-${last}/${size}`,
        },
      });
    },
  });
  assert.deepEqual(result, audio);
  assert.equal(peak, 2);
  assert.deepEqual(ranges, [
    [0, 1048575],
    [1048576, 2097151],
    [2097152, 3145727],
    [3145728, size - 1],
  ]);
  assert.deepEqual(progress.at(-1), [size, size]);
  assert.ok(progress.every(([received, total]) => total === size && received <= total));
});

test('A CDN ignoring Range downloads the complete response once without duplicate requests', async () => {
  let count = 0;
  const result = await downloadAudioBytes(url, {
    rangeMode: 'force',
    fetcher: async () => {
      count++;
      return new Response(audio, {
        headers: { 'Content-Type': 'audio/webm', 'Content-Length': String(size) },
      });
    },
  });
  assert.deepEqual(result, audio);
  assert.equal(count, 1);
});

test('Content-Range discovers total size even when the URL has no clen', async () => {
  const result = await downloadAudioBytes(url, {
    rangeMode: 'force',
    fetcher: async () =>
      new Response(audio.subarray(0, 20000), {
        status: 206,
        headers: { 'Content-Type': 'audio/webm', 'Content-Range': 'bytes 0-19999/20000' },
      }),
  });
  assert.equal(result.length, 20000);
});

test('Broken ranges and truncated direct responses are rejected instead of marking a partial song downloaded', async () => {
  for (const headers of [
    { 'Content-Range': 'bytes 1-1048575/2000000' },
    { 'Content-Range': 'bytes 0-1048575/2000000' },
    { 'Content-Range': 'bytes 0-1048575/200000000' },
  ]) {
    await assert.rejects(
      downloadAudioBytes(url, {
        rangeMode: 'force',
        fetcher: async () => new Response(Buffer.alloc(50000), { status: 206, headers }),
      }),
    );
  }
  await assert.rejects(
    downloadAudioBytes('https://cf-media.sndcdn.com/track.mp3', {
      fetcher: async () =>
        new Response(Buffer.alloc(20000), {
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '40000' },
        }),
    }),
    /Incomplete/,
  );
});

test('Range failure aborts sibling requests and rejects responses that unexpectedly return a full file', async () => {
  let downloadSignal;
  await assert.rejects(
    downloadAudioBytes(url, {
      rangeMode: 'force',
      fetcher: async (_target, options) => {
        downloadSignal = options.signal;
        const first = options.headers.Range.startsWith('bytes=0-');
        return first
          ? new Response(audio.subarray(0, 1048576), {
              status: 206,
              headers: { 'Content-Range': `bytes 0-1048575/${size}` },
            })
          : new Response(audio);
      },
    }),
    /Invalid audio range/,
  );
  assert.equal(downloadSignal.aborted, true);
});

test('Healthy YouTube transfers retain a single request; a measured slow transfer switches to bounded ranges', async () => {
  let count = 0;
  const fast = await downloadAudioBytes(url, {
    fetcher: async (_target, options) => {
      count++;
      assert.equal(options.headers.Range, undefined);
      return new Response(audio, { headers: { 'Content-Length': String(size) } });
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(fast, audio);
  let cancelled = false,
    timer,
    slowRequestSignal;
  const ranges = [];
  const slow = await downloadAudioBytes(url, {
    fetcher: async (_target, options) => {
      assert.equal(
        options.cache,
        'no-store',
        'Offline transfers must not wait on a Chromium HTTP cache entry',
      );
      if (!options.headers.Range) {
        slowRequestSignal = options.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(audio.subarray(0, 32768));
              timer = setTimeout(() => controller.enqueue(audio.subarray(32768, 65536)), 1550);
            },
            cancel() {
              cancelled = true;
              clearTimeout(timer);
            },
          }),
          { headers: { 'Content-Length': String(size) } },
        );
      }
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range).map(Number);
      const last = Math.min(end, size - 1);
      ranges.push([start, last]);
      return new Response(audio.subarray(start, last + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${last}/${size}` },
      });
    },
  });
  assert.equal(cancelled, true);
  assert.equal(
    slowRequestSignal.aborted,
    true,
    'The discarded transfer must release its network request',
  );
  assert.equal(ranges.length, 4);
  assert.deepEqual(slow, audio);
});

test('Direct streams keep one request; redirect allowlist and non-audio/oversize guards remain enforced', async () => {
  const result = await downloadAudioBytes('https://cf-media.sndcdn.com/track.mp3', {
    fetcher: async (_target, options) => {
      assert.equal(options.headers.Range, undefined);
      return new Response(Buffer.alloc(20000), { headers: { 'Content-Type': 'audio/mpeg' } });
    },
  });
  assert.equal(result.length, 20000);
  let requests = 0;
  await assert.rejects(
    downloadAudioBytes(url, {
      fetcher: async () => {
        requests++;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://localhost/private' },
        });
      },
    }),
    /allowed HTTPS/,
  );
  assert.equal(requests, 1);
  for (const headers of [{ 'Content-Type': 'text/html' }, { 'Content-Length': '200000000' }]) {
    await assert.rejects(
      downloadAudioBytes(url, { fetcher: async () => new Response('error', { headers }) }),
    );
  }
});
