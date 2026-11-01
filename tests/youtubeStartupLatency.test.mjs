import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeMusicService as yt } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport as transport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import { PlaybackLogger } from '../src/desktop/main/services/playbackLogger.ts';
import { timeYouTubeResolve } from '../src/desktop/main/services/youtubeResolveTiming.ts';
import { runStreamResolve } from '../src/desktop/main/services/streamResolveContext.ts';
function isolate(t) {
  const fields = [
    'streamCache',
    'accountResolver',
    'cachedVisitorData',
    'visitorDataRequest',
    'visitorRetryAfter',
    'sessionEpoch',
    'sessionRecoveryRequest',
    'audioAccessFailures',
    'audioStreamRequests',
    'playerStreamRequests',
    'playerStreamOptions',
  ];
  const old = Object.fromEntries(fields.map((key) => [key, yt[key]]));
  Object.assign(yt, {
    streamCache: new Map(),
    accountResolver: null,
    cachedVisitorData: null,
    visitorDataRequest: null,
    visitorRetryAfter: 0,
    sessionEpoch: 0,
    sessionRecoveryRequest: null,
    audioAccessFailures: new Map(),
    audioStreamRequests: new Map(),
    playerStreamRequests: new Map(),
    playerStreamOptions: new Map(),
  });
  t.after(() => Object.assign(yt, old));
}
const playable = (id, visitor) =>
  Response.json({
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: id },
    responseContext: visitor ? { visitorData: visitor } : {},
    streamingData: {
      adaptiveFormats: [
        {
          itag: 140,
          mimeType: 'audio/mp4',
          url: 'https://rr1.googlevideo.com/videoplayback?itag=140&id=' + id,
        },
      ],
    },
  });
test('A working stream cache does not wait for another session recovery', async (t) => {
  isolate(t);
  const url = 'https://rr1.googlevideo.com/videoplayback?itag=140';
  yt.streamCache.set('cached', { url, expiresAt: Date.now() + 60000 });
  yt.sessionRecoveryRequest = new Promise(() => {});
  const result = await Promise.race([
    yt.resolveDirectAudioStream('cached'),
    new Promise((resolve) => setImmediate(() => resolve('blocked'))),
  ]);
  assert.equal(result, url);
});
test('Failed visitor bootstrap is not repeated for each song and forced refresh bypasses cooldown', async (t) => {
  isolate(t);
  let requests = 0,
    now = 100000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(transport, 'fetch', async () => {
    requests++;
    return new Response('', { status: 503 });
  });
  t.mock.method(transport, 'postPlayer', async (payload) => playable(payload.videoId));
  await yt.resolveDirectAudioStream('one');
  await yt.resolveDirectAudioStream('two');
  assert.equal(requests, 1);
  now += 31000;
  await yt.resolveDirectAudioStream('three');
  assert.equal(requests, 2);
  await yt.getVisitorData(true);
  assert.equal(requests, 3);
});
test('Successful player response supplies visitor data after bootstrap failure', async (t) => {
  isolate(t);
  let requests = 0;
  const visitors = [];
  t.mock.method(transport, 'fetch', async () => {
    requests++;
    return new Response('', { status: 503 });
  });
  t.mock.method(transport, 'postPlayer', async (payload) => {
    visitors.push(payload.context.client.visitorData);
    return playable(payload.videoId, 'fresh-player-visitor');
  });
  await yt.resolveDirectAudioStream('one');
  await yt.resolveDirectAudioStream('two');
  assert.equal(requests, 1);
  assert.deepEqual(visitors, [undefined, 'fresh-player-visitor']);
});
test('A late failed visitor request cannot throttle a replacement session', async (t) => {
  isolate(t);
  let deliver;
  t.mock.method(transport, 'fetch', () => new Promise((resolve) => (deliver = resolve)));
  const pending = yt.getVisitorData();
  yt.sessionEpoch++;
  yt.visitorRetryAfter = 0;
  deliver(new Response('', { status: 503 }));
  await pending;
  assert.equal(yt.visitorRetryAfter, 0);
});
test('Slow successful, failed and cancelled stages are timed without signed URLs or error details', async (t) => {
  let now = 0;
  const logs = [];
  t.mock.method(performance, 'now', () => now);
  t.mock.method(PlaybackLogger, 'info', (message) => logs.push(message));
  const url = 'https://example.com/?secret=credential';
  await timeYouTubeResolve('video', 'player-request', async () => {
    now += 2500;
    return url;
  });
  const failure = Error('secret-cookie');
  await assert.rejects(
    timeYouTubeResolve('video', 'account-delivery', () => {
      now += 3000;
      throw failure;
    }),
    (error) => error === failure,
  );
  const controller = new AbortController();
  let release;
  const pending = runStreamResolve(controller.signal, () =>
    timeYouTubeResolve('video', 'visitor', () => new Promise((resolve) => (release = resolve))),
  );
  now += 4000;
  controller.abort();
  await assert.rejects(pending);
  release(url);
  assert.equal(logs.length, 3);
  assert.ok(logs[0].includes('outcome=ok'));
  assert.ok(logs[1].includes('outcome=failed'));
  assert.ok(logs[2].includes('outcome=cancelled'));
  assert.ok(logs.every((line) => !line.includes('secret') && !line.includes('https:')));
});
