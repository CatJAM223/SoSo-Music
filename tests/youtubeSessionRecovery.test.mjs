import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeMusicService as yt } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport as transport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import { setYouTubeSessionReset } from '../src/desktop/main/services/desktopFetch.ts';
import { clearYouTubeSessionCache } from '../src/desktop/main/services/youtubeSessionCache.ts';
import { YOUTUBE_AUDIO_BOT_CHECK } from '../src/shared/utils/youtubeAudioAccessError.ts';
const bot = { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' };
const response = (status) => Response.json({ playabilityStatus: status });
const playable = (id) =>
  Response.json({
    playabilityStatus: { status: 'OK' },
    streamingData: {
      adaptiveFormats: [
        {
          itag: 140,
          mimeType: 'audio/mp4',
          bitrate: 128000,
          url: 'https://rr1.googlevideo.com/videoplayback?itag=140&id=' + id,
        },
      ],
    },
  });
function isolate(t) {
  const fields = [
    'streamCache',
    'videoStreamCache',
    'videoDurationCache',
    'searchCache',
    'audioStreamRequests',
    'playerStreamRequests',
    'playerStreamOptions',
    'audioAccessFailures',
    'cachedVisitorData',
    'visitorDataRequest',
    'sessionEpoch',
    'sessionRecoveryRequest',
    'lastSessionRecoveryAt',
  ];
  const prior = Object.fromEntries(fields.map((key) => [key, yt[key]]));
  for (const key of fields.filter(
    (key) =>
      key.endsWith('Cache') ||
      key === 'audioStreamRequests' ||
      key === 'playerStreamRequests' ||
      key === 'playerStreamOptions' ||
      key === 'audioAccessFailures',
  ))
    yt[key] = new Map();
  Object.assign(yt, {
    cachedVisitorData: null,
    visitorDataRequest: null,
    sessionEpoch: 0,
    sessionRecoveryRequest: null,
    lastSessionRecoveryAt: -Infinity,
  });
  t.after(() => {
    Object.assign(yt, prior);
    setYouTubeSessionReset(null);
  });
}
const active = (id) =>
  yt.resolveDirectAudioStream(id, false, false, { allowSessionRecovery: true });

test('YouTube session recovery: browser cleanup leaves app storage and other providers untouched', async () => {
  const calls = [];
  await clearYouTubeSessionCache({
    clearCache: async () => calls.push('http-cache'),
    clearStorageData: async (options) => calls.push(options),
    forceReloadProxyConfig: async () => calls.push('proxy'),
  });
  assert.deepEqual(calls, [
    'http-cache',
    { origin: 'https://www.youtube.com', storages: ['cookies', 'cachestorage'] },
    { origin: 'https://music.youtube.com', storages: ['cookies', 'cachestorage'] },
    'proxy',
  ]);
});

test('YouTube session recovery: reset precedes retry and refreshes visitor and stream caches', async (t) => {
  isolate(t);
  let resets = 0,
    posts = 0;
  const visitors = [];
  yt.cachedVisitorData = { visitorData: 'stale', expiresAt: Date.now() + 100000 };
  yt.streamCache.set('other', { url: 'old-stream', expiresAt: Date.now() + 100000 });
  yt.videoStreamCache.set('video', { url: 'old-video', expiresAt: Date.now() + 100000 });
  setYouTubeSessionReset(async () => {
    resets++;
    assert.equal(yt.cachedVisitorData, null);
    assert.equal(yt.streamCache.size, 0);
    assert.equal(yt.videoStreamCache.size, 0);
  });
  t.mock.method(transport, 'fetch', async () =>
    Response.json({ responseContext: { visitorData: 'fresh' } }),
  );
  t.mock.method(transport, 'postPlayer', async (payload) => {
    posts++;
    visitors.push(payload.context.client.visitorData);
    return posts === 1 ? response(bot) : playable(payload.videoId);
  });
  const url = await active('recovery001');
  assert.ok(url.includes('googlevideo.com'));
  assert.equal(resets, 1);
  assert.equal(posts, 2);
  assert.deepEqual(visitors, ['stale', 'fresh']);
  assert.equal(yt.cachedVisitorData.visitorData, 'fresh');
  assert.equal(await active('recovery001'), url);
  assert.equal(posts, 2);
});

test('YouTube session recovery: persistent verification returns an error only after one reset and retry', async (t) => {
  isolate(t);
  let resets = 0,
    posts = 0;
  setYouTubeSessionReset(async () => resets++);
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async () => {
    posts++;
    return response(bot);
  });
  await assert.rejects(active('recovery002'), { message: YOUTUBE_AUDIO_BOT_CHECK });
  assert.equal(resets, 1);
  assert.equal(posts, 2);
  await assert.rejects(active('recovery002'), { message: YOUTUBE_AUDIO_BOT_CHECK });
  assert.equal(resets, 1);
  assert.equal(posts, 2, 'Repeated clicks must not form an endless reset loop');
});

