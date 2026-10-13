import test from 'node:test';
import assert from 'node:assert/strict';
import { probeYouTubeMedia } from '../src/desktop/main/services/youtubeMediaProbe.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';

const url = 'https://rr1.googlevideo.com/videoplayback?token=synthetic';
function transport(t, fetcher) {
  const original = YouTubeMusicTransport.fetch;
  YouTubeMusicTransport.fetch = fetcher;
  t.after(() => {
    YouTubeMusicTransport.fetch = original;
  });
}

test('Probe refuses a 403, HTML response, empty body and network drop instead of claiming delivery works', async (t) => {
  const cases = [
    [
      () => new Response('Forbidden', { status: 403 }),
      { ok: false, reason: 'cdn-http', status: 403 },
    ],
    [
      () => new Response('challenge', { headers: { 'content-type': 'text/html' } }),
      { ok: false, reason: 'cdn-response', status: 200 },
    ],
    [
      () => new Response(null, { status: 206, headers: { 'content-type': 'audio/mp4' } }),
      { ok: false, reason: 'cdn-response' },
    ],
    [
      () => {
        throw new Error('secret');
      },
      { ok: false, reason: 'network' },
    ],
  ];
  let response;
  transport(t, async () => response());
  for (const [factory, expected] of cases) {
    response = factory;
    assert.deepEqual(await probeYouTubeMedia(url, 'audio'), expected);
  }
});

test('Probe reads one chunk and cancels a full response when Range is ignored', async (t) => {
  let cancelled = false,
    pulls = 0;
  transport(t, async (_url, init) => {
    assert.equal(init.headers.Range, 'bytes=0-1023');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    return new Response(
      new ReadableStream(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(1024));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-type': 'audio/mp4' } },
    );
  });
  assert.deepEqual(await probeYouTubeMedia(url, 'audio'), { ok: true, url });
  assert.equal(cancelled, true);
  assert.equal(pulls, 1);
});

test('CDN redirects share one timeout, are bounded and never send a request outside Google video hosts', async (t) => {
  let requests = [],
    signals = [];
  transport(t, async (target, init) => {
    requests.push(target);
    signals.push(init.signal);
    return new Response(null, {
      status: 302,
      headers: {
        location: 'https://rr' + (requests.length + 1) + '.googlevideo.com/videoplayback',
      },
    });
  });
  assert.deepEqual(await probeYouTubeMedia(url, 'audio'), {
    ok: false,
    reason: 'cdn-redirect',
    status: 302,
  });
  assert.equal(requests.length, 3);
  assert.equal(new Set(signals).size, 1);
  for (const location of [
    'https://evil.test/',
    'http://rr2.googlevideo.com/',
    'https://secret@rr2.googlevideo.com/',
    'https://rr2.googlevideo.com.evil.test/',
  ]) {
    requests = [];
    YouTubeMusicTransport.fetch = async (target) => {
      requests.push(target);
      return new Response(null, { status: 302, headers: { location } });
    };
    assert.equal((await probeYouTubeMedia(url, 'audio')).ok, false);
    assert.equal(requests.length, 1);
  }
});

test('Probe never fetches an untrusted starting URL and rejects audio data for a video request', async (t) => {
  let calls = 0;
  transport(t, async () => {
    calls++;
    return new Response(new Uint8Array([1]), {
      status: 206,
      headers: { 'content-type': 'audio/mp4' },
    });
  });
  assert.equal((await probeYouTubeMedia('https://evil.test/', 'audio')).ok, false);
  assert.equal(calls, 0);
  assert.equal((await probeYouTubeMedia(url, 'video')).ok, false);
  assert.equal(calls, 1);
});

test('Closing a redirected or rejected CDN response cannot mask its status', async (t) => {
  let calls = 0;
  transport(t, async () => {
    calls++;
    if (calls === 1)
      return {
        status: 302,
        headers: new Headers({ location: 'https://rr2.googlevideo.com/videoplayback' }),
        body: {
          cancel: async () => {
            throw new Error('ERR_ABORTED');
          },
        },
      };
    return new Response(new Uint8Array([1]), {
      status: 206,
      headers: { 'content-type': 'audio/mp4' },
    });
  });
  assert.deepEqual(await probeYouTubeMedia(url, 'audio'), {
    ok: true,
    url: 'https://rr2.googlevideo.com/videoplayback',
  });
  YouTubeMusicTransport.fetch = async () => ({
    status: 403,
    headers: new Headers({ 'content-type': 'text/plain' }),
    body: {
      cancel: async () => {
        throw new Error('ERR_ABORTED');
      },
    },
  });
  assert.deepEqual(await probeYouTubeMedia(url, 'audio'), {
    ok: false,
    reason: 'cdn-http',
    status: 403,
  });
});
