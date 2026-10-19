import { BoundedMap, BoundedSet } from '../src/shared/utils/boundedCache.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime } from './helpers/hookRuntime.mjs';
import * as urls from '../src/shared/utils/audioUrlValidator.ts';
import * as volume from '../src/shared/utils/audioVolume.ts';
import * as buffering from '../src/shared/utils/audioBuffer.ts';
import * as listening from '../src/shared/utils/listeningTime.ts';
import * as recovery from '../src/shared/utils/playbackRecovery.ts';
import * as fade from '../src/shared/utils/crossfade.ts';
import * as shuffle from '../src/shared/utils/shuffleCycle.ts';
import * as queueEntries from '../src/shared/utils/queueEntry.ts';
import { AudioProgressWatchdog } from '../src/shared/utils/audioProgressWatchdog.ts';
import * as queueOrder from '../src/shared/utils/playbackQueueOrder.ts';
import * as playbackIntent from '../src/shared/utils/playbackIntent.ts';
import * as networkFailures from '../src/shared/utils/streamResolveError.ts';
import * as access from '../src/shared/utils/youtubeAudioAccessError.ts';
import * as tastePolicy from '../src/shared/utils/tastePolicy.ts';
import { HlsRecoveryBudget } from '../src/shared/utils/hlsRecovery.ts';

import { AudioCacheService } from '../src/shared/services/audioCacheService.ts';
import { SharedStreamResolver } from '../src/desktop/main/services/sharedStreamResolver.ts';
import { currentStreamResolveSignal } from '../src/desktop/main/services/streamResolveContext.ts';
import { platformBridge } from '../src/shared/bridge/platformBridge.ts';
import { AudioCrossfade } from '../src/shared/services/audioCrossfade.ts';
import { TrackVolumeNormalization } from '../src/shared/services/trackVolumeNormalization.ts';
import { StreamResolveTimeoutError } from '../src/shared/utils/streamResolveDeadline.ts';

const noop = () => {};
const ref = (current) => ({ current });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const track = (id) => ({
  id: 'yt_' + id,
  title: id,
  duration: 120,
  source: 'youtube',
  artist: { name: 'Fixture' },
  album: {},
});
class FixtureAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 120;
  readyState = 0;
  paused = true;
  ended = false;
  error = null;
  seeking = false;
  playbackRate = 1;
  volume = 0.8;
  muted = false;
  plays = 0;
  buffered = { length: 0 };
  get currentSrc() {
    return this.src;
  }
  play() {
    this.plays++;
    return this.playResult?.() ?? Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  getAttribute(key) {
    return key === 'src' ? this.src : null;
  }
  removeAttribute(key) {
    if (key === 'src') this.src = '';
  }
}
function fixture({
  resolve = async () => 'https://rr1.googlevideo.com/videoplayback?itag=140',
  queue = [track('one'), track('two')],
  shuffled = false,
  initialPlayback = null,
  native = false,
  realCrossfade = false,
  realDeadline = false,
  cacheService = null,
  offline = {},
  now = () => performance.now(),
} = {}) {
  const nativeLoads = [],
    nativePlans = [],
    statistics = [];
  let nativeListener;
  const transport = {
    addListener: async (_, listener) => {
      nativeListener = listener;
      return { remove: async () => {} };
    },
    loadAudio: async (options) => {
      nativeLoads.push(options);
    },
    setPlaybackQueue: async (options) => {
      nativePlans.push(options);
      return { handled: true };
    },
    controlAudio: async () => ({ handled: true }),
    storeAudioChunk: async () => ({ url: 'file:///test.audio' }),
  };
  const audio = new FixtureAudio(),
    bridgeCalls = [],
    toasts = [],
    history = [],
    background = [];
  const audioPool = [audio];
  let createdAudio = 0;
  const normalization = new TrackVolumeNormalization({ getItem: () => 'true', setItem: noop });
  const props = {
    initialPlayback,
    queue,
    queueIndex: initialPlayback?.queueIndex ?? 0,
    queueRef: ref(queue),
    queueIndexRef: ref(initialPlayback?.queueIndex ?? 0),
    setQueue(value) {
      props.queueRef.current = typeof value === 'function' ? value(props.queueRef.current) : value;
    },
    setQueueIndex(value) {
      props.queueIndexRef.current = value;
    },
    repeatModeRef: ref('none'),
    isShuffleRef: ref(shuffled),
    shuffleCycleRef: ref(new shuffle.ShuffleCycle()),
    isWaveActive: false,
    setIsWaveActive: noop,
    isWaveActiveRef: ref(false),
    isWaveStartingRef: ref(false),
    stopWave: noop,
    waveMoodRef: ref('flow'),
    fetchMoreWaveTracks: async () => {},
    recordWavePlayback: noop,
    observeWavePlayback: noop,
    volumeRef: ref(0.8),
    isMutedRef: ref(false),
    crossfadeDurationRef: ref(0),
    isCrossfadingRef: ref(false),
    isScrobblingRef: ref(false),
    fadeIn: noop,
    fadeOut: noop,
    cancelFade: noop,
    shouldStopOnTrackEnd: () => false,
    sleepTimerModeRef: ref('off'),
    stopSnippetRef: ref(noop),
    isSnippetPlayingRef: ref(false),
    refreshCachedTracks: async () => {},
    audioRef: ref(null),
    playTrackRef: ref(null),
  };
  const bindings = {
    '../utils/playbackIntent.ts': playbackIntent,
    '../utils/playbackQueueOrder': queueOrder,
    '../utils/tastePolicy': tastePolicy,
    '../utils/boundedCache': { BoundedMap, BoundedSet },
    './shuffleCycle.ts': shuffle,
    './queueEntry.ts': queueEntries,
    '../utils/queueEntry': queueEntries,
    '../utils/audioProgressWatchdog': { AudioProgressWatchdog },
    '../services/playerStreamResolution': {
      source: new URL('../src/shared/services/playerStreamResolution.ts', import.meta.url),
    },
    '../utils/playerQueueSelection': {
      source: new URL('../src/shared/utils/playerQueueSelection.ts', import.meta.url),
    },
    '../services/playerCachedSource': {
      source: new URL('../src/shared/services/playerCachedSource.ts', import.meta.url),
    },
    './usePlaybackTaskScope': {
      source: new URL('../src/shared/hooks/usePlaybackTaskScope.ts', import.meta.url),
    },
    './useYouTubeAvailability': { useYouTubeAvailability: () => false },
    '../services/youtubeAvailability': {
      isYouTubePlaybackDisabled: () => false,
      isYouTubeItemDisabled: () => false,
      availableQueueIndex: (q, i) => (i >= 0 && i < q.length ? i : -1),
    },
    '../utils/cachedAudioFailure': { isCachedAudioDecodeError: () => false },
    '../utils/streamResolveError': networkFailures,
    '../utils/streamResolveDeadline': realDeadline
      ? { source: new URL('../src/shared/utils/streamResolveDeadline.ts', import.meta.url) }
      : { StreamResolveTimeoutError, withStreamResolveDeadline: (promise) => promise },
    'hls.js': {
      default: class {
        static isSupported() {
          return false;
        }
      },
    },
    '../utils/hlsRecovery': { HlsRecoveryBudget },
    '../utils/audioStartup': {
      source: new URL('../src/shared/utils/audioStartup.ts', import.meta.url),
    },
    '../services/audioCrossfade': {
      AudioCrossfade: realCrossfade
        ? AudioCrossfade
        : class {
            stop() {}
            owns() {
              return false;
            }
            start() {
              return false;
            }
          },
    },
    '../services/trackVolumeNormalization': {
      trackVolumeNormalization: () =>
        realCrossfade ? normalization : { prepare: noop, release: noop },
    },
    '../services/createPlayerAudio': {
      preparePlayerAudio: (target, track) => {
        if (realCrossfade) normalization.prepare(target, track);
      },
      releasePlayerAudio: (target) => {
        if (realCrossfade) normalization.release(target);
      },
      createPlayerAudio: () => {
        if (!realCrossfade) return audio;
        const current = createdAudio++ === 0 ? audio : new FixtureAudio();
        if (!audioPool.includes(current)) audioPool.push(current);
        current.playResult = () => {
          current.paused = false;
          current.readyState = 4;
          current.dispatchEvent(new Event('play'));
          current.startEventVolume = current.volume;
          current.dispatchEvent(new Event('playing'));
          return Promise.resolve();
        };
        return current;
      },
    },
    '../utils/formatters': { detectTrackSource: (t) => t.source, resolveTrackCover: () => '' },
    '../utils/youtubeAccessHint': { emitYouTubeAccessIssue: () => false },
    '../utils/youtubeAudioAccessError': access,
    '../bridge/platformBridge': {
      platformBridge: {
        getNativePlaybackClient: () => 'A'.repeat(32),
        recordPlaybackSession: async (data) => {
          statistics.push(data);
        },
        getFullStreamUrl(t, options, signal) {
          bridgeCalls.push(t.id);
          return resolve(t, options, signal);
        },
        addListeningHistory: async (data) => {
          history.push(data);
        },
      },
    },
    '../services/audioCacheService': {
      AudioCacheService,
      audioCacheService: cacheService || {
        clear: noop,
        setPlaybackActive: noop,
        getCachedBlobUrl: () => null,
        setPinnedUrl: noop,
        prefetchTrack: (t) => background.push(['prefetch', t.id]),
        setPlaybackBuffering: (b) => background.push(['buffering', b]),
        getOrFetchBlobUrl: async (id) => {
          background.push(['blob', id]);
          return null;
        },
      },
    },
    '../services/offlineCacheService': {
      offlineCacheService: {
        getCachedTrackUrl: async () => null,
        releaseUnusedTrackUrls: noop,
        ownsBlobUrl: () => false,
        ...offline,
      },
    },
    '../context/ToastContext': { emitToast: (message) => toasts.push(message) },
    '../utils/logger': { logger: { debug: noop, warn: noop } },
    '../services/playbackLogger': { PlaybackLogger: { info: noop, warn: noop, error: noop } },
    '../utils/audioUrlValidator': urls,
    '../utils/crossfade': fade,
    '../utils/playbackRecovery': recovery,
    '../context/audioTypes': { DEFAULT_TRACK_DURATION: 180, STREAM_URL_MAX_AGE_MS: 300000 },
    '../utils/audioVolume': volume,
    '../utils/audioBuffer': buffering,
    '../utils/listeningTime': listening,
    '../utils/shuffleCycle': shuffle,
  };
  Object.defineProperty(bindings, '../utils/streamResolveDeadline.ts', {
    get: () => bindings['../utils/streamResolveDeadline'],
    set: (value) => {
      bindings['../utils/streamResolveDeadline'] = value;
    },
  });
  const connectivity = { onLine: true },
    window = new EventTarget();
  const h = hookRuntime(
    new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
    bindings,
    { window, navigator: connectivity, performance: { now }, AbortSignal },
  );
  h.render(props);
  return {
    h,
    audio,
    audioPool,
    props,
    window,
    connectivity,
    background,
    toasts,
    bridgeCalls,
    bindings,
    history,
    nativeLoads,
    nativePlans,
    statistics,
    nativeEmit(event, state = {}) {
      nativeListener({
        audioId: audio.audioId,
        version: nativeLoads.at(-1)?.version ?? 1,
        event,
        position: 0,
        duration: 120,
        buffered: 50,
        playing: event === 'playing',
        prepared: true,
        ...state,
      });
    },
  };
}

