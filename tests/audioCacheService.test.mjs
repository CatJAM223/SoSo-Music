import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioCacheService } from '../src/shared/services/audioCacheService.ts';

test('AudioCacheService: mobile byte budget evicts multiple old items and preserves playing audio', () => {
  const cache = new AudioCacheService({ maxItems: 4, maxBytes: 24 * 1024 * 1024 });
  const mb = 1024 * 1024;
  cache.setCache('playing', 'blob:playing', 8 * mb);
  cache.setPinnedUrl('blob:playing');
  cache.setCache('old-one', 'blob:old-one', 6 * mb);
  cache.setCache('old-two', 'blob:old-two', 6 * mb);
  cache.setCache('incoming', 'blob:incoming', 12 * mb);
  assert.equal(cache.isCached('playing'), true);
  assert.equal(cache.isCached('incoming'), true);
  assert.equal(cache.isCached('old-one'), false);
  assert.equal(cache.isCached('old-two'), false);
  assert.equal(cache.getCacheBytes(), 20 * mb);
  assert.equal(cache.setCache('too-large', 'blob:too-large', 25 * mb), false);
  assert.equal(cache.getCacheBytes(), 20 * mb);
  assert.equal(cache.setCache('cannot-fit-with-playing', 'blob:cannot-fit', 20 * mb), false);
  assert.equal(cache.isCached('playing'), true);
  assert.equal(cache.getCacheBytes(), 8 * mb);
});

test('AudioCacheService: Cache initialization, LRU memory limit, and pinned playback preservation', () => {
  const cache = new AudioCacheService({ maxItems: 12 });
  assert.equal(cache.MAX_CACHE_ITEMS, 12);

  // Fill cache up to capacity (12 items)
  for (let i = 1; i <= 12; i++) {
    cache.setCache(`track_${i}`, `blob:http://localhost/blob_${i}`, 100000);
  }
  assert.equal(cache.getCacheSize(), 12);
  assert.equal(cache.isCached('track_1'), true);
  assert.equal(cache.isCached('track_12'), true);

  // Pin track_1 (currently playing in audio element - must NEVER be evicted)
  cache.setPinnedUrl('blob:http://localhost/blob_1');

  // Refresh timestamp of track_2 by getting its blob URL
  const blob2 = cache.getCachedBlobUrl('track_2');
  assert.equal(blob2, 'blob:http://localhost/blob_2');

  // Add 13th item -> triggers LRU eviction. Track 1 is pinned, Track 2 is freshly accessed -> Track 3 (oldest unpinned) is evicted
  cache.setCache('track_13', 'blob:http://localhost/blob_13', 100000);
  assert.equal(cache.getCacheSize(), 12);
  assert.equal(cache.isCached('track_1'), true, 'Pinned playing track must survive LRU eviction');
  assert.equal(cache.isCached('track_2'), true, 'Freshly accessed track must survive LRU eviction');
  assert.equal(cache.isCached('track_13'), true, 'New track must be cached');
  assert.equal(cache.isCached('track_3'), false, 'Oldest unpinned track should be evicted');

  // Discard dead URL
  cache.discardByUrl('blob:http://localhost/blob_2');
  assert.equal(cache.isCached('track_2'), false, 'Discarded URL must be purged from cache Map');
  assert.equal(cache.getCacheSize(), 11);

  // Clear cache
  cache.clear();
  assert.equal(cache.getCacheSize(), 0);
});

test('AudioCacheService: HLS vs Progressive stream classification', () => {
  assert.equal(AudioCacheService.isHlsUrl('https://cf-hls-media.sndcdn.com/playlist.m3u8'), true);
  assert.equal(
    AudioCacheService.isHlsUrl('https://audio-streaming.example.com/playlist?format=audio/mpegurl'),
    true,
  );
  assert.equal(
    AudioCacheService.isHlsUrl('https://api-v2.soundcloud.com/media/tracks:123/stream/hls'),
    true,
  );
  assert.equal(
    AudioCacheService.isHlsUrl('https://cdns-preview-d.dzcdn.net/stream/c-d.mp3'),
    false,
  );
  assert.equal(
    AudioCacheService.isHlsUrl(
      'https://playback.media-streaming.soundcloud.cloud/aac_160k/audio.mp3',
    ),
    false,
  );
  assert.equal(AudioCacheService.isHlsUrl(''), false);
  assert.equal(AudioCacheService.isHlsUrl(null), false);
});

test('Desktop transient cache retains upcoming tracks within a 16 MB budget and preserves playing audio', () => {
  const cache = new AudioCacheService(),
    mb = 1024 * 1024;
  assert.equal(cache.MAX_CACHE_BYTES, 16 * mb);
  cache.setCache('playing', 'blob:playing-budget', 8 * mb);
  cache.setPinnedUrl('blob:playing-budget');
  for (let i = 0; i < 30; i++) cache.setCache('test' + i, 'blob:test' + i, 4 * mb);
  assert.ok(cache.getCacheBytes() <= 16 * mb);
  assert.equal(cache.isCached('playing'), true);
  assert.equal(cache.isCached('test29'), true);
  assert.equal(cache.isCached('test28'), true);
  cache.clear();
});

