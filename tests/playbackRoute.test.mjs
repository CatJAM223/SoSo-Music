import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { playbackRouteLog } from '../src/desktop/main/services/playbackRoute.ts';
const event = {
  event: 'playback-start',
  trackId: 'yt_W0LiTBNjJ_o',
  source: 'youtube',
  delivery: 'hls',
};
test('Playing diagnostics include account delivery and anonymous fallback for the actual track', () => {
  assert.match(
    playbackRouteLog(event, (id) => {
      assert.equal(id, event.trackId);
      return { via: 'account', client: 'WEB' };
    }),
    /via=account delivery=hls/,
  );
  assert.match(
    playbackRouteLog({ ...event, delivery: 'progressive' }, () => ({
      via: 'anonymous',
      client: 'VISIONOS',
    })),
    /via=anonymous delivery=progressive/,
  );
  assert.match(
    playbackRouteLog(event, () => undefined),
    /via=unknown delivery=hls/,
  );
});
test('Local playback does not imply a new request through a saved YouTube account', () => {
  assert.match(
    playbackRouteLog({ ...event, delivery: 'local-cache' }, () =>
      assert.fail('No account request for cached audio'),
    ),
    /via=local-cache delivery=local-cache/,
  );
  assert.match(
    playbackRouteLog(
      { ...event, trackId: 1877802108, source: 'soundcloud', delivery: 'progressive' },
      () => assert.fail(),
    ),
    /source=soundcloud via=direct/,
  );
});
test('Prefetch, malformed metadata and URLs containing secrets do not create playing-route logs', () => {
  for (const meta of [
    undefined,
    null,
    'token=secret',
    { ...event, event: 'prefetch' },
    { ...event, trackId: 'https://example.test/?secret=token' },
    { ...event, delivery: 'https://cdn.test/?token=secret' },
  ])
    assert.equal(
      playbackRouteLog(meta, () =>
        assert.fail('Invalid route metadata must not query the resolver'),
      ),
      undefined,
    );
});

test('The main-process logger connects a real playing event to cached route metadata without any network call', () => {
  const main = readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');
  const begin = main.indexOf("  ipcMain.on('logger:logPlaybackEvent'");
  const end = main.indexOf("  ipcMain.handle('logger:getRecentLogs'", begin);
  assert.ok(begin >= 0 && end > begin);
  let listener;
  const lines = [],
    ids = [];
  vm.runInNewContext(stripTypeScriptTypes(main.slice(begin, end)), {
    ipcMain: {
      on(_channel, fn) {
        listener = fn;
      },
    },
    playbackRouteLog,
    YouTubeMusicService: {
      getStreamRoute(id) {
        ids.push(id);
        return { via: 'account', client: 'WEB' };
      },
    },
    PlaybackLogger: {
      log(_level, line) {
        lines.push(line);
      },
      info(line) {
        lines.push(line);
      },
    },
  });
  listener({}, { message: '[AudioPlayer:Playing] Track started', meta: event });
  assert.equal(lines.length, 2);
  assert.match(lines[1], /via=account delivery=hls/);
  assert.deepEqual(ids, [event.trackId]);
  listener(
    {},
    { message: '[Track:Prefetch] Resolving next track', meta: { ...event, event: 'prefetch' } },
  );
  assert.equal(lines.length, 3);
  assert.equal(ids.length, 1);
});

test('Actual audio playing callback sends structured route metadata instead of printing its source code', () => {
  const source = readFileSync(
    new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
    'utf8',
  );
  const begin = source.indexOf('    const handlePlaying = () => {');
  const end = source.indexOf('    const handleWaiting', begin);
  assert.ok(begin > 0 && end > begin);
  const captured = [];
  const audio = { paused: false, src: 'https://rr1.googlevideo.com/videoplayback', duration: 106 };
  const context = {
    audio,
    audioRef: { current: audio },
    pendingResolutionRef: { current: false },
    audioCacheService: { setPlaybackBuffering() {}, setPlaybackActive() {} },
    offlineCacheService: { releaseUnusedTrackUrls() {} },
    crossfadeRef: { current: {} },
    cancelTemporaryRetry() {},
    temporaryRecoveryRef: {},
    temporaryRetryAttemptRef: { current: 0 },
    consecutivePlaybackErrorsRef: { current: 0 },
    streamRequestIdRef: { current: 1 },
    lastLoggedPlaybackRequestRef: { current: null },
    bufferingStartedAtRef: { current: 0 },
    setPlaybackIssue() {},
    clearStalledRecoveryTimer() {},
    isTransitioningTrackRef: {},
    trackTransitionTimestampRef: {},
    setIsLoadingTrack() {},
    streamRetryCountRef: {},
    handledMediaErrorRef: {},
    currentTrackRef: { current: { id: 'yt_W0LiTBNjJ_o', title: 'попал' } },
    rejectedStreamTracksRef: { current: new Set() },
    trackClickTimestampRef: { current: Date.now() },
    mainHlsRef: { current: null },
    detectTrackSource: () => 'youtube',
    PlaybackLogger: { info: (message, meta) => captured.push({ message, meta }) },
  };
  const invoke = () =>
    vm.runInNewContext('{' + source.slice(begin, end) + '\nhandlePlaying();}', context);
  invoke();
  assert.equal(captured[0].meta.event, 'playback-start');
  assert.equal(captured[0].meta.delivery, 'progressive');
  assert.equal(captured[0].meta.trackId, 'yt_W0LiTBNjJ_o');
  assert.ok(!captured[0].message.includes('trk?.id'));
  context.mainHlsRef.current = {};
  context.streamRequestIdRef.current++;
  invoke();
  assert.equal(captured[1].meta.delivery, 'hls');
  context.mainHlsRef.current = null;
  audio.src = 'blob:cached';
  context.streamRequestIdRef.current++;
  invoke();
  assert.equal(captured[2].meta.delivery, 'local-cache');
  audio.paused = true;
  invoke();
  assert.equal(captured.length, 3);
});
