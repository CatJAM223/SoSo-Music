import { getStreamResolveFailure } from '../src/shared/utils/streamResolveError.ts';
import {
  StreamResolveTimeoutError,
  withStreamResolveDeadline,
} from '../src/shared/utils/streamResolveDeadline.ts';
import {
  recoverPlayerStream,
  resolvePlayerStream,
} from '../src/shared/services/playerStreamResolution.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { isCurrentPlaybackRequest } from '../src/shared/utils/playbackRecovery.ts';
import * as access from '../src/shared/utils/youtubeAudioAccessError.ts';

const source = fs.readFileSync(
  new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
  'utf8',
);
function harness(resolveStream) {
  const begin = source.indexOf('    const handleStreamRecoveryFailure =');
  const end = source.indexOf('    handleErrorRef.current = handleError;', begin);
  assert.ok(begin >= 0 && end > begin);
  const events = [],
    requests = [],
    loads = [];
  const track = {
    id: 'yt_fixture001',
    title: 'Fixture',
    artist: { name: 'Artist' },
    source: 'youtube',
    preview: '',
  };
  const audio = {
    src: 'https://rr1.googlevideo.com/videoplayback?itag=140',
    currentSrc: 'https://rr1.googlevideo.com/videoplayback?itag=140',
    currentTime: 42,
    error: { code: 4 },
    getAttribute: () => audio.src,
    pause: () => events.push('pause'),
    removeAttribute: () => {
      events.push('clear');
      audio.src = '';
    },
    load: () => events.push('load'),
  };
  const context = vm.createContext({
    console: { warn() {}, error() {} },
    Number,
    Date,
    URL,
    ...access,
    isCurrentPlaybackRequest,
    recoverPlayerStream,
    resolvePlayerStream,
    navigator: { onLine: true },
    NativeAudioElement: class {},
    isCachedAudioDecodeError: () => false,
    audioCacheService: { getCachedBlobUrl: () => null, discardByUrl: () => events.push('discard') },
    offlineCacheService: { ownsBlobUrl: () => false },
    getStreamResolveFailure,
    StreamResolveTimeoutError,
    withStreamResolveDeadline,
    playbackAbortRef: { current: new AbortController() },
    audio,
    audioRef: { current: audio },
    currentTrackRef: { current: track },
    streamRequestIdRef: { current: 1 },
    pendingResolutionRef: { current: false },
    streamRetryCountRef: { current: 0 },
    handledMediaErrorRef: { current: null },
    rejectedStreamTracksRef: { current: new Set() },
    resolvedStreamCache: { current: new Map() },
    isTransitioningTrackRef: { current: true },
    mainHlsRef: { current: null },
    clearStalledRecoveryTimer() {},
    detectTrackSource: (t) => t.source,
    setIsLoadingTrack: (v) => events.push('loading:' + v),
    setIsPlaying: (v) => events.push('playing:' + v),
    emitYouTubeAccessIssue: (issue) => {
      events.push('hint:' + issue.reason + ':' + issue.source + ':' + issue.trackId);
      return false;
    },
    finishPlaybackSession: () => events.push('session-finished'),
    emitToast: (message) => events.push(message),
    handleErrorFallbackSkip: () => events.push('skip'),
    holdTemporaryFailure: (kind) => events.push('temporary:' + kind),
    getSafeAudioSourceLabel: () => '<redacted>',
    getAudioItag: (u) => Number(new URL(u).searchParams.get('itag')),
    PlaybackLogger: { error() {} },
    isPlayableStreamForTrack: (url) => Boolean(url),
    platformBridge: {
      getFullStreamUrl: async (t, options) => {
        requests.push({ track: t, options });
        return resolveStream(t, options);
      },
    },
    loadStreamIntoAudio: (element, _hls, url, seek) => {
      loads.push({ url, seek });
      context.pendingResolutionRef.current = false;
      element.src = url;
      element.currentSrc = url;
    },
  });
  vm.runInContext(
    stripTypeScriptTypes(source.slice(begin, end)) + '\nthis.trigger=handleError;',
    context,
  );
  return {
    context,
    audio,
    events,
    requests,
    loads,
    trigger: context.trigger,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test('YouTube media recovery refreshes the same video and resumes from the interrupted position', async () => {
  const h = harness(async () => 'https://rr2.googlevideo.com/videoplayback?itag=140');
  h.trigger();
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].track.id, 'yt_fixture001');
  assert.equal(h.requests[0].options.forceRefresh, true);
  assert.equal(h.loads.length, 1);
  assert.equal(h.loads[0].seek, 42);
  assert.ok(h.events.includes('loading:true'));
  assert.ok(!h.events.includes('skip'));
});