test('YouTube session recovery: concurrent tracks share cleanup and each retries its original ID once', async (t) => {
  isolate(t);
  let resets = 0;
  const counts = new Map();
  setYouTubeSessionReset(async () => {
    resets++;
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async (payload) => {
    const count = (counts.get(payload.videoId) || 0) + 1;
    counts.set(payload.videoId, count);
    return count === 1 ? response(bot) : playable(payload.videoId);
  });
  const urls = await Promise.all([
    active('recovery003'),
    active('recovery004'),
    active('recovery003'),
  ]);
  assert.equal(resets, 1);
  assert.deepEqual(
    [...counts],
    [
      ['recovery003', 2],
      ['recovery004', 2],
    ],
  );
  assert.ok(urls[0].endsWith('id=recovery003'));
  assert.ok(urls[1].endsWith('id=recovery004'));
  assert.equal(urls[0], urls[2]);
  assert.equal(yt.audioStreamRequests.size, 0);
});

test('YouTube session recovery: a prefetch failure waits for active playback to reset the session', async (t) => {
  isolate(t);
  let resets = 0,
    posts = 0;
  setYouTubeSessionReset(async () => resets++);
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async (payload) =>
    ++posts === 1 ? response(bot) : playable(payload.videoId),
  );
  await assert.rejects(yt.resolveDirectAudioStream('recovery005'), {
    message: YOUTUBE_AUDIO_BOT_CHECK,
  });
  assert.equal(resets, 0);
  assert.equal(posts, 1);
  assert.ok((await active('recovery005')).includes('googlevideo.com'));
  assert.equal(resets, 1);
  assert.equal(posts, 2);
});

test('YouTube session recovery: cleanup failure preserves the provider error and avoids another request', async (t) => {
  isolate(t);
  let posts = 0;
  setYouTubeSessionReset(async () => {
    throw Error('Cache cleanup failed');
  });
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async () => {
    posts++;
    return response(bot);
  });
  await assert.rejects(active('recovery006'), { message: YOUTUBE_AUDIO_BOT_CHECK });
  assert.equal(posts, 1);
  assert.equal(yt.sessionRecoveryRequest, null);
});

test('YouTube session recovery: login and age restrictions never trigger a session reset', async (t) => {
  isolate(t);
  let resets = 0,
    posts = 0;
  setYouTubeSessionReset(async () => resets++);
  t.mock.method(yt, 'getVisitorData', async () => '');
  for (const reason of ['Sign in to confirm your age', 'Please sign in']) {
    t.mock.method(transport, 'postPlayer', async () => {
      posts++;
      return response({ status: 'LOGIN_REQUIRED', reason });
    });
    await assert.rejects(active(reason.includes('age') ? 'recovery007' : 'recovery008'));
  }
  assert.equal(resets, 0);
  assert.equal(posts, 2);
});

test('YouTube session recovery: late visitor data from the old session cannot repopulate the cache', async (t) => {
  isolate(t);
  let release,
    calls = 0;
  const latch = new Promise((resolve) => (release = resolve));
  setYouTubeSessionReset(async () => {});
  t.mock.method(transport, 'fetch', async () => {
    if (++calls === 1) {
      await latch;
      return Response.json({ responseContext: { visitorData: 'old' } });
    }
    return Response.json({ responseContext: { visitorData: 'new' } });
  });
  const old = yt.getVisitorData();
  await yt.resetSession();
  assert.equal(await yt.getVisitorData(), 'new');
  release();
  assert.equal(await old, 'new');
  assert.equal(yt.cachedVisitorData.visitorData, 'new');
});

test('YouTube session recovery: late audio response does not restore a cleared stream cache', async (t) => {
  isolate(t);
  let release;
  const latch = new Promise((resolve) => (release = resolve));
  setYouTubeSessionReset(async () => {});
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async (payload) => {
    await latch;
    return playable(payload.videoId);
  });
  const old = yt.resolveDirectAudioStream('recovery009');
  await Promise.resolve();
  await yt.resetSession();
  release();
  assert.ok((await old).includes('googlevideo.com'));
  assert.equal(yt.streamCache.has('recovery009'), false);
});

test('YouTube session recovery: real playback and prefetch share the player request without giving prefetch reset authority', async (t) => {
  isolate(t);
  let resets = 0,
    posts = 0;
  setYouTubeSessionReset(async () => resets++);
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async (payload) => {
    posts++;
    await Promise.resolve();
    return posts === 1 ? response(bot) : playable(payload.videoId);
  });
  const results = await Promise.allSettled([
    yt.resolveDirectAudioStream('recovery010'),
    active('recovery010'),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(resets, 1);
  assert.equal(posts, 2);
  assert.equal(yt.playerStreamRequests.size, 0);
});