test('A pending final track cannot restart an exhausted ordered or shuffled queue', async () => {
  for (const shuffled of [false, true]) {
    const result = deferred(),
      f = fixture({ queue: [track('last')], shuffled, resolve: () => result.promise });
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    await f.h.api().nextTrack();
    result.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
    await f.h.flush();
    assert.equal(f.audio.plays, 0, 'exhausted queue must not play a late source');
    assert.equal(f.h.api().isLoadingTrack, false);
    f.h.unmount();
  }
});

test('Unmount prevents late stream results and cancels pending recovery timers', async () => {
  const result = deferred(),
    f = fixture({ resolve: () => result.promise });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.h.unmount();
  result.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.audio.plays, 0);
  assert.equal(f.h.lateUpdates(), 0);
  const failed = fixture({ resolve: async () => null });
  await failed.h.api().playTrack(failed.props.queueRef.current[0]);
  await failed.h.flush();
  assert.equal(failed.h.timers(), 1);
  failed.h.unmount();
  assert.equal(failed.h.timers(), 0);
});

test('A late play rejection cannot mark a newer playing track as paused', async () => {
  const f = fixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  f.audio.paused = true;
  f.h.api().setIsPlaying(false);
  await f.h.flush();
  const previous = deferred();
  f.audio.playResult = () => previous.promise;
  f.h.api().togglePlay();
  f.audio.playResult = () => Promise.resolve();
  await f.h.api().playTrack(f.props.queueRef.current[1]);
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, true);
  previous.reject(new Error('previous play request aborted'));
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, true);
  f.h.unmount();
});

test('Explicit resume reports playback only after success and handles sync/async failures', async () => {
  const f = fixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.h.api().pauseMainAudio();
  await f.h.flush();
  const start = deferred();
  f.audio.playResult = () => start.promise;
  f.h.api().resumeMainAudio();
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, false);
  start.reject(new Error('media start denied'));
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, false);
  f.audio.playResult = () => {
    throw new Error('adapter unavailable');
  };
  assert.doesNotThrow(() => f.h.api().resumeMainAudio());
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, false);
  f.audio.playResult = () => Promise.resolve();
  f.h.api().resumeMainAudio();
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, true);
  f.h.unmount();
});

test('Pause wins over pending media start and over pending stream resolution; resume can resolve again', async () => {
  const media = deferred(),
    f = fixture();
  f.audio.playResult = () => media.promise;
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.h.api().pauseMainAudio();
  media.resolve();
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, false);
  f.h.unmount();
  const response = deferred();
  let requests = 0;
  const pending = fixture({
    resolve: () =>
      ++requests === 1
        ? response.promise
        : Promise.resolve('https://rr1.googlevideo.com/videoplayback?itag=140'),
  });
  await pending.h.api().playTrack(pending.props.queueRef.current[0]);
  await pending.h.flush();
  pending.h.api().pauseMainAudio();
  response.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
  await pending.h.flush();
  assert.equal(pending.audio.plays, 0);
  assert.equal(pending.h.api().isPlaying, false);
  pending.h.api().resumeMainAudio();
  await pending.h.flush();
  assert.equal(requests, 2);
  assert.equal(pending.h.api().isPlaying, true);
  pending.h.unmount();
});

test('Recovery owns one timer and a new selection cancels it before it can skip', async () => {
  const f = fixture({
    resolve: async (t) =>
      t.id.endsWith('one') ? null : 'https://rr1.googlevideo.com/videoplayback?itag=140',
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  assert.equal(f.h.timers(), 1);
  await f.h.api().playTrack(f.props.queueRef.current[1]);
  await f.h.flush();
  assert.equal(f.h.timers(), 0);
  f.h.fireTimers(300);
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, 'yt_two');
  assert.equal(f.audio.plays, 1);
  f.h.unmount();
});

test('Pausing for a preview preserves its newly allocated request but invalidates the old media start', async () => {
  const old = deferred(),
    f = fixture();
  f.audio.playResult = () => old.promise;
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  const previewId = ++f.h.api().streamRequestIdRef.current;
  f.h.api().pauseMainAudio(false);
  assert.equal(f.h.api().streamRequestIdRef.current, previewId);
  old.resolve();
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, false);
  f.h.unmount();
});

test('A current unavailable source still advances once, and explicit pause cancels that recovery', async () => {
  for (const pause of [false, true]) {
    const f = fixture({
      resolve: async (t) =>
        t.id.endsWith('one') ? null : 'https://rr1.googlevideo.com/videoplayback?itag=140',
    });
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    if (pause) f.h.api().pauseMainAudio();
    f.h.fireTimers(300);
    await f.h.flush();
    assert.equal(f.h.api().currentTrack.id, pause ? 'yt_one' : 'yt_two');
    assert.equal(f.h.timers(), 0);
    f.h.unmount();
  }
});

test('Rapid switching ignores one hundred out-of-order provider replies and failures', async () => {
  const replies = new Map(),
    queue = Array.from({ length: 100 }, (_, i) => track('rapid' + i));
  const f = fixture({
    queue,
    resolve: (t) => {
      const response = deferred();
      replies.set(t.id, response);
      return response.promise;
    },
  });
  for (const t of queue) {
    await f.h.api().playTrack(t);
    f.h.render();
  }
  assert.equal(replies.size, 100);
  for (let i = 98; i >= 0; i--) {
    if (i % 2) replies.get(queue[i].id).reject(new Error('obsolete connection failed'));
    else
      replies
        .get(queue[i].id)
        .resolve('https://rr1.googlevideo.com/videoplayback?itag=140&old=' + i);
  }
  replies
    .get(queue[99].id)
    .resolve('https://rr1.googlevideo.com/videoplayback?itag=140&current=99');
  await f.h.flush();
  assert.equal(f.audio.plays, 1);
  assert.equal(f.h.api().currentTrack.id, queue[99].id);
  assert.ok(f.audio.src.endsWith('current=99'));
  assert.equal(f.h.api().resolvedStreamCache.current.size, 1);
  assert.equal(f.h.timers(), 0);
  assert.deepEqual(f.toasts, []);
  f.h.unmount();
});

