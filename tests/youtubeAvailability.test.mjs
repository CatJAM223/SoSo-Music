import { resolvePlayerStream } from '../src/shared/services/playerStreamResolution.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as tastePolicy from '../src/shared/utils/tastePolicy.ts';
import * as access from '../src/shared/services/youtubeAvailability.ts';
import * as playbackIntent from '../src/shared/utils/playbackIntent.ts';
const yt = { id: 'yt_fixture', source: 'youtube' },
  sc = { id: 'sc_fixture', source: 'soundcloud' };
function desktop(t) {
  const priorWindow = globalThis.window,
    priorStorage = globalThis.localStorage,
    values = new Map();
  globalThis.window = { electronAPI: { connectYouTubeAccount() {} } };
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  t.after(() => {
    globalThis.window = priorWindow;
    globalThis.localStorage = priorStorage;
  });
  return values;
}
function callback(name, file = 'useAudioPlayerCore.ts') {
  const source = fs.readFileSync(new URL('../src/shared/hooks/' + file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, 'Missing actual callback ' + name);
  // Mutations affect only this test extraction, never the production file.
  if (process.env.SOSO_CALLBACK_TEST_MUTATION === name) return '(()=>{})';
  return ts.transpileModule('(' + found.getText(tree) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
test('YouTube opt-out persists, notifies only changes and leaves SoundCloud available', (t) => {
  const values = desktop(t);
  let notifications = 0;
  const off = access.subscribeYouTubeAvailability(() => notifications++);
  t.after(off);
  access.setYouTubePlaybackDisabled(true);
  access.setYouTubePlaybackDisabled(true);
  assert.equal(notifications, 1);
  assert.equal(values.get('soso_youtube_playback_disabled'), 'true');
  assert.equal(access.isYouTubeItemDisabled(yt), true);
  assert.equal(access.isYouTubeItemDisabled(sc), false);
  assert.equal(access.isYouTubeItemDisabled({ ...yt, source: 'soundcloud' }), true);
  assert.equal(access.youtubeDisabledProps(yt, true).inert, true);
  assert.deepEqual(access.youtubeDisabledProps(sc, true), {});
  access.setYouTubePlaybackDisabled(false);
  assert.equal(notifications, 2);
  assert.equal(values.size, 0);
});
test('Persisted opt-out is read in a fresh renderer and never disables Android', (t) => {
  const values = desktop(t);
  values.set('soso_youtube_playback_disabled', 'true');
  assert.equal(access.isYouTubePlaybackDisabled(), true);
  globalThis.window = { electronAPI: {} };
  assert.equal(access.isYouTubePlaybackDisabled(), false);
  assert.equal(access.isYouTubeItemDisabled(yt), false);
});
test('Unavailable YouTube queue items are skipped in either direction with bounded repeat and empty queues', (t) => {
  desktop(t);
  access.setYouTubePlaybackDisabled(true);
  const queue = [yt, sc, { ...yt, id: 'yt_second' }];
  assert.equal(access.availableQueueIndex(queue, 0, 1, false), 1);
  assert.equal(access.availableQueueIndex(queue, 2, -1, false), 1);
  assert.equal(access.availableQueueIndex(queue, 2, 1, true), 1);
  assert.equal(access.availableQueueIndex(queue, 2, 1, false), -1);
  assert.equal(access.availableQueueIndex([yt], 0, 1, true), -1);
  assert.equal(access.availableQueueIndex([], 0, 1, true), -1);
});
// These callback-level tests check the opt-out boundary. Full playback lifecycle
// and real React integration are covered by playbackLifecycle and the UI probes.
const ref = (current) => ({ current });
function playGateFixture() {
  const events = [];
  const scope = {
    ...access,
    ...playbackIntent,
    ...tastePolicy,
    AbortController,
    retryingTemporaryFailureRef: ref(false),
    temporaryRecoveryRef: ref(null),
    temporaryRetryAttemptRef: ref(0),
    cancelTemporaryRetry: () => events.push('cancel-retry'),
    setPlaybackIssue: () => {},
    trackClickTimestampRef: ref(0),
    bufferingStartedAtRef: ref(0),
    PlaybackLogger: { info: (message) => events.push(message) },
    stopSnippetRef: ref(null),
    cancelFade: () => {},
    isCrossfadingRef: ref(false),
    consecutivePlaybackErrorsRef: ref(0),
    isWaveActiveRef: ref(false),
    isWaveStartingRef: ref(false),
    queueRef: ref([]),
    stopWave: () => events.push('stop-wave'),
    setIsWaveActive: () => {},
    // Stop at the decoder-availability boundary. This fixture does not claim
    // to verify resolution, playback, or React dependency arrays.
    audioRef: ref(null),
  };
  return { events, scope };
}

test('Playback opt-out gate blocks YouTube, admits SoundCloud and selects an available queue item', async (t) => {
  desktop(t);
  access.setYouTubePlaybackDisabled(true);
  const blocked = playGateFixture(),
    play = vm.runInNewContext(callback('playTrack'), blocked.scope);
  await play(yt);
  assert.deepEqual(blocked.events, [], 'Blocked YouTube must not mutate playback');
  const allowed = playGateFixture();
  await vm.runInNewContext(callback('playTrack'), allowed.scope)(sc);
  assert.equal(allowed.events[0], 'cancel-retry');
  assert.ok(
    allowed.events.some((event) => event.includes('id: sc_fixture')),
    'SoundCloud must pass the gate',
  );
  const substitute = playGateFixture();
  await vm.runInNewContext(callback('playTrack'), substitute.scope)(yt, [yt, sc]);
  assert.ok(substitute.events.some((event) => event.includes('id: sc_fixture')));
  assert.equal(
    substitute.events.some((event) => event.includes('id: yt_fixture')),
    false,
  );
  access.setYouTubePlaybackDisabled(false);
  const enabled = playGateFixture();
  await vm.runInNewContext(callback('playTrack'), enabled.scope)(yt);
  assert.ok(
    enabled.events.some((event) => event.includes('id: yt_fixture')),
    'Enabled YouTube must pass the gate',
  );
});

test('Play/pause opt-out has positive resume/pause controls for both providers', async (t) => {
  desktop(t);
  access.setYouTubePlaybackDisabled(true);
  const events = [],
    scope = {
      ...access,
      ...playbackIntent,
      ...tastePolicy,
      AbortController,
      currentTrackRef: ref(yt),
      isWaveStartingRef: ref(false),
      audioRef: ref({ paused: true }),
      pendingResolutionRef: ref(false),
      isTransitioningTrackRef: ref(false),
      isPlayingRef: ref(false),
      pauseMainAudio: () => events.push('pause'),
      resumeMainAudio: () => events.push('resume'),
      stopWave: () => events.push('stop-wave'),
    };
  const toggle = vm.runInNewContext(callback('togglePlay'), scope);
  toggle();
  assert.deepEqual(events, []);
  scope.currentTrackRef.current = sc;
  toggle();
  assert.deepEqual(events, ['resume']);
  scope.isPlayingRef.current = true;
  toggle();
  assert.deepEqual(events, ['resume', 'pause']);
  access.setYouTubePlaybackDisabled(false);
  scope.currentTrackRef.current = yt;
  toggle();
  assert.deepEqual(events, ['resume', 'pause', 'pause']);
});

test('Prefetch opt-out preserves permitted requests and skips blocked YouTube', (t) => {
  desktop(t);
  access.setYouTubePlaybackDisabled(true);
  const calls = [],
    scope = {
      ...access,
      ...playbackIntent,
      ...tastePolicy,
      AbortController,
      false: false,
      audioRef: ref({ paused: false, readyState: 4 }),
      pendingResolutionRef: ref(false),
      resolvedStreamCache: ref(new Map()),
      STREAM_URL_MAX_AGE_MS: 300000,
      audioCacheService: { prefetchTrack: (track, url) => calls.push([track.id, url]) },
    };
  const prefetch = vm.runInNewContext(callback('prefetchTrackStream'), scope);
  prefetch(yt);
  assert.deepEqual(calls, []);
  prefetch(sc);
  assert.deepEqual(calls, [[sc.id, undefined]]);
  access.setYouTubePlaybackDisabled(false);
  prefetch(yt);
  assert.deepEqual(calls, [
    [sc.id, undefined],
    [yt.id, undefined],
  ]);
});

test('Snippet opt-out keeps both permitted providers resolving while blocked YouTube stays inert', async (t) => {
  desktop(t);
  access.setYouTubePlaybackDisabled(true);
  const requests = [],
    requestSignals = [],
    selected = [],
    loads = [],
    scope = {
      ...access,
      ...playbackIntent,
      ...tastePolicy,
      AbortController,
      snippetAudioRef: ref({ pause() {}, removeAttribute() {}, load() {}, currentTime: 0 }),
      streamRequestIdRef: ref(0),
      streamAbortRef: ref(null),
      onPauseMainAudio: () => {},
      setSnippetTrack: (track) => selected.push(track.id),
      setSnippetProgress: () => {},
      setIsSnippetPlaying: () => {},
      DEFAULT_TRACK_DURATION: 180,
      resolvedStreamCache: ref(new Map()),
      STREAM_URL_MAX_AGE_MS: 300000,
      snippetStartRef: ref(0),
      snippetEndRef: ref(0),
      SNIPPET_DURATION: 15,
      snippetHlsRef: ref(null),
      snippetTrackRef: ref(null),
      snippetLoadVersionRef: ref(0),
      snippetWantsPlayRef: ref(false),
      snippetRetryRef: ref(null),
      snippetFailureRef: ref(null),
      snippetNeedsResolveRef: ref(false),
      resolvePlayerStream,
      PlaybackLogger: { info() {}, warn() {} },
      emitToast() {},
      isPlayableDirectAudioUrl: () => false,
      detectTrackSource: (track) => track.source,
      loadStreamIntoAudio: (...args) => loads.push(args),
      platformBridge: {
        getFullStreamUrl: async (track, _options, signal) => {
          requests.push(track.id);
          requestSignals.push(signal);
          return null;
        },
      },
      console: {
        warn: (error) => {
          throw error;
        },
      },
    };
  const preview = vm.runInNewContext(callback('previewSnippet', 'useSnippetController.ts'), scope);
  preview(yt);
  await Promise.resolve();
  assert.deepEqual(requests, []);
  assert.deepEqual(selected, []);
  assert.deepEqual(loads, []);
  assert.equal(scope.streamRequestIdRef.current, 0);
  assert.equal(scope.streamAbortRef.current, null);
  preview(sc);
  await Promise.resolve();
  assert.deepEqual(requests, [sc.id]);
  assert.deepEqual(selected, [sc.id]);
  access.setYouTubePlaybackDisabled(false);
  preview(yt);
  await Promise.resolve();
  assert.deepEqual(requests, [sc.id, yt.id]);
  assert.deepEqual(selected, [sc.id, yt.id]);
  assert.equal(scope.streamRequestIdRef.current, 2);
  assert.equal(requestSignals[0].aborted, true, 'replacement cancels the old snippet stream owner');
  assert.equal(requestSignals[1].aborted, false);
});

test('Offline download opt-out blocks all side effects and permits actual saving when allowed', async (t) => {
  desktop(t);
  access.setYouTubePlaybackDisabled(true);
  const requests = [],
    saved = [],
    progress = [],
    scope = {
      ...access,
      ...playbackIntent,
      ...tastePolicy,
      AbortController,
      getOfflineDownloadProgress: () => null,
      setOfflineDownloadProgress: (id, value) => progress.push([id, value]),
      emitToast: () => {},
      detectTrackSource: (track) => track.source,
      platformBridge: {
        getFullStreamUrl: async (track) => {
          requests.push(track.id);
          return 'https://media.example/audio.mp3';
        },
      },
      offlineCacheService: {
        cacheTrack: async (track, url) => {
          saved.push([track.id, url]);
          return true;
        },
      },
      refreshCachedTracks: async () => {},
      console: {
        error: (error) => {
          throw error;
        },
      },
    };
  const download = vm.runInNewContext(
    callback('cacheTrackForOffline', 'useLibraryManager.ts'),
    scope,
  );
  assert.equal(await download(yt), false);
  assert.deepEqual(requests, []);
  assert.deepEqual(saved, []);
  assert.deepEqual(progress, []);
  assert.equal(await download(sc), true);
  assert.deepEqual(requests, [sc.id]);
  assert.deepEqual(saved, [[sc.id, 'https://media.example/audio.mp3']]);
  access.setYouTubePlaybackDisabled(false);
  assert.equal(await download(yt), true);
  assert.deepEqual(requests, [sc.id, yt.id]);
  assert.deepEqual(progress.at(-1), [yt.id, null]);
});

test('Actual next-track callback skips blocked items and stops an all-YouTube repeat queue', async (t) => {
  desktop(t);
  access.setYouTubePlaybackDisabled(true);
  const plays = [],
    q = [sc, yt, { ...sc, id: 'sc_second' }];
  let index = 0,
    paused = 0;
  const scope = {
    ...access,
    ...playbackIntent,
    ...tastePolicy,
    AbortController,
    currentTrackRef: { current: sc },
    audioRef: {
      current: {
        pause() {
          paused++;
        },
      },
    },
    isWaveActiveRef: { current: false },
    isWaveStartingRef: { current: false },
    queueRef: { current: q },
    queueIndexRef: { current: 0 },
    isShuffleRef: { current: false },
    repeatModeRef: { current: 'none' },
    setIsLoadingTrack() {},
    setIsPlaying() {},
    stopQueuePlayback() {
      paused++;
    },
    isPlayingRef: { current: true },
    setQueueIndex: (value) => (index = value),
    playTrack: (track) => plays.push(track.id),
  };
  const next = vm.runInNewContext(callback('nextTrack'), scope);
  await next();
  assert.equal(index, 2);
  assert.deepEqual(plays, ['sc_second']);
  scope.queueRef.current = [yt];
  scope.repeatModeRef.current = 'all';
  await next();
  assert.deepEqual(plays, ['sc_second']);
  assert.equal(paused, 1);
});
