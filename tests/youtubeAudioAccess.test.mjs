import { getStreamResolveFailure } from '../src/shared/utils/streamResolveError.ts';
import { StreamResolveTimeoutError } from '../src/shared/utils/streamResolveDeadline.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import * as access from '../src/shared/utils/youtubeAudioAccessError.ts';

const gate = { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' };
const playable = (id = 'healthy') =>
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
    'audioStreamRequests',
    'audioAccessFailures',
    'cachedVisitorData',
    'visitorDataRequest',
  ];
  const previous = Object.fromEntries(fields.map((key) => [key, YouTubeMusicService[key]]));
  YouTubeMusicService.streamCache = new Map();
  YouTubeMusicService.audioStreamRequests = new Map();
  YouTubeMusicService.audioAccessFailures = new Map();
  YouTubeMusicService.cachedVisitorData = null;
  YouTubeMusicService.visitorDataRequest = null;
  t.after(() => Object.assign(YouTubeMusicService, previous));
}

test('YouTube audio: identifies login challenges and preserves their cause through IPC serialization', () => {
  assert.equal(access.classifyYouTubeAudioAccessError(gate), access.YOUTUBE_AUDIO_BOT_CHECK);
  assert.equal(
    access.classifyYouTubeAudioAccessError({
      status: 'LOGIN_REQUIRED',
      reason: 'Sign in to confirm your age',
    }),
    access.YOUTUBE_AUDIO_AGE_RESTRICTED,
  );
  assert.equal(
    access.classifyYouTubeAudioAccessError({ status: 'LOGIN_REQUIRED', reason: 'Please sign in' }),
    access.YOUTUBE_AUDIO_LOGIN_REQUIRED,
  );
  assert.equal(
    access.classifyYouTubeAudioAccessError({
      status: 'UNPLAYABLE',
      reason: 'Music Premium required',
    }),
    null,
  );
  assert.equal(
    access.getYouTubeAudioAccessError(
      new Error(
        "Error invoking remote method 'music:getFullStreamUrl': Error: " +
          access.YOUTUBE_AUDIO_BOT_CHECK,
      ),
    ),
    'verification-required',
  );
  assert.equal(access.getYouTubeAudioAccessError(new Error('Network failed')), null);
});

test('YouTube audio: concurrent playback and prefetch share one request, challenge is not retried', async (t) => {
  isolate(t);
  let requests = 0;
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => 'visitor');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
    requests++;
    await Promise.resolve();
    return Response.json({ playabilityStatus: gate });
  });
  const results = await Promise.allSettled([
    YouTubeMusicService.resolveDirectAudioStream('botfixture1'),
    YouTubeMusicService.resolveDirectAudioStream('yt_botfixture1'),
    YouTubeMusicService.resolveDirectAudioStream('botfixture1'),
  ]);
  assert.equal(requests, 1);
  assert.ok(
    results.every(
      (result) =>
        result.status === 'rejected' && result.reason.message === access.YOUTUBE_AUDIO_BOT_CHECK,
    ),
  );
  assert.equal(YouTubeMusicService.audioStreamRequests.size, 0);
  await assert.rejects(YouTubeMusicService.resolveDirectAudioStream('botfixture1'), {
    message: access.YOUTUBE_AUDIO_BOT_CHECK,
  });
  assert.equal(
    requests,
    1,
    'Re-clicking or prefetching during cooldown must not send another player request',
  );
});

test('YouTube audio: a challenged track neither blocks healthy cached tracks nor poisons other resolutions', async (t) => {
  isolate(t);
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  const ids = [];
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async (payload) => {
    ids.push(payload.videoId);
    return payload.videoId === 'botfixture2'
      ? Response.json({ playabilityStatus: gate })
      : playable(payload.videoId);
  });
  await assert.rejects(YouTubeMusicService.resolveDirectAudioStream('botfixture2'));
  const healthy = await YouTubeMusicService.resolveDirectAudioStream('okfixture02');
  assert.equal(await YouTubeMusicService.resolveDirectAudioStream('okfixture02'), healthy);
  assert.deepEqual(ids, ['botfixture2', 'okfixture02']);
});

test('YouTube audio: the short challenge cooldown expires and a recovered track is playable', async (t) => {
  isolate(t);
  let now = 1000000,
    calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () =>
    ++calls === 1 ? Response.json({ playabilityStatus: gate }) : playable(),
  );
  await assert.rejects(YouTubeMusicService.resolveDirectAudioStream('expirytest1'));
  now += 29999;
  await assert.rejects(YouTubeMusicService.resolveDirectAudioStream('expirytest1'));
  assert.equal(calls, 1);
  now += 2;
  assert.ok(
    (await YouTubeMusicService.resolveDirectAudioStream('expirytest1')).includes('googlevideo.com'),
  );
  assert.equal(calls, 2);
  assert.equal(YouTubeMusicService.audioAccessFailures.size, 0);
});

test('YouTube audio: explicit stream recovery can retry before the short cooldown expires', async (t) => {
  isolate(t);
  let calls = 0;
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () =>
    ++calls === 1 ? Response.json({ playabilityStatus: gate }) : playable(),
  );
  await assert.rejects(YouTubeMusicService.resolveDirectAudioStream('refreshbot1'));
  assert.ok(
    (await YouTubeMusicService.resolveDirectAudioStream('refreshbot1', false, true)).includes(
      'googlevideo.com',
    ),
  );
  assert.equal(calls, 2);
});