test('Resuming an exhausted pending final track never plays the previous track source', async () => {
  const final = deferred();
  let calls = 0;
  const f = fixture({
    resolve: (t) =>
      t.id.endsWith('two') && ++calls === 1
        ? final.promise
        : Promise.resolve('https://rr1.googlevideo.com/videoplayback?itag=140&track=' + t.id),
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  await f.h.api().playTrack(f.props.queueRef.current[1]);
  await f.h.flush();
  await f.h.api().nextTrack();
  f.h.api().resumeMainAudio();
  await f.h.flush();
  assert.equal(calls, 2);
  assert.ok(f.audio.src.endsWith('yt_two'));
  final.resolve('https://rr1.googlevideo.com/videoplayback?itag=140&stale=true');
  await f.h.flush();
  assert.ok(f.audio.src.endsWith('yt_two'));
  f.h.unmount();
});

test('A delayed wave refill cannot resume playback after an explicit pause', async () => {
  const f = fixture({ queue: [track('one')] });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  const refill = deferred();
  f.props.isWaveActiveRef.current = true;
  f.props.fetchMoreWaveTracks = () => refill.promise;
  f.h.render();
  const next = f.h.api().nextTrack();
  f.h.api().pauseMainAudio();
  f.props.queueRef.current.push(track('two'));
  refill.resolve();
  await next;
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, 'yt_one');
  assert.equal(f.audio.plays, 1);
  assert.equal(f.h.api().isPlaying, false);
  assert.equal(f.h.api().isLoadingTrack, false);
  f.h.unmount();
});

test('Pausing and resuming a healthy source never records another listening start', async () => {
  const f = fixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.dispatchEvent(new Event('play'));
  await f.h.flush();
  assert.equal(f.history.length, 1);
  f.h.api().pauseMainAudio();
  f.h.api().resumeMainAudio();
  await f.h.flush();
  f.audio.paused = false;
  f.audio.dispatchEvent(new Event('play'));
  await f.h.flush();
  assert.equal(f.history.length, 1);
  f.h.unmount();
});

test('Pausing during URL recovery prevents its late stream from restarting the track', async () => {
  const response = deferred();
  let requests = 0;
  const f = fixture({
    resolve: () =>
      ++requests === 1
        ? Promise.resolve('https://rr1.googlevideo.com/videoplayback?itag=140')
        : response.promise,
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.error = { code: 4 };
  f.audio.dispatchEvent(new Event('error'));
  await f.h.flush();
  assert.equal(requests, 2);
  assert.equal(f.h.api().isLoadingTrack, true);
  f.h.api().pauseMainAudio();
  response.resolve('https://rr2.googlevideo.com/videoplayback?itag=140');
  await f.h.flush();
  assert.equal(f.audio.plays, 1);
  assert.equal(f.h.api().isPlaying, false);
  assert.equal(f.h.api().isLoadingTrack, false);
  f.h.unmount();
});

test('Restart restores a paused track and position without resolving a stream or recording listening history', async () => {
  const restored = {
    version: 1,
    track: track('one'),
    position: 47.5,
    queue: [track('one'), track('two')],
    queueIndex: 0,
    repeatMode: 'off',
    isShuffle: false,
  };
  const f = fixture({ initialPlayback: restored, queue: restored.queue });
  assert.equal(f.h.api().currentTrack.id, 'yt_one');
  assert.equal(f.h.api().currentTime, 47.5);
  assert.equal(f.h.api().duration, 120);
  assert.equal(f.h.api().isPlaying, false);
  assert.equal(f.audio.plays, 0);
  assert.equal(f.bridgeCalls.length, 0);
  assert.equal(f.history.length, 0);
  f.h.unmount();
});

test('Resume after restart resolves fresh audio and applies the saved position once metadata arrives', async () => {
  const restored = {
    version: 1,
    track: track('one'),
    position: 47.5,
    queue: [track('one'), track('two')],
    queueIndex: 0,
    repeatMode: 'off',
    isShuffle: false,
  };
  const f = fixture({ initialPlayback: restored, queue: restored.queue });
  f.h.api().resumeMainAudio();
  await f.h.flush();
  assert.equal(f.bridgeCalls[0], 'yt_one');
  assert.equal(f.h.api().currentTime, 47.5);
  assert.equal(f.audio.currentTime, 0);
  f.audio.readyState = 1;
  f.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(f.audio.currentTime, 47.5);
  assert.equal(f.h.api().getPlaybackPosition(), 47.5);
  f.audio.currentTime = 48;
  f.audio.dispatchEvent(new Event('canplay'));
  assert.equal(f.audio.currentTime, 48, 'canplay must not seek a second time');
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  assert.equal(f.h.api().currentTime, 48);
  assert.equal(f.props.queueIndexRef.current, 0);
  f.h.unmount();
});

test('Selecting a new track abandons a delayed initial seek from the restored track', async () => {
  const restored = {
    version: 1,
    track: track('one'),
    position: 47.5,
    queue: [track('one'), track('two')],
    queueIndex: 0,
    repeatMode: 'off',
    isShuffle: false,
  };
  const f = fixture({ initialPlayback: restored, queue: restored.queue });
  f.h.api().resumeMainAudio();
  await f.h.flush();
  await f.h.api().playTrack(track('two'));
  await f.h.flush();
  f.audio.readyState = 1;
  f.audio.dispatchEvent(new Event('loadedmetadata'));
  f.audio.dispatchEvent(new Event('canplay'));
  assert.equal(f.audio.currentTime, 0);
  assert.equal(f.h.api().currentTrack.id, 'yt_two');
  assert.equal(f.h.api().getPlaybackPosition(), 0);
  f.h.unmount();
});

test('Resuming a repeated track preserves the saved queue occurrence rather than jumping to its first copy', async () => {
  const queue = [track('one'), track('two'), track('one')];
  const restored = {
    version: 1,
    track: queue[2],
    position: 47.5,
    queue,
    queueIndex: 2,
    repeatMode: 'off',
    isShuffle: false,
  };
  const f = fixture({ initialPlayback: restored, queue });
  f.h.api().resumeMainAudio();
  await f.h.flush();
  assert.equal(f.props.queueIndexRef.current, 2);
  assert.equal(f.h.api().currentTime, 47.5);
  f.h.unmount();
});

test('Selecting a pending track detaches the previous source before resume can play it', async () => {
  const pending = deferred();
  const f = fixture({
    resolve: (t) =>
      t.id.endsWith('two')
        ? pending.promise
        : Promise.resolve('https://rr1.googlevideo.com/videoplayback?track=one'),
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  const starts = f.audio.plays;
  await f.h.api().playTrack(f.props.queueRef.current[1]);
  await f.h.flush();
  assert.equal(f.audio.src, '', 'The old resource is released during URL lookup');
  assert.equal(f.h.api().isPlaying, false);
  assert.equal(f.h.api().isLoadingTrack, true);
  f.h.api().resumeMainAudio();
  await f.h.flush();
  assert.equal(
    f.audio.plays,
    starts,
    'Resume waits for the selected track instead of playing the old source',
  );
  pending.resolve('https://rr1.googlevideo.com/videoplayback?track=two');
  await f.h.flush();
  assert.ok(f.audio.src.endsWith('track=two'));
  assert.equal(f.audio.plays, starts + 1);
  f.h.unmount();
});

test('An old playing event during resolution cannot clear loading or add listening history for the new track', async () => {
  const pending = deferred();
  const f = fixture({
    resolve: (t) =>
      t.id.endsWith('two')
        ? pending.promise
        : Promise.resolve('https://rr1.googlevideo.com/videoplayback?track=one'),
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  await f.h.api().playTrack(f.props.queueRef.current[1]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.dispatchEvent(new Event('play'));
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  assert.equal(f.h.api().isLoadingTrack, true);
  assert.equal(f.history.length, 0);
  pending.resolve('https://rr1.googlevideo.com/videoplayback?track=two');
  await f.h.flush();
  f.h.unmount();
});

test('SoundCloud startup waits for playback before bulk caching and cancels that work on a stall', async () => {
  const queue = [
    { ...track('one'), id: 'sc_1', source: 'soundcloud' },
    { ...track('two'), id: 'sc_2', source: 'soundcloud' },
  ];
  const f = fixture({ queue, resolve: async () => 'https://cf-media.sndcdn.com/fixture.mp3' });
  await f.h.api().playTrack(queue[0]);
  await f.h.flush();
  assert.deepEqual(
    f.background,
    [['buffering', true]],
    'Initial source resolution and play must not start background transfers',
  );
  f.audio.paused = false;
  f.audio.readyState = 4;
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  assert.equal(f.background.filter((item) => item[0] === 'blob').length, 0);
  f.audio.buffered = { length: 1, start: () => 0, end: () => 40 };
  f.audio.currentTime = 2;
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  assert.equal(f.background.filter((item) => item[0] === 'blob').length, 0);
  assert.deepEqual(
    f.background.find((item) => item[0] === 'prefetch'),
    ['prefetch', 'sc_2'],
  );
  f.audio.currentTime = 11;
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  assert.equal(f.background.filter((item) => item[0] === 'blob').length, 1);
  assert.equal(f.background.filter((item) => item[0] === 'prefetch').length, 1);
  assert.deepEqual(
    f.background.find((item) => item[0] === 'prefetch'),
    ['prefetch', 'sc_2'],
  );
  f.audio.dispatchEvent(new Event('waiting'));
  await f.h.flush();
  assert.deepEqual(f.background.at(-1), ['buffering', true]);
  f.h.unmount();
});

test('Whole player uses real overlap ownership until the new audio finishes its fade', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const f = fixture({ realCrossfade: true });
  f.props.crossfadeDurationRef.current = 4;
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.volume = 0.8;
  f.audio.currentTime = 116;
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  const incoming = f.props.audioRef.current;
  assert.notEqual(incoming, f.audio);
  assert.equal(f.audio.paused, false);
  assert.equal(f.props.isCrossfadingRef.current, true);
  now = 2000;
  t.mock.timers.tick(25);
  assert.ok(incoming.volume > 0 && incoming.volume < 0.8);
  incoming.readyState = 2;
  incoming.dispatchEvent(new Event('waiting'));
  now = 5000;
  t.mock.timers.tick(25);
  assert.equal(f.props.isCrossfadingRef.current, true);
  assert.equal(f.audio.paused, false);
  incoming.readyState = 4;
  incoming.dispatchEvent(new Event('playing'));
  now = 7000;
  t.mock.timers.tick(25);
  assert.equal(f.props.isCrossfadingRef.current, false);
  assert.equal(f.audio.paused, true);
  assert.equal(incoming.volume, 0.8);
  f.h.unmount();
});

test('Listening checkpoints are bounded during playback and pause still saves the latest seconds', async (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const f = fixture();
  f.props.isScrobblingRef.current = true;
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.readyState = 4;
  f.audio.dispatchEvent(new Event('playing'));
  for (let second = 1; second <= 46; second++) {
    now = second * 1000;
    f.audio.currentTime = second;
    f.audio.dispatchEvent(new Event('timeupdate'));
  }
  await f.h.flush();
  assert.equal(f.statistics.length, 3);
  assert.equal(f.statistics.at(-1).playedSeconds, 45);
  f.audio.paused = true;
  f.audio.dispatchEvent(new Event('pause'));
  await f.h.flush();
  assert.equal(f.statistics.at(-1).playedSeconds, 46);
  f.h.unmount();
});

test('A fresh fade-in does not briefly expose full volume in the play event before the play promise settles', async () => {
  const f = fixture({ realCrossfade: true });
  f.props.crossfadeDurationRef.current = 4;
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  assert.equal(f.audio.startEventVolume, 0);
  f.h.unmount();
});

test('Offline uncached selection holds every queue/mood without skipping or polling, and resumes the same track online', async () => {
  for (const wave of [false, true]) {
    const f = fixture();
    f.connectivity.onLine = false;
    f.props.isWaveActiveRef.current = wave;
    await f.h.api().playTrack(f.props.queueRef.current[0], undefined, wave, 37);
    await f.h.flush();
    assert.equal(f.h.api().currentTrack.id, 'yt_one');
    assert.equal(f.bridgeCalls.length, 0);
    assert.equal(f.h.api().isLoadingTrack, false);
    assert.equal(f.h.api().playbackIssue.kind, 'network');
    assert.equal(f.h.api().getPlaybackPosition(), 37);
    assert.equal(f.h.timers(), 0);
    f.h.fireTimers(300);
    await f.h.flush();
    assert.equal(f.h.api().currentTrack.id, 'yt_one');
    f.connectivity.onLine = true;
    f.window.dispatchEvent(new Event('online'));
    await f.h.flush();
    assert.deepEqual(f.bridgeCalls, ['yt_one']);
    assert.equal(f.audio.plays, 1);
    f.audio.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(f.audio.currentTime, 37);
    f.audio.paused = false;
    f.audio.dispatchEvent(new Event('playing'));
    await f.h.flush();
    assert.equal(f.h.api().playbackIssue, null);
    f.h.unmount();
  }
});

test('Offline saved and in-memory audio still play without any provider request', async () => {
  for (const storage of ['saved', 'memory']) {
    const f = fixture();
    f.connectivity.onLine = false;
    if (storage === 'saved')
      Object.assign(f.bindings['../services/offlineCacheService'].offlineCacheService, {
        getCachedTrackUrl: async () => 'blob:offline',
        getCachedCoverUrl: async () => null,
      });
    else
      f.bindings['../services/audioCacheService'].audioCacheService.getCachedBlobUrl = () =>
        'blob:memory';
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    assert.equal(f.audio.src, 'blob:' + (storage === 'saved' ? 'offline' : 'memory'));
    assert.equal(f.audio.plays, 1);
    assert.equal(f.bridgeCalls.length, 0);
    assert.equal(f.h.api().playbackIssue, null);
    f.h.unmount();
  }
});

test('A real network event does not interrupt a healthy buffered/local recording', async () => {
  const f = fixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  const src = f.audio.src,
    plays = f.audio.plays;
  f.audio.paused = false;
  f.audio.currentTime = 22;
  f.connectivity.onLine = false;
  f.window.dispatchEvent(new Event('offline'));
  await f.h.flush();
  assert.equal(f.audio.src, src);
  assert.equal(f.audio.paused, false);
  assert.equal(f.audio.plays, plays);
  assert.equal(f.h.api().playbackIssue, null);
  f.h.unmount();
});

test('Pause, new selection and unmount each cancel waiting for internet', async () => {
  for (const action of ['pause', 'selection', 'unmount']) {
    const f = fixture();
    f.connectivity.onLine = false;
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    if (action === 'pause') {
      f.h.api().pauseMainAudio();
      await f.h.flush();
      assert.equal(f.h.api().playbackIssue.autoResume, false);
    }
    if (action === 'selection') {
      await f.h.api().playTrack(f.props.queueRef.current[1]);
      await f.h.flush();
    }
    if (action === 'unmount') f.h.unmount();
    f.connectivity.onLine = true;
    f.window.dispatchEvent(new Event('online'));
    if (action !== 'unmount') await f.h.flush();
    else await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.bridgeCalls, action === 'selection' ? ['yt_two'] : []);
    assert.equal(f.h.lateUpdates(), 0);
    if (action !== 'unmount') f.h.unmount();
  }
});

test('Temporary failures survive serialized IPC and have two bounded retries without queue drain or feedback', async () => {
  for (const kind of ['network', 'timeout', 'provider', 'rate-limit']) {
    const f = fixture({
      resolve: async () => {
        throw new Error(
          'Error invoking remote method: ' + networkFailures.createStreamResolveError(kind).message,
        );
      },
    });
    f.props.isWaveActiveRef.current = true;
    let feedback = 0;
    f.props.recordWavePlayback = () => feedback++;
    await f.h.api().playTrack(f.props.queueRef.current[0], undefined, true, 41);
    await f.h.flush();
    assert.equal(f.h.api().playbackIssue.kind, kind);
    assert.equal(f.h.api().getPlaybackPosition(), 41);
    for (const delay of kind === 'rate-limit' ? [10000, 30000] : [2000, 5000]) {
      f.h.fireTimers(delay);
      await f.h.flush();
    }
    assert.equal(f.bridgeCalls.length, 3);
    assert.equal(f.h.timers(), 0);
    assert.equal(f.h.api().currentTrack.id, 'yt_one');
    assert.equal(feedback, 0);
    assert.equal(f.audio.plays, 0);
    f.window.dispatchEvent(new Event('online'));
    await f.h.flush();
    assert.equal(f.bridgeCalls.length, 3);
    f.h.unmount();
  }
});

test('Explicit pause cancels a temporary retry and manual resume starts a fresh bounded attempt', async () => {
  let fail = true;
  const f = fixture({
    resolve: async () => {
      if (fail) throw networkFailures.createStreamResolveError('network');
      return 'https://rr1.googlevideo.com/videoplayback?itag=140';
    },
  });
  await f.h.api().playTrack(f.props.queueRef.current[0], undefined, false, 15);
  await f.h.flush();
  f.h.api().pauseMainAudio();
  await f.h.flush();
  assert.equal(f.h.timers(), 0);
  f.h.fireTimers(2000);
  f.window.dispatchEvent(new Event('online'));
  await f.h.flush();
  assert.equal(f.bridgeCalls.length, 1);
  fail = false;
  f.h.api().resumeMainAudio();
  await f.h.flush();
  assert.equal(f.bridgeCalls.length, 2);
  f.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(f.audio.currentTime, 15);
  assert.equal(f.h.api().isPlaying, true);
  f.h.unmount();
});

test('Playback interrupted offline preserves position and discards no healthy cached audio', async () => {
  const f = fixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.currentTime = 63;
  f.audio.paused = false;
  f.connectivity.onLine = false;
  f.audio.error = { code: 2, message: 'network' };
  f.audio.dispatchEvent(new Event('error'));
  await f.h.flush();
  assert.equal(f.h.api().getPlaybackPosition(), 63);
  assert.equal(f.bridgeCalls.length, 1);
  assert.equal(f.h.api().currentTrack.id, 'yt_one');
  assert.equal(f.h.timers(), 0);
  f.audio.error = null;
  f.connectivity.onLine = true;
  f.window.dispatchEvent(new Event('online'));
  await f.h.flush();
  f.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(f.audio.currentTime, 63);
  assert.equal(f.bridgeCalls.length, 2);
  f.h.unmount();
});

test('Queued old DOM error without MediaError cannot recover or skip the current recording', async () => {
  const f = fixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  await f.h.api().playTrack(f.props.queueRef.current[1]);
  await f.h.flush();
  f.audio.error = null;
  f.audio.dispatchEvent(new Event('error'));
  await f.h.flush();
  assert.equal(f.bridgeCalls.length, 2);
  assert.equal(f.audio.plays, 2);
  assert.equal(f.h.api().currentTrack.id, 'yt_two');
  f.h.unmount();
});

test('Repeated current media errors share one bounded resolution and pause defeats its late response', async () => {
  const recovery = deferred();
  let n = 0;
  const f = fixture({
    resolve: () =>
      ++n === 1
        ? Promise.resolve('https://rr1.googlevideo.com/videoplayback?itag=140')
        : recovery.promise,
  });
  let deadlines = 0;
  f.bindings['../utils/streamResolveDeadline'].withStreamResolveDeadline = (promise) => {
    deadlines++;
    return promise;
  };
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.error = { code: 2, message: 'transport failed' };
  f.audio.dispatchEvent(new Event('error'));
  await f.h.flush();
  f.audio.dispatchEvent(new Event('error'));
  await f.h.flush();
  assert.equal(f.bridgeCalls.length, 2);
  assert.equal(deadlines, 2);
  f.h.api().pauseMainAudio();
  recovery.resolve('https://rr1.googlevideo.com/videoplayback?itag=140&late=1');
  await f.h.flush();
  assert.equal(f.audio.plays, 1);
  assert.equal(f.h.api().isPlaying, false);
  f.h.unmount();
});

test('Whole provider deadline bounds recovery too, and late results cannot replace the held recording', async () => {
  const pending = deferred();
  let n = 0;
  const f = fixture({
    realDeadline: true,
    resolve: () =>
      ++n === 1
        ? Promise.resolve('https://rr1.googlevideo.com/videoplayback?itag=140')
        : pending.promise,
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.currentTime = 52;
  f.audio.dispatchEvent(new Event('loadedmetadata'));
  f.audio.dispatchEvent(new Event('timeupdate'));
  f.audio.error = { code: 2, message: 'network' };
  f.audio.dispatchEvent(new Event('error'));
  await f.h.flush();
  f.h.fireTimers(30000);
  await f.h.flush();
  assert.equal(f.h.api().playbackIssue.kind, 'timeout');
  assert.equal(f.h.api().getPlaybackPosition(), 52);
  assert.equal(f.h.api().isLoadingTrack, false);
  pending.resolve('https://rr1.googlevideo.com/videoplayback?itag=140&late=1');
  await f.h.flush();
  assert.equal(f.audio.plays, 1);
  f.h.unmount();
  assert.equal(f.h.timers(), 0);
});

test('Pause and unmount immediately release real resolution deadlines; stale replies stay inert', async () => {
  for (const action of ['pause', 'unmount']) {
    const pending = deferred(),
      f = fixture({ realDeadline: true, resolve: () => pending.promise });
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    assert.equal(f.h.timers(), 1);
    if (action === 'pause') f.h.api().pauseMainAudio();
    else f.h.unmount();
    assert.equal(f.h.timers(), 0);
    pending.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
    if (action === 'pause') {
      await f.h.flush();
      f.h.unmount();
    } else await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.audio.plays, 0);
    assert.equal(f.h.lateUpdates(), 0);
  }
});

test('A 1,000-track wave retains bounded played history/cache and selects each successor once', async () => {
  const f = fixture({ queue: Array.from({ length: 25 }, (_, i) => track(String(i))) });
  f.props.isWaveActiveRef.current = true;
  await f.h.api().playTrack(f.props.queueRef.current[0], undefined, true);
  await f.h.flush();
  let generated = 25;
  for (let i = 1; i <= 1000; i++) {
    if (f.props.queueRef.current.length - f.props.queueIndexRef.current < 20)
      f.props.queueRef.current.push(
        ...Array.from({ length: 20 }, () => track(String(generated++))),
      );
    await f.h.api().nextTrack();
    await f.h.flush();
    assert.equal(f.h.api().currentTrack.id, 'yt_' + i);
    assert.equal(f.props.queueRef.current[f.props.queueIndexRef.current].id, 'yt_' + i);
    assert.ok(f.props.queueRef.current.length <= 100, 'played wave prefix must be released');
    assert.ok(f.h.api().resolvedStreamCache.current.size <= 128, 'old signed URLs must be bounded');
  }
  assert.ok(f.props.queueIndexRef.current >= 30);
  f.h.unmount();
  assert.equal(f.h.timers(), 0);
});
test('Wave compaction never truncates an explicitly selected playlist', async () => {
  const q = Array.from({ length: 2000 }, (_, i) => track('playlist-' + i)),
    f = fixture({ queue: q });
  await f.h.api().playTrack(q[1700]);
  await f.h.flush();
  assert.equal(f.props.queueRef.current.length, 2000);
  assert.equal(f.props.queueIndexRef.current, 1700);
  await f.h.api().nextTrack();
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, 'yt_playlist-1701');
  f.h.unmount();
});

test('Play/pause cancels a pending stream immediately instead of issuing another resolver request', async () => {
  const pending = deferred(),
    f = fixture({ resolve: () => pending.promise });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.h.api().togglePlay();
  await f.h.flush();
  assert.equal(f.bridgeCalls.length, 1);
  assert.equal(f.h.api().isLoadingTrack, false);
  pending.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
  await f.h.flush();
  assert.equal(f.audio.plays, 0);
  assert.equal(f.h.api().isPlaying, false);
  f.h.unmount();
});
test('Play/pause cancels pending wave selection without changing the currently playing track', async () => {
  const f = fixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  const previous = f.h.api().currentTrack;
  let stopped = 0;
  f.props.isWaveStartingRef.current = true;
  f.props.stopWave = () => {
    stopped++;
    f.props.isWaveStartingRef.current = false;
  };
  f.h.render(f.props);
  const plays = f.audio.plays;
  f.h.api().togglePlay();
  await f.h.flush();
  assert.equal(stopped, 1);
  assert.equal(f.h.api().currentTrack.id, previous.id);
  assert.equal(f.audio.plays, plays);
  f.h.unmount();
});

test('Early next-song preparation waits for headroom, runs once and keeps far lookahead for later', async () => {
  const queue = [track('early-first'), track('early-next'), track('later-next')],
    f = fixture({ queue });
  await f.h.api().playTrack(queue[0]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.readyState = 4;
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  f.audio.buffered = { length: 1, start: () => 0, end: () => 6 };
  f.audio.currentTime = 2;
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  assert.equal(f.background.filter((row) => row[0] === 'prefetch').length, 0);
  f.audio.buffered = { length: 1, start: () => 0, end: () => 40 };
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  assert.deepEqual(
    f.background.filter((row) => row[0] === 'prefetch'),
    [['prefetch', queue[1].id]],
  );
  f.audio.currentTime = 3;
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  assert.equal(f.background.filter((row) => row[0] === 'prefetch').length, 1);
  f.audio.currentTime = 10;
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
  assert.deepEqual(
    f.background.filter((row) => row[0] === 'prefetch'),
    [
      ['prefetch', queue[1].id],
      ['prefetch', queue[2].id],
    ],
  );
  f.h.unmount();
});

test('an empty initial answer retries the same recording once before loading or giving up', async () => {
  let attempts = 0;
  const f = fixture({
    resolve: async () =>
      ++attempts === 1 ? '' : 'https://rr1.googlevideo.com/videoplayback?itag=140',
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  assert.deepEqual(f.bridgeCalls, ['yt_one', 'yt_one']);
  assert.equal(f.audio.plays, 1);
  assert.ok(!f.toasts.some((message) => message.includes('недоступен')));
  f.h.unmount();
});

test('empty or failed provider answers cannot loop forever through a repeating queue', async () => {
  for (const throws of [false, true]) {
    const f = fixture({
      resolve: async () => {
        if (throws) throw new Error('recording unavailable');
        return '';
      },
    });
    f.props.repeatModeRef.current = 'all';
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    for (let step = 0; step < 15; step++) {
      f.h.fireTimers(300);
      await f.h.flush();
    }
    assert.ok(f.bridgeCalls.length <= 10, 'Failed queue kept issuing new source lookups');
    assert.equal(f.h.timers(), 0);
    assert.ok(f.toasts.some((message) => message.includes('несколько треков подряд')));
    assert.equal(f.h.api().isLoadingTrack, false);
    assert.equal(f.h.api().isPlaying, false);
    f.h.unmount();
  }
});

test('switching tracks while an empty lookup is pending cannot start a stale fresh retry', async () => {
  const delayed = deferred();
  const f = fixture({
    resolve: async (t) =>
      t.id === 'yt_one' ? delayed.promise : 'https://rr1.googlevideo.com/videoplayback?itag=140',
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.api().playTrack(f.props.queueRef.current[1]);
  await f.h.flush();
  delayed.resolve('');
  await f.h.flush();
  assert.deepEqual(f.bridgeCalls, ['yt_one', 'yt_two']);
  assert.equal(f.h.api().currentTrack.id, 'yt_two');
  f.h.unmount();
});

test('playback logs distinguish first start from buffer recovery and correlate source failures', async () => {
  const logs = [];
  const f = fixture();
  for (const method of ['info', 'warn', 'error'])
    f.bindings['../services/playbackLogger'].PlaybackLogger[method] = (message, meta) =>
      logs.push({ message, meta });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.readyState = 4;
  f.audio.dispatchEvent(new Event('playing'));
  f.audio.dispatchEvent(new Event('waiting'));
  f.audio.dispatchEvent(new Event('waiting'));
  f.audio.dispatchEvent(new Event('playing'));
  f.audio.dispatchEvent(new Event('playing'));
  assert.equal(logs.filter((log) => log.meta?.event === 'playback-start').length, 1);
  assert.equal(logs.filter((log) => log.message.includes('AudioPlayer:Buffering')).length, 1);
  assert.equal(logs.filter((log) => log.meta?.event === 'playback-resume').length, 2);
  assert.ok(logs.find((log) => log.meta?.event === 'playback-start').meta.requestId > 0);
  f.h.unmount();
});

test('an unavailable recording still advances an ordinary queue through the shared guard', async () => {
  const f = fixture({
    resolve: async (t) =>
      t.id === 'yt_one' ? '' : 'https://rr1.googlevideo.com/videoplayback?itag=140',
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.h.fireTimers(300);
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, 'yt_two');
  assert.equal(f.audio.plays, 1);
  assert.ok(f.toasts.some((message) => message.includes('Включаем следующий')));
  f.h.unmount();
});

async function bufferedFixture(options = {}, startIndex = 0) {
  const f = fixture(options);
  await f.h.api().playTrack(f.props.queueRef.current[startIndex]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.readyState = 4;
  f.audio.buffered = { length: 1, start: () => 0, end: () => 80 };
  f.audio.currentTime = 2;
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  return f;
}
async function prefetchTick(f, seconds = 2) {
  f.audio.currentTime = seconds;
  f.audio.dispatchEvent(new Event('timeupdate'));
  await f.h.flush();
}
const prefetched = (f) => f.background.filter((row) => row[0] === 'prefetch').map((row) => row[1]);

test('Shuffle prefetch matches actual next songs without consuming the announced order', async () => {
  const queue = ['current', 'array-neighbor', 'actual-second', 'actual-first'].map(track);
  const f = await bufferedFixture({ queue, shuffled: true });
  f.props.shuffleCycleRef.current.prioritize(
    queueEntries.queueEntryKey(f.props.queueRef.current[2]),
  );
  f.props.shuffleCycleRef.current.prioritize(
    queueEntries.queueEntryKey(f.props.queueRef.current[3]),
  );
  const cycle = f.props.shuffleCycleRef.current;
  const upcoming = cycle.upcoming.bind(cycle);
  let preparations = 0;
  cycle.upcoming = (...args) => {
    preparations++;
    return upcoming(...args);
  };
  await prefetchTick(f);
  await prefetchTick(f, 10);
  await prefetchTick(f, 11);
  assert.deepEqual(prefetched(f), [queue[3].id, queue[2].id]);
  assert.equal(preparations, 1, 'timeupdates reuse the plan until the queue changes');
  await f.h.api().nextTrack();
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, queue[3].id);
  await f.h.api().nextTrack();
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, queue[2].id);
  f.h.unmount();
});

test('Editing the upcoming queue prepares the new successor while the current song continues', async () => {
  const queue = ['current', 'next', 'later'].map(track);
  const f = await bufferedFixture({ queue });
  await prefetchTick(f);
  const inserted = track('inserted');
  f.props.setQueue([queue[0], inserted, queue[1], queue[2]]);
  await prefetchTick(f, 3);
  await prefetchTick(f, 4);
  assert.deepEqual(prefetched(f), [queue[1].id, inserted.id]);
  assert.equal(f.h.api().currentTrack.id, queue[0].id);
  assert.equal(f.audio.plays, 1);
  await f.h.api().nextTrack();
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, inserted.id);
  f.h.unmount();
});

test('Repeated queues prepare the beginning but Wave never wraps or follows shuffle', async () => {
  const queue = ['first', 'second', 'last'].map(track);
  const repeated = await bufferedFixture({ queue }, 2);
  repeated.props.repeatModeRef.current = 'all';
  await prefetchTick(repeated, 10);
  assert.deepEqual(prefetched(repeated), [queue[0].id, queue[1].id]);
  await repeated.h.api().nextTrack();
  await repeated.h.flush();
  assert.equal(repeated.h.api().currentTrack.id, queue[0].id);
  repeated.h.unmount();
  const wave = await bufferedFixture({ queue, shuffled: true });
  wave.props.isWaveActiveRef.current = true;
  wave.props.repeatModeRef.current = 'all';
  wave.props.shuffleCycleRef.current.prioritize(queue[2].id);
  await prefetchTick(wave, 10);
  assert.deepEqual(prefetched(wave), [queue[1].id, queue[2].id]);
  wave.props.queueIndexRef.current = 2;
  wave.background.length = 0;
  await prefetchTick(wave, 11);
  assert.deepEqual(prefetched(wave), []);
  wave.h.unmount();
});

test('Repeat-one and sleep-at-end avoid speculative next-song requests and resume when disabled', async () => {
  for (const mode of ['repeat', 'sleep']) {
    const f = await bufferedFixture();
    if (mode === 'repeat') f.props.repeatModeRef.current = 'one';
    else f.props.sleepTimerModeRef.current = 'end_of_track';
    await prefetchTick(f, 10);
    assert.deepEqual(prefetched(f), []);
    f.props.repeatModeRef.current = 'off';
    f.props.sleepTimerModeRef.current = 'off';
    await prefetchTick(f, 11);
    assert.deepEqual(prefetched(f), [f.props.queueRef.current[1].id]);
    f.h.unmount();
  }
});

test('Prefetch skips unavailable items and restarts its target after buffering cancels downloads', async () => {
  const queue = ['current', 'disabled', 'playable-next', 'playable-second'].map(track);
  const f = await bufferedFixture({ queue });
  f.bindings['../services/youtubeAvailability'].isYouTubeItemDisabled = (t) =>
    t?.id === queue[1].id;
  f.bindings['../services/youtubeAvailability'].availableQueueIndex = (q, i) => {
    while (i < q.length && q[i].id === queue[1].id) i++;
    return i < q.length ? i : -1;
  };
  await prefetchTick(f, 10);
  assert.deepEqual(prefetched(f), [queue[2].id, queue[3].id]);
  f.audio.dispatchEvent(new Event('waiting'));
  await f.h.flush();
  f.audio.buffered = { length: 1, start: () => 0, end: () => 12 };
  await prefetchTick(f, 11);
  assert.equal(prefetched(f).length, 2);
  f.audio.buffered = { length: 1, start: () => 0, end: () => 80 };
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  await prefetchTick(f, 12);
  assert.deepEqual(prefetched(f), [queue[2].id, queue[3].id, queue[2].id, queue[3].id]);
  await f.h.api().nextTrack();
  await f.h.flush();
  assert.equal(f.h.api().currentTrack.id, queue[2].id);
  f.h.unmount();
});

test('Availability changes invalidate cached next targets without restarting the current stream', async () => {
  const queue = ['current', 'youtube-next', 'fallback', 'last'].map(track);
  queue[0].source = 'soundcloud';
  queue[2].source = 'soundcloud';
  queue[3].source = 'soundcloud';
  const f = await bufferedFixture({
    queue,
    resolve: async () => 'https://cf-media.sndcdn.com/test.mp3',
  });
  let disabled = false;
  f.bindings['../services/youtubeAvailability'].isYouTubePlaybackDisabled = () => disabled;
  f.bindings['../services/youtubeAvailability'].isYouTubeItemDisabled = (t) =>
    disabled && t?.source === 'youtube';
  await prefetchTick(f);
  disabled = true;
  await prefetchTick(f, 3);
  disabled = false;
  await prefetchTick(f, 4);
  assert.deepEqual(prefetched(f), [queue[1].id, queue[2].id, queue[1].id]);
  assert.equal(f.audio.plays, 1);
  assert.equal(f.audio.paused, false);
  assert.equal(f.bridgeCalls.length, 1);
  f.h.unmount();
});

test('Whole playback selects duplicate queue occurrences for next, manual selection and shuffle history', async () => {
  const queue = queueEntries.ensureQueueEntries([track('same'), track('same'), track('other')]);
  const f = fixture({ queue });
  await f.h.api().playTrack(queue[0]);
  await f.h.flush();
  await f.h.api().nextTrack();
  await f.h.flush();
  assert.equal(f.props.queueIndexRef.current, 1);
  assert.equal(
    queueEntries.queueEntryKey(f.h.api().currentTrack),
    queueEntries.queueEntryKey(queue[1]),
  );
  await f.h.api().playTrack(queue[0]);
  await f.h.flush();
  f.props.isShuffleRef.current = true;
  f.props.shuffleCycleRef.current.prioritize(queueEntries.queueEntryKey(queue[1]));
  await f.h.api().nextTrack();
  await f.h.flush();
  assert.equal(f.props.queueIndexRef.current, 1);
  assert.equal(
    queueEntries.queueEntryKey(f.h.api().currentTrack),
    queueEntries.queueEntryKey(queue[1]),
  );
  f.audio.currentTime = 0;
  f.h.api().prevTrack();
  await f.h.flush();
  assert.equal(f.props.queueIndexRef.current, 0);
  assert.equal(
    queueEntries.queueEntryKey(f.h.api().currentTrack),
    queueEntries.queueEntryKey(queue[0]),
  );
  f.h.unmount();
});

test('Whole playback keeps fresh caller metadata when selecting an existing queue occurrence', async () => {
  const queue = queueEntries.ensureQueueEntries([track('one'), track('two')]);
  const f = fixture({ queue });
  const fresh = { ...queue[1], title: 'Updated title', duration: 222 };
  await f.h.api().playTrack(fresh);
  await f.h.flush();
  assert.equal(f.props.queueIndexRef.current, 1);
  assert.equal(f.h.api().currentTrack.title, 'Updated title');
  assert.equal(f.props.queueRef.current[1].duration, 222);
  assert.equal(
    queueEntries.queueEntryKey(f.h.api().currentTrack),
    queueEntries.queueEntryKey(queue[1]),
  );
  assert.equal(queue[1].title, 'two');
  f.h.unmount();
});

async function decoderFixture(options = {}) {
  let now = 0;
  const f = fixture({ ...options, now: () => now });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  f.audio.paused = false;
  f.audio.readyState = 4;
  f.audio.currentTime = 10;
  f.audio.buffered = { length: 1, start: () => 0, end: () => 80 };
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  f.tickProgress = () => {
    now += 1000;
    f.h.fireTimers(1000);
  };
  return f;
}

test('Decoder watchdog sees a filled-buffer stall without waiting/stalled events and bounds recovery', async () => {
  const f = await decoderFixture();
  const before = f.bridgeCalls.length;
  for (let i = 0; i < 5; i++) f.tickProgress();
  assert.equal(f.audio.currentTime, 10.001);
  assert.equal(
    f.bridgeCalls.length,
    before,
    'The first action keeps the healthy cached/buffered source',
  );
  for (let i = 0; i < 4; i++) f.tickProgress();
  await f.h.flush();
  assert.equal(
    f.bridgeCalls.length,
    before + 1,
    'The second action renews the source exactly once',
  );
  assert.equal(f.audio.currentTime, 10.001);
  f.audio.paused = false;
  f.audio.dispatchEvent(new Event('playing'));
  await f.h.flush();
  for (let i = 0; i < 5; i++) f.tickProgress();
  await f.h.flush();
  assert.equal(f.audio.paused, true);
  assert.equal(f.h.api().isPlaying, false);
  assert.equal(f.bridgeCalls.length, before + 1);
  assert.ok(f.toasts.some((message) => message.includes('Воспроизведение зависло')));
  for (let i = 0; i < 20; i++) f.tickProgress();
  assert.equal(f.bridgeCalls.length, before + 1);
  f.h.unmount();
  assert.equal(f.h.timers(), 0);
});

test('Decoder watchdog cannot recover during pause, seeking, zero rate, network starvation or the final buffered tail', async () => {
  for (const state of [
    'paused',
    'seeking',
    'zero-rate',
    'unbuffered',
    'low-ready-state',
    'ended',
    'tail',
  ]) {
    const f = await decoderFixture();
    const before = f.bridgeCalls.length;
    if (state === 'paused') {
      f.audio.paused = true;
      f.audio.dispatchEvent(new Event('pause'));
    }
    if (state === 'seeking') {
      f.audio.seeking = true;
      f.audio.dispatchEvent(new Event('seeking'));
    }
    if (state === 'zero-rate') {
      f.audio.playbackRate = 0;
      f.audio.dispatchEvent(new Event('ratechange'));
    }
    if (state === 'unbuffered') f.audio.buffered = { length: 0 };
    if (state === 'low-ready-state') f.audio.readyState = 2;
    if (state === 'ended') f.audio.ended = true;
    if (state === 'tail') f.audio.currentTime = 119.75;
    const position = f.audio.currentTime;
    for (let i = 0; i < 12; i++) f.tickProgress();
    await f.h.flush();
    assert.equal(f.audio.currentTime, position, state);
    assert.equal(f.bridgeCalls.length, before, state);
    f.h.unmount();
    assert.equal(f.h.timers(), 0);
  }
});

test('Progress and source replacement defeat old watchdog timers, including deferred renewal replies', async () => {
  const reply = deferred();
  let calls = 0;
  const f = await decoderFixture({
    resolve: () =>
      ++calls === 1
        ? Promise.resolve('https://rr1.googlevideo.com/videoplayback?itag=140')
        : reply.promise,
  });
  for (let i = 0; i < 10; i++) {
    f.audio.currentTime += 1;
    f.tickProgress();
  }
  assert.equal(f.audio.currentTime, 20);
  assert.equal(calls, 1);
  for (let i = 0; i < 8; i++) f.tickProgress();
  assert.equal(calls, 2);
  f.h.api().togglePlay();
  reply.resolve('https://rr1.googlevideo.com/videoplayback?itag=251');
  await f.h.flush();
  assert.equal(f.h.api().isPlaying, false);
  assert.equal(f.audio.paused, true);
  f.h.unmount();
  assert.equal(f.h.timers(), 0);
});

test('A watchdog-owned nudge that never finishes seeking still reaches source renewal', async () => {
  for (const [dropsReadyState, quantum] of [
    [false, 0],
    [true, 0],
    [true, 0.02],
  ]) {
    const f = await decoderFixture();
    let position = f.audio.currentTime;
    Object.defineProperty(f.audio, 'currentTime', {
      configurable: true,
      get: () => position,
      set(value) {
        position = quantum ? Math.ceil(value / quantum) * quantum : value;
        f.audio.seeking = true;
        if (dropsReadyState) {
          f.audio.readyState = 2;
          f.audio.buffered = { length: 0 };
        }
        f.audio.dispatchEvent(new Event('seeking'));
      },
    });
    const before = f.bridgeCalls.length;
    for (let i = 0; i < 9; i++) f.tickProgress();
    await f.h.flush();
    assert.equal(f.bridgeCalls.length, before + 1, 'Self-seek cannot cancel the renewal deadline');
    f.h.unmount();
    assert.equal(f.h.timers(), 0);
  }
});

test('A user seek after the watchdog nudge abandons its self-seek deadline', async () => {
  const f = await decoderFixture();
  for (let i = 0; i < 5; i++) f.tickProgress();
  const before = f.bridgeCalls.length;
  f.audio.currentTime = 30;
  f.audio.seeking = true;
  f.audio.dispatchEvent(new Event('seeking'));
  for (let i = 0; i < 12; i++) f.tickProgress();
  assert.equal(f.bridgeCalls.length, before);
  assert.equal(f.audio.currentTime, 30);
  f.h.unmount();
  assert.equal(f.h.timers(), 0);
});

test('Explicit user seek to the nudged position cancels watchdog ownership', async () => {
  const f = await decoderFixture();
  for (let i = 0; i < 5; i++) f.tickProgress();
  const before = f.bridgeCalls.length;
  f.h.api().seek(f.audio.currentTime);
  f.audio.seeking = true;
  f.audio.dispatchEvent(new Event('seeking'));
  for (let i = 0; i < 12; i++) f.tickProgress();
  assert.equal(f.bridgeCalls.length, before);
  f.h.unmount();
  assert.equal(f.h.timers(), 0);
});

test('Actual core controls invalidate an externally prepared queue before it can commit', async () => {
  for (const control of ['playTrack', 'togglePlay', 'seek', 'nextTrack', 'prevTrack']) {
    const f = fixture(),
      delayed = deferred();
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    const ownsIntent = playbackIntent.beginPlaybackIntent();
    const pendingQueue = delayed.promise.then((queue) => {
      if (ownsIntent()) return f.h.api().playTrack(queue[0], queue);
    });
    assert.equal(ownsIntent(), true);
    if (control === 'playTrack') await f.h.api().playTrack(f.props.queueRef.current[1]);
    else if (control === 'seek') f.h.api().seek(12);
    else await f.h.api()[control]();
    await f.h.flush();
    assert.equal(ownsIntent(), false, control + ' supersedes pending queue intent');
    delayed.resolve([track('obsolete-prepared-queue')]);
    await pendingQueue;
    await f.h.flush();
    assert.equal(f.bridgeCalls.includes('yt_obsolete-prepared-queue'), false);
    assert.equal(
      f.props.queueRef.current.some((item) => item.id === 'yt_obsolete-prepared-queue'),
      false,
    );
    f.h.unmount();
  }
});

test('Actual core forwards its resolution signal to the bridge and pause cancels that owner', async () => {
  const delayed = deferred();
  let signal;
  const f = fixture({
    resolve: (_track, _options, ownerSignal) => {
      signal = ownerSignal;
      return delayed.promise;
    },
  });
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  f.h.api().pauseMainAudio();
  assert.equal(signal.aborted, true);
  delayed.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
  await f.h.flush();
  assert.equal(f.audio.plays, 0);
  f.h.unmount();
});

function hlsStartupFixture() {
  const requests = [],
    sources = [],
    instances = [];
  const queue = [{ ...track('fixture'), id: '2381180949', source: 'soundcloud' }];
  const f = fixture({
    queue,
    resolve: async (item, options) => {
      requests.push({ id: item.id, ...options });
      return 'https://playback.media-streaming.soundcloud.cloud/fixture/playlist.m3u8';
    },
  });
  class HeldManifest {
    static isSupported() {
      return true;
    }
    static Events = {
      MEDIA_ATTACHED: 'attached',
      MANIFEST_PARSED: 'manifest',
      ERROR: 'error',
      DESTROYING: 'destroying',
    };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    callbacks = new Map();
    constructor() {
      instances.push(this);
    }
    on(name, callback) {
      this.callbacks.set(name, callback);
    }
    attachMedia(audio) {
      audio.src = 'blob:hls-' + instances.length;
      this.callbacks.get('attached')?.();
    }
    loadSource(url) {
      sources.push(url);
    }
    destroy() {
      this.callbacks.get('destroying')?.();
    }
  }
  f.bindings['hls.js'].default = HeldManifest;
  f.bindings['../services/audioCacheService'].AudioCacheService.isHlsUrl = () => true;
  return { ...f, requests, sources, instances };
}
test('Actual hook recovers HLS before its first manifest, tries another rendition, then preserves the queue', async () => {
  const f = hlsStartupFixture();
  await f.h.api().playTrack(f.props.queueRef.current[0]);
  await f.h.flush();
  assert.equal(f.audio.paused, true);
  assert.equal(f.audio.plays, 0);
  assert.equal(f.sources.length, 1);
  f.h.fireTimers(8000);
  await f.h.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].forceRefresh, true);
  assert.equal(f.requests[1].preferAlternateFormat, true);
  f.h.fireTimers(8000);
  await f.h.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.h.api().playbackIssue.kind, 'timeout');
  assert.equal(f.h.api().isLoadingTrack, false);
  assert.equal(f.props.queueIndexRef.current, 0);
  assert.equal(f.props.queueRef.current[0].id, '2381180949');
  f.h.unmount();
  assert.equal(f.h.lateUpdates(), 0);
});
test('Actual hook does not refresh a silently loading HLS source after pause or unmount', async () => {
  for (const action of ['pause', 'unmount']) {
    const f = hlsStartupFixture();
    await f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    if (action === 'pause') f.h.api().pauseMainAudio();
    else f.h.unmount();
    f.h.fireTimers(8000);
    if (action === 'pause') await f.h.flush();
    else await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.requests.length, 1);
    assert.equal(f.h.lateUpdates(), 0);
    f.h.unmount();
  }
});

// Exercise the real hook -> cache -> shared resolver ownership, replacing transport only.
function sharedPrefetchFixture(t, options = {}) {
  const cache = new AudioCacheService(),
    shared = new SharedStreamResolver(),
    requests = [];
  const resolve = (item, settings, signal) =>
    shared.resolve(item, settings || {}, signal, (_track, liveOptions) => {
      const result = deferred(),
        transportSignal = currentStreamResolveSignal();
      const request = { id: item.id, signal: transportSignal, result, liveOptions };
      requests.push(request);
      return new Promise((yes, no) => {
        const abort = () => no(transportSignal.reason);
        transportSignal.addEventListener('abort', abort, { once: true });
        result.promise
          .then(yes, no)
          .finally(() => transportSignal.removeEventListener('abort', abort));
      });
    });
  t.mock.method(platformBridge, 'getFullStreamUrl', resolve);
  const f = fixture({ ...options, cacheService: cache, resolve });
  t.after(() => {
    f.h.unmount();
    cache.clear();
  });
  return { ...f, cache, requests };
}

test('selecting an in-flight prefetched track keeps one transport and promotes session recovery', async (t) => {
  const f = sharedPrefetchFixture(t);
  const [selected, other] = f.props.queueRef.current;
  const prefetch = f.cache.prefetchTrack(selected);
  const speculative = f.cache.prefetchTrack(other);
  await f.h.flush();
  await f.h.api().playTrack(selected);
  await f.h.flush();
  assert.equal(f.requests.length, 2, 'one transport each for selected and unrelated prefetch');
  const active = f.requests.find((r) => r.id === selected.id);
  assert.equal(active.signal.aborted, false);
  assert.equal(active.liveOptions.allowSessionRecovery, true);
  assert.equal(f.requests.find((r) => r.id === other.id).signal.aborted, true);
  active.result.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
  await Promise.all([prefetch, speculative]);
  await f.h.flush();
  assert.equal(f.audio.plays, 1);
  assert.equal(f.requests.filter((r) => r.id === selected.id).length, 1);
});

test('rapid selection while buffering cancels the retained prefetch; its late source cannot play', async (t) => {
  const f = sharedPrefetchFixture(t);
  const [first, second] = f.props.queueRef.current;
  const prefetch = f.cache.prefetchTrack(first);
  await f.h.flush();
  await f.h.api().playTrack(first);
  await f.h.flush();
  await f.h.api().playTrack(second);
  await f.h.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].result.resolve('https://rr1.googlevideo.com/videoplayback?itag=18');
  await prefetch;
  await f.h.flush();
  assert.equal(f.audio.plays, 0);
  f.requests[1].result.resolve('https://rr1.googlevideo.com/videoplayback?itag=140');
  await f.h.flush();
  assert.equal(f.audio.plays, 1);
  assert.equal(f.h.api().currentTrack.id, second.id);
});

test('pause and unmount cancel a selected prefetch even while offline storage is pending', async (t) => {
  for (const action of ['pause', 'unmount']) {
    const lookup = deferred();
    const f = sharedPrefetchFixture(t, { offline: { getCachedTrackUrl: () => lookup.promise } });
    const prefetch = f.cache.prefetchTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    const selection = f.h.api().playTrack(f.props.queueRef.current[0]);
    await f.h.flush();
    assert.equal(f.requests[0].signal.aborted, false);
    if (action === 'pause') f.h.api().pauseMainAudio();
    else f.h.unmount();
    assert.equal(f.requests[0].signal.aborted, true);
    lookup.resolve(null);
    await Promise.all([selection, prefetch]);
    if (action === 'pause') await f.h.flush();
    assert.equal(f.audio.plays, 0);
    assert.equal(f.h.lateUpdates(), 0);
  }
});

test('offline audio starts before delayed artwork; a late cover cannot overwrite the next selection', async () => {
  for (const switchTrack of [false, true]) {
    const cover = deferred();
    const f = fixture({
      offline: {
        getCachedTrackUrl: async () => 'blob:offline-audio',
        getCachedCoverUrl: () => cover.promise,
      },
    });
    try {
      const [first, second] = f.props.queueRef.current;
      const selection = f.h.api().playTrack(first);
      await f.h.flush();
      assert.equal(f.audio.plays, 1, 'artwork is still pending');
      assert.equal(f.audio.src, 'blob:offline-audio');
      await selection;
      assert.equal(f.bridgeCalls.length, 0);
      if (switchTrack) {
        f.bindings['../services/offlineCacheService'].offlineCacheService.getCachedTrackUrl =
          async () => null;
        await f.h.api().playTrack(second);
        await f.h.flush();
      }
      cover.resolve('blob:offline-cover');
      await f.h.flush();
      assert.equal(f.h.api().currentTrack.id, switchTrack ? second.id : first.id);
      assert.equal(
        f.h.api().currentTrack.cover_url,
        switchTrack ? undefined : 'blob:offline-cover',
      );
    } finally {
      cover.resolve(null);
      f.h.unmount();
    }
  }
});