test('YouTube media recovery is bounded and requests another format after one refreshed stream fails', async () => {
  const h = harness(
    async (_track, options) =>
      'https://rr2.googlevideo.com/videoplayback?itag=' +
      (options.preferAlternateFormat ? 251 : 140),
  );
  h.trigger();
  await h.flush();
  h.trigger();
  await h.flush();
  h.trigger();
  await h.flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].options.preferAlternateFormat, true);
  assert.equal(h.requests[1].options.excludeItag, 140);
  assert.equal(h.events.filter((e) => e === 'skip').length, 1);
});

test('YouTube verification during media recovery stops with an explanation instead of skipping the queue', async () => {
  const h = harness(async () => {
    throw new Error('Error invoking remote method: ' + access.YOUTUBE_AUDIO_BOT_CHECK);
  });
  h.trigger();
  await h.flush();
  assert.ok(h.events.includes('playing:false'));
  assert.ok(h.events.includes('clear'));
  assert.ok(h.events.includes('session-finished'));
  assert.ok(h.events.includes('hint:verification-required:track:yt_fixture001'));
  assert.ok(h.events.some((e) => e.includes('подтвердить, что вы не бот')));
  assert.ok(!h.events.includes('skip'));
  assert.equal(h.loads.length, 0);
});

test('Failed normal media recovery still reaches the existing unavailable-track fallback', async () => {
  const h = harness(async () => {
    throw new Error('Connection failed');
  });
  h.trigger();
  await h.flush();
  assert.equal(h.events.filter((e) => e === 'skip').length, 1);
  assert.ok(!h.events.includes('playing:false'));
});

test('A late stream recovery result cannot replace a newly selected track', async () => {
  let release;
  const h = harness(() => new Promise((resolve) => (release = resolve)));
  h.trigger();
  await Promise.resolve();
  h.context.streamRequestIdRef.current = 2;
  h.context.currentTrackRef.current = { id: 'another' };
  release('https://rr2.googlevideo.com/videoplayback?itag=140');
  await h.flush();
  assert.equal(h.loads.length, 0);
  assert.ok(!h.events.includes('skip'));
});

test('A late verification failure from the previous track cannot pause the new track', async () => {
  let reject;
  const h = harness(() => new Promise((_resolve, r) => (reject = r)));
  h.trigger();
  await Promise.resolve();
  h.context.streamRequestIdRef.current = 2;
  h.context.currentTrackRef.current = { id: 'another' };
  reject(new Error(access.YOUTUBE_AUDIO_BOT_CHECK));
  await h.flush();
  assert.ok(!h.events.includes('pause'));
  assert.ok(!h.events.includes('playing:false'));
  assert.ok(!h.events.includes('skip'));
});

// Stale initial seeks are exercised through the complete hook in playbackLifecycle.test.mjs.
test('HLS failure before a media src exists still recovers the same track at the captured position', async () => {
  const h = harness(async () => 'https://rr2.googlevideo.com/videoplayback?itag=140');
  h.audio.src = '';
  h.audio.currentSrc = '';
  h.audio.currentTime = 0;
  h.audio.error = null;
  h.trigger(true, 42);
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.loads[0].seek, 42);
});
test('An ordinary empty-src media event is ignored after deliberate teardown', async () => {
  const h = harness(async () => 'https://rr2.googlevideo.com/videoplayback?itag=140');
  h.audio.src = '';
  h.audio.currentSrc = '';
  h.trigger(new Event('error'));
  await h.flush();
  assert.equal(h.requests.length, 0);
});

test('SoundCloud startup renews the same recording in another rendition, then holds the queue on timeout', async () => {
  const h = harness(
    async () => 'https://playback.media-streaming.soundcloud.cloud/audio/playlist.m3u8',
  );
  h.context.currentTrackRef.current.source = 'soundcloud';
  h.context.currentTrackRef.current.id = '2381180949';
  h.audio.src = h.audio.currentSrc = 'blob:fixture-hls';
  // A destroyed HLS MediaSource is still a blob URL; it is not an offline cached file.
  h.trigger(true, 42, 'timeout');
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].track.id, '2381180949');
  assert.equal(h.requests[0].options.preferAlternateFormat, true);
  h.audio.src = h.audio.currentSrc = 'blob:fixture-hls-refreshed';
  h.trigger(true, 42, 'timeout');
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.ok(h.events.includes('temporary:timeout'));
  assert.ok(!h.events.includes('skip'));
});
