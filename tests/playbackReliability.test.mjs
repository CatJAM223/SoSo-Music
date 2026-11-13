import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioCacheService,
  readBoundedAudioBlob,
} from '../src/shared/services/audioCacheService.ts';
import {
  remainingStartupBudget,
  completeStartupBudget,
} from '../src/shared/utils/playbackStartupBudget.ts';
import { extractYouTubeAccountStream } from '../src/desktop/main/services/youtubeAccountStream.ts';
import { downloadAudioBytes } from '../src/desktop/main/services/audioDownload.ts';

test('cache rejects partial, error-document and truncated responses', async () => {
  const signal = new AbortController().signal;
  for (const response of [
    new Response(new Uint8Array(20000), { status: 206 }),
    new Response('x'.repeat(20000), { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array(20000), { headers: { 'content-length': '30000' } }),
  ])
    assert.equal(await readBoundedAudioBlob(response, 40000, signal), null);
  assert.equal(
    (await readBoundedAudioBlob(new Response(new Uint8Array(20000)), 40000, signal)).size,
    20000,
  );
});

test('startup budget spans retries and resets after audible playback', () => {
  const signal = new AbortController().signal;
  assert.equal(remainingStartupBudget(signal, 1000), 20000);
  assert.equal(remainingStartupBudget(signal, 19000), 2000);
  assert.equal(remainingStartupBudget(signal, 22000), 0);
  completeStartupBudget(signal);
  assert.equal(remainingStartupBudget(signal, 22000), 20000);
});

test('failed HLS and broken direct format fall through to another audio rendition', async () => {
  const good = 'https://rr1.googlevideo.com/audio';
  const info = {
    basic_info: { id: 'test' },
    playability_status: { status: 'OK' },
    streaming_data: {
      hls_manifest_url: 'https://rr1.googlevideo.com/manifest',
      adaptive_formats: [
        {
          itag: 140,
          mime_type: 'audio/mp4',
          url: good,
          decipher: async () => {
            throw new Error('bad cipher');
          },
        },
        { itag: 251, mime_type: 'audio/webm', url: good, decipher: async () => good },
      ],
    },
  };
  const result = await extractYouTubeAccountStream('test', info, undefined, async () => {
    throw new Error('HLS unavailable');
  });
  assert.equal(result.url, good);
  assert.equal(result.audioItag, 251);
});

test('whole-file downloads serialize allocations and a queued cancellation never fetches', async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  const first = downloadAudioBytes('https://rr1.googlevideo.com/audio', {
    fetcher: async () => {
      entered();
      await blocker;
      return new Response(new Uint8Array(20000));
    },
  });
  await started;
  const controller = new AbortController();
  let called = false;
  const queued = downloadAudioBytes('https://rr1.googlevideo.com/audio', {
    signal: controller.signal,
    fetcher: async () => {
      called = true;
      return new Response('bad');
    },
  });
  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(called, false);
  release();
  assert.equal((await first).length, 20000);
});

test('request for an alternate format bypasses a repeatedly failing HLS rendition', async () => {
  const good = 'https://rr1.googlevideo.com/audio';
  let manifests = 0;
  const result = await extractYouTubeAccountStream(
    'test',
    {
      basic_info: { id: 'test' },
      playability_status: { status: 'OK' },
      streaming_data: {
        hls_manifest_url: 'https://rr1.googlevideo.com/manifest',
        adaptive_formats: [
          { itag: 251, mime_type: 'audio/webm', url: good, decipher: async () => good },
        ],
      },
    },
    undefined,
    async () => {
      manifests++;
      throw new Error('broken');
    },
    { preferAlternateFormat: true, excludeItag: 140 },
  );
  assert.equal(result.url, good);
  assert.equal(manifests, 0);
});

test('full cache reclaims old speculative audio before downloading the next recording', async () => {
  const original = globalThis.fetch;
  const cache = new AudioCacheService({ maxBytes: 100000 });
  cache.setCache('old', 'blob:old', 90000);
  globalThis.fetch = async () =>
    new Response(new Uint8Array(30000), {
      headers: { 'content-type': 'audio/mpeg', 'content-length': '30000' },
    });
  try {
    assert.match(await cache.getOrFetchBlobUrl('next', 'https://media.test/next.mp3'), /^blob:/);
    assert.equal(cache.isCached('next'), true);
    assert.equal(cache.isCached('old'), false);
  } finally {
    globalThis.fetch = original;
    cache.clear();
  }
});

test('switching away from HLS preserves a sole progressive candidate without a rejected itag', async () => {
  const good = 'https://rr1.googlevideo.com/audio';
  const result = await extractYouTubeAccountStream(
    'test',
    {
      basic_info: { id: 'test' },
      playability_status: { status: 'OK' },
      streaming_data: {
        hls_manifest_url: 'https://rr1.googlevideo.com/manifest',
        adaptive_formats: [
          { itag: 140, mime_type: 'audio/mp4', url: good, decipher: async () => good },
        ],
      },
    },
    undefined,
    async () => {
      throw new Error('must bypass HLS');
    },
    { preferAlternateFormat: true },
  );
  assert.equal(result.url, good);
});

test('a chunked next recording can replace an old cache entry', async () => {
  const original = globalThis.fetch;
  const cache = new AudioCacheService({ maxBytes: 100000 });
  cache.setCache('old', 'blob:old', 80000);
  globalThis.fetch = async () => new Response(new Uint8Array(30000));
  try {
    assert.match(await cache.getOrFetchBlobUrl('next', 'https://media.test/next.mp3'), /^blob:/);
    assert.equal(cache.isCached('next'), true);
  } finally {
    globalThis.fetch = original;
    cache.clear();
  }
});