test('Clearing during an in-flight download cannot repopulate the cache or delete a new request', async () => {
  const cache = new AudioCacheService(),
    originalFetch = globalThis.fetch;
  let finish;
  let signal;
  try {
    globalThis.fetch = (_url, opts) => {
      signal = opts.signal;
      return new Promise((resolve) => (finish = resolve));
    };
    const pending = cache.getOrFetchBlobUrl('late', 'https://test.invalid/audio.mp3');
    cache.clear();
    assert.equal(signal.aborted, true);
    finish(new Response(new Uint8Array(32000), { headers: { 'content-type': 'audio/mpeg' } }));
    await pending;
    assert.equal(cache.getCacheSize(), 0);
  } finally {
    globalThis.fetch = originalFetch;
    cache.clear();
  }
});

test('Active playback buffering aborts bulk prefetch without evicting cached music', async () => {
  const cache = new AudioCacheService();
  const originalFetch = globalThis.fetch;
  let finish,
    signal,
    requests = 0;
  cache.setCache('retained', 'blob:retained', 20000);
  try {
    globalThis.fetch = (_url, options) => {
      requests++;
      signal = options.signal;
      return new Promise((resolve) => (finish = resolve));
    };
    const download = cache.getOrFetchBlobUrl('incoming', 'https://test.invalid/audio.mp3');
    cache.setPlaybackBuffering(true);
    assert.equal(signal.aborted, true);
    assert.equal(
      await cache.getOrFetchBlobUrl('blocked', 'https://test.invalid/blocked.mp3'),
      'https://test.invalid/blocked.mp3',
    );
    assert.equal(requests, 1, 'No competing bulk fetch while the player buffers');
    finish(new Response(new Uint8Array(32000), { headers: { 'content-type': 'audio/mpeg' } }));
    await download;
    assert.equal(cache.isCached('incoming'), false);
    assert.equal(cache.isCached('retained'), true);
    cache.setPlaybackBuffering(false);
    globalThis.fetch = async () => {
      requests++;
      return new Response(new Uint8Array(32000), { headers: { 'content-type': 'audio/mpeg' } });
    };
    await cache.getOrFetchBlobUrl('ready', 'https://test.invalid/ready.mp3');
    assert.equal(requests, 2);
    assert.equal(cache.isCached('ready'), true);
  } finally {
    globalThis.fetch = originalFetch;
    cache.clear();
  }
});

test('A prefetch resolver finishing after a track switch cannot start an obsolete bulk download', async (t) => {
  const { platformBridge } = await import('../src/shared/bridge/platformBridge.ts');
  const cache = new AudioCacheService();
  let finish,
    requests = 0;
  const originalFetch = globalThis.fetch;
  t.mock.method(
    platformBridge,
    'getFullStreamUrl',
    () => new Promise((resolve) => (finish = resolve)),
  );
  try {
    globalThis.fetch = async () => {
      requests++;
      return new Response(new Uint8Array(32000));
    };
    const pending = cache.prefetchTrack({
      id: 'sc_123',
      title: 'Old proposal',
      artist: { name: 'Fixture' },
      source: 'soundcloud',
    });
    cache.setPlaybackBuffering(true);
    cache.setPlaybackBuffering(false);
    finish('https://test.invalid/obsolete.mp3');
    await pending;
    assert.equal(requests, 0);
    assert.equal(cache.getCacheSize(), 0);
  } finally {
    globalThis.fetch = originalFetch;
    cache.clear();
  }
});

test('Background prefetch deduplicates URL resolution and bounds pending provider work', async (t) => {
  const { platformBridge } = await import('../src/shared/bridge/platformBridge.ts');
  const cache = new AudioCacheService({ maxConcurrentFetches: 2 });
  const pending = [];
  t.mock.method(
    platformBridge,
    'getFullStreamUrl',
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const song = (id) => ({ id, title: id, artist: { name: 'Fixture' }, source: 'soundcloud' });
  const first = cache.prefetchTrack(song('first'));
  const duplicate = cache.prefetchTrack(song('first'));
  assert.equal(first, duplicate);
  const second = cache.prefetchTrack(song('second'));
  for (let i = 0; i < 100; i++) void cache.prefetchTrack(song('extra-' + i));
  assert.equal(pending.length, 2);
  for (const resolve of pending) resolve('https://test.invalid/playlist.m3u8');
  await Promise.all([first, second]);
  const next = cache.prefetchTrack(song('third'));
  assert.equal(pending.length, 3);
  pending[2]('https://test.invalid/playlist.m3u8');
  await next;
  cache.clear();
});

test('Foreground buffering invalidates late background sources without starting a download', async (t) => {
  const { platformBridge } = await import('../src/shared/bridge/platformBridge.ts');
  const cache = new AudioCacheService();
  let resolve;
  let downloads = 0;
  t.mock.method(platformBridge, 'getFullStreamUrl', () => new Promise((yes) => (resolve = yes)));
  t.mock.method(globalThis, 'fetch', async () => {
    downloads++;
    throw Error('Unwanted download');
  });
  const pending = cache.prefetchTrack({
    id: 'late',
    title: 'Late',
    artist: { name: 'Fixture' },
    source: 'soundcloud',
  });
  cache.setPlaybackBuffering(true);
  resolve('https://test.invalid/audio.mp3');
  await pending;
  assert.equal(downloads, 0);
  assert.equal(cache.getCacheBytes(), 0);
  cache.clear();
});