test('YouTube visitor data: parallel tracks share one refresh, next forced refresh remains available', async (t) => {
  isolate(t);
  let release,
    calls = 0;
  const latch = new Promise((resolve) => (release = resolve));
  t.mock.method(YouTubeMusicTransport, 'fetch', async () => {
    calls++;
    await latch;
    return Response.json({ responseContext: { visitorData: 'shared-visitor' } });
  });
  const pending = [
    YouTubeMusicService.getVisitorData(),
    YouTubeMusicService.getVisitorData(),
    YouTubeMusicService.getVisitorData(true),
  ];
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all(pending), [
    'shared-visitor',
    'shared-visitor',
    'shared-visitor',
  ]);
  assert.equal(YouTubeMusicService.visitorDataRequest, null);
  assert.equal(await YouTubeMusicService.getVisitorData(true), 'shared-visitor');
  assert.equal(calls, 2);
});

test('YouTube audio: transient transport failure retains a bounded retry without awaiting its own in-flight promise', async (t) => {
  isolate(t);
  let calls = 0;
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
    if (++calls === 1) throw new Error('temporary connection reset');
    return playable();
  });
  assert.ok(
    (await YouTubeMusicService.resolveDirectAudioStream('retrytest01')).includes('googlevideo.com'),
  );
  assert.equal(calls, 2);
  assert.equal(YouTubeMusicService.audioStreamRequests.size, 0);
});

test('YouTube audio: a successful shared resolution keeps the original video and stream cache', async (t) => {
  isolate(t);
  let calls = 0;
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async (payload) => {
    calls++;
    return playable(payload.videoId);
  });
  const urls = await Promise.all([
    YouTubeMusicService.resolveDirectAudioStream('okfixture03'),
    YouTubeMusicService.resolveDirectAudioStream('okfixture03'),
  ]);
  assert.equal(urls[0], urls[1]);
  assert.ok(urls[0].endsWith('id=okfixture03'));
  assert.equal(await YouTubeMusicService.resolveDirectAudioStream('okfixture03'), urls[0]);
  assert.equal(calls, 1);
});

function runResolutionFailure(error) {
  const source = fs.readFileSync(
    new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
    'utf8',
  );
  const begin = source.indexOf(
    '.catch((err) => {',
    source.indexOf('[Track:Stream] No playable stream URL'),
  );
  assert.ok(begin >= 0);
  const end = source.indexOf('\n        });', begin);
  const body = source.slice(begin + '.catch((err) => {'.length, end).trim();
  const events = [];
  const audio = {
    pause: () => events.push('pause'),
    removeAttribute: (name) => events.push('remove:' + name),
    load: () => events.push('load'),
    src: 'old-stream',
  };
  const sandbox = {
    err: error,
    console: { error() {} },
    currentRequestId: 1,
    effectiveSource: 'youtube',
    clickStartTime: Date.now(),
    handleUnavailableStreamRef: {
      current: (track, requestId) => events.push('unavailable:' + track.id + ':' + requestId),
    },
    streamRequestIdRef: { current: 1 },
    startPosition: 0,
    navigator: { onLine: true },
    getStreamResolveFailure,
    holdTemporaryFailure: (kind) => {
      events.push('temporary:' + kind);
    },
    StreamResolveTimeoutError,
    PlaybackLogger: { warn() {} },
    isTransitioningTrackRef: { current: true },
    setIsLoadingTrack: (value) => events.push('loading:' + value),
    setIsPlaying: (value) => events.push('playing:' + value),
    ...access,
    isYouTube: true,
    audioRef: { current: audio },
    track: { id: 'yt_fixture', title: 'Test' },
    isPlayableStreamForTrack: () => false,
    isWaveActiveRef: { current: true },
    queueRef: { current: [{}, {}] },
    emitYouTubeAccessIssue: (issue) => {
      events.push('hint:' + issue.reason + ':' + issue.source + ':' + issue.trackId);
      return false;
    },
    emitToast: (message) => events.push(message),
    schedulePlaybackRecovery: () => events.push('auto-next-scheduled'),
    nextTrackRef: { current: () => events.push('next') },
  };
  vm.runInNewContext(stripTypeScriptTypes('(function(){' + body + '})();'), sandbox);
  return events;
}

test('YouTube playback UI: a human-verification challenge explains the problem and avoids a queue-wide skip loop', () => {
  const events = runResolutionFailure(new Error(access.YOUTUBE_AUDIO_BOT_CHECK));
  assert.ok(events.includes('playing:false'));
  assert.ok(events.includes('hint:verification-required:track:yt_fixture'));
  assert.ok(events.includes('remove:src'));
  assert.ok(events.some((event) => event.includes('подтвердить, что вы не бот')));
  assert.ok(!events.includes('auto-next-scheduled'));
});

test('Unavailable resolution delegates to the shared bounded queue-recovery path', () => {
  const events = runResolutionFailure(new Error('recording unavailable'));
  assert.ok(events.includes('unavailable:yt_fixture:1'));
});
test('A whole stream timeout clears the spinner, explains the network delay and does not skip the queue', () => {
  const events = runResolutionFailure(new StreamResolveTimeoutError());
  assert.ok(events.includes('loading:false'));
  assert.ok(events.includes('temporary:timeout'));
  assert.ok(!events.includes('auto-next-scheduled')); // Full hold/pause/position behavior is tested through the complete hook.
});
