import { stripModuleImports } from './helpers/sourceInspection.mjs';
import {
  matchesWaveSource,
  normalizeWaveSource,
  saveWaveSource,
} from '../src/shared/services/waveSource.ts';
import {
  createWavePreferences,
  WAVE_SESSION_IDLE_MS,
} from '../src/shared/services/wavePreferences.ts';
import { isYouTubeItemDisabled } from '../src/shared/services/youtubeAvailability.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as identity from '../src/shared/utils/waveIdentity.ts';
import * as queue from '../src/shared/utils/waveQueue.ts';
import * as feedback from '../src/shared/utils/waveFeedback.ts';
import { playedMediaDelta } from '../src/shared/utils/listeningTime.ts';
import { createWaveMemory } from '../src/shared/services/waveMemory.ts';
import { normalizeWaveSeed, waveFamiliarArtists } from '../src/shared/utils/waveRecommendations.ts';

const song = (id, artist, title = 'Melody', duration = 200) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: '' },
  duration,
  preview: '',
  source: 'soundcloud',
});
function waveHarness(batches, likes = [], storage, now = Date.now) {
  const calls = [],
    plays = [],
    cleanups = [];
  const queueRef = { current: [] },
    queueIndexRef = { current: -1 };
  const bridge = {
    getWaveBatch: async (...args) => {
      calls.push(args);
      const reply = batches.shift();
      return typeof reply === 'function' ? reply(...args) : reply || [];
    },
    getLikedTracks: async () => likes,
    getFollowedArtists: async () => [],
    getTopScrobbledArtists: async () => [],
  };
  const sandbox = vm.createContext({
    console,
    Map,
    Set,
    Object,
    AbortController,
    isYouTubeItemDisabled,
    matchesWaveSource,
    normalizeWaveSource,
    readWaveSource: () => 'all',
    saveWaveSource,
    ...identity,
    ...queue,
    ...feedback,
    normalizeWaveSeed,
    waveFamiliarArtists,
    createWaveMemory: () => createWaveMemory(storage || { getItem: () => null, setItem() {} }),
    createWavePreferences: () =>
      createWavePreferences(storage || { getItem: () => null, setItem() {} }, now),
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useCallback: (fn) => fn,
    useEffect: (effect) => {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    },
    emitToast: () => {},
    PlaybackLogger: { info: () => {} },
    platformBridge: bridge,
  });
  const source = stripModuleImports(
    readFileSync(new URL('../src/shared/hooks/useWaveEngine.ts', import.meta.url), 'utf8'),
  ).replace(/\bexport\s+/g, '');
  vm.runInContext(stripTypeScriptTypes(source) + '\nthis.createWave=useWaveEngine;', sandbox);
  const api = sandbox.createWave({
    queueRef,
    queueIndexRef,
    setQueue: (value) => {
      queueRef.current = typeof value === 'function' ? value(queueRef.current) : value;
    },
    setQueueIndex: (value) => {
      queueIndexRef.current = value;
    },
    playTrackRef: {
      current: (track, tracks) => {
        queueRef.current = tracks;
        queueIndexRef.current = 0;
        plays.push(track);
      },
    },
  });
  return {
    api,
    queueRef,
    queueIndexRef,
    calls,
    plays,
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

test('Wave start keeps a different artist song sharing the seed title and suppresses only the seed family', async () => {
  const seed = song('seed', 'Artist A', 'Home');
  const h = waveHarness([
    [song('same', 'Artist A', 'Home (Slowed)'), song('other', 'Artist B', 'Home')],
  ]);
  await h.api.startWave('default', seed);
  assert.equal(h.plays[0].id, 'other');
});

test('Wave refill keeps title homonyms from new artists instead of treating them as reuploads', async () => {
  const h = waveHarness([
    [song('current', 'Artist A', 'Stay')],
    [song('copy', 'Artist A', 'Stay (Official Audio)'), song('other', 'Artist B', 'Stay')],
  ]);
  await h.api.startWave();
  await h.api.fetchMoreWaveTracks();
  assert.deepEqual(
    Array.from(h.queueRef.current, (t) => t.id),
    ['current', 'other'],
  );
});

test('A dislike followed by automatic next neither double-penalizes nor restores the track as a positive anchor', async () => {
  const current = song('disliked', 'Artist A', 'Red moon');
  const h = waveHarness([[current, song('pending', 'Artist B', 'Blue sky')], []]);
  await h.api.startWave('default', current);
  // start excludes the seed; play it as the real current track for this interaction.
  h.queueRef.current = [current, song('pending', 'Artist B', 'Blue sky')];
  h.queueIndexRef.current = 0;
  h.api.handleWaveDislike(current);
  h.api.recordWavePlayback(current, 190, 200);
  await h.api.fetchMoreWaveTracks();
  const request = h.calls[1];
  assert.ok(!request[1].some((t) => t.id === current.id));
  assert.equal(request[3].artistFeedback['artist a'], -0.75);
  assert.equal(request[3].recentTracks.filter((t) => t.id === current.id).length, 1);
});

test('Refill preserves durable familiarity, records real listening, and counts an ended/next observation once', async () => {
  const current = song('current', 'Artist A', 'First');
  const h = waveHarness(
    [
      [current],
      [song('stranger', 'Stranger', 'Unknown'), song('known', 'Longtime favorite', 'Familiar')],
    ],
    [{ deezer_id: 'liked', artist: 'Longtime favorite' }],
  );
  await h.api.startWave();
  h.api.recordWavePlayback(current, 185, 200);
  h.api.recordWavePlayback(current, 185, 200);
  await h.api.fetchMoreWaveTracks();
  const context = h.calls[1][3];
  assert.equal(context.recentTracks.length, 1);
  assert.equal(context.artistFeedback['artist a'], 0.2);
  assert.ok(h.calls[1][1].some((t) => t.id === 'current'));
  assert.equal(h.queueRef.current[1].id, 'known');
});

test('Switching wave mode retains recent real exposure and bounded session reactions', async () => {
  const current = song('current', 'Artist A', 'First');
  const h = waveHarness([[current], [song('new', 'Artist B', 'Second')]]);
  await h.api.startWave('default');
  h.api.recordWavePlayback(current, 5, 200);
  await h.api.startWave('discover');
  assert.equal(h.calls[1][0], 'discover');
  assert.equal(h.calls[1][3].recentTracks[0].id, 'current');
  assert.equal(h.calls[1][3].artistFeedback['artist a'], -0.6);
});

test('Persistent taste records manual skips but keeps media-error transitions neutral', () => {
  const source = readFileSync(
    new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  const finishPlaybackSession = useCallback(');
  const end = source.indexOf('  // A network failure is not a dislike', start);
  for (const [errorRequest, expectedSkip] of [
    [7, false],
    [6, true],
    [null, true],
  ]) {
    const writes = [];
    const sandbox = vm.createContext({
      useCallback: (fn) => fn,
      samplePlayback: () => {},
      playbackSessionRef: {
        current: { track: song('one', 'Artist', 'A'), playedSeconds: 7, finalized: false },
      },
      crossfadeDurationRef: { current: 0 },
      savePlaybackSession: (...args) => writes.push(args),
      handledMediaErrorRef: { current: errorRequest === null ? null : { requestId: errorRequest } },
      streamRequestIdRef: { current: 7 },
      isWaveActiveRef: { current: false },
      isWaveStartingRef: { current: false },
      recordWavePlayback: () => {},
    });
    vm.runInContext(
      stripTypeScriptTypes(source.slice(start, end)) + '\nthis.finish=finishPlaybackSession;',
      sandbox,
    );
    sandbox.finish({ duration: 200, currentTime: 7 });
    assert.equal(writes[0][2], expectedSkip);
  }
});

test('Wave restart excludes heard songs but retains discarded proposals only as a soft hint', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const heard = song('heard', 'Heard singer', 'Heard tune'),
    unheard = song('unheard', 'Unheard singer', 'Unheard tune');
  const first = waveHarness([[heard, unheard]], [], storage);
  await first.api.startWave();
  first.api.observeWavePlayback(heard, 5);
  const second = waveHarness([[unheard]], [], storage);
  await second.api.startWave();
  assert.ok(second.calls[0][2].includes('heard'));
  assert.ok(!second.calls[0][2].includes('unheard'));
  assert.equal(second.calls[0][3].recentTracks[0].id, 'heard');
  assert.ok(second.calls[0][3].offeredTracks.some((track) => track.id === 'unheard'));
  assert.equal(second.plays[0].id, 'unheard');
});
test('Observing an ongoing song stores history without interpreting it as a skip or a positive reaction', async () => {
  const current = song('ongoing', 'Observed singer', 'Ongoing tune');
  const h = waveHarness([[current], []]);
  await h.api.startWave();
  h.api.observeWavePlayback(current, 6);
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[1][3].recentTracks[0].id, 'ongoing');
  assert.equal(h.calls[1][3].artistFeedback['observed singer'], undefined);
  assert.equal(h.calls[1][1].length, 0);
});
test('Opening wave, failed starts and liking a queued song never pretend it was heard', async () => {
  const queued = song('queued', 'Queued singer', 'Queued tune');
  const h = waveHarness([[queued], []]);
  await h.api.startWave();
  h.api.handleWaveLike(queued);
  h.api.observeWavePlayback(queued, 0);
  h.api.recordWavePlayback(queued, 0, 200);
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[1][3].recentTracks.length, 0);
});

test('The real audio sampler observes measured progress and never counts seeking as heard time', () => {
  const source = readFileSync(
    new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  const samplePlayback = useCallback('),
    end = source.indexOf('  const savePlaybackSession', start);
  const memory = createWaveMemory({ getItem: () => null, setItem() {} });
  let now = 0;
  const session = {
    track: song('sample', 'Sampler singer', 'Sampler tune'),
    playedSeconds: 0,
    lastPosition: 0,
    lastWallTime: 0,
    finalized: false,
  };
  const ctx = vm.createContext({
    NativeAudioElement: class {},
    useCallback: (fn) => fn,
    performance: { now: () => now },
    playbackSessionRef: { current: session },
    playedMediaDelta,
    observeWavePlayback: (track, seconds) => memory.recordPlayback(track, seconds),
  });
  vm.runInContext(
    stripTypeScriptTypes(source.slice(start, end)) + '\nthis.sample=samplePlayback;',
    ctx,
  );
  const audio = { currentTime: 80, playbackRate: 1, paused: false, seeking: true };
  now = 1000;
  ctx.sample(audio);
  assert.equal(memory.playedTracks().length, 0);
  audio.seeking = false;
  audio.currentTime = 81;
  now = 2000;
  ctx.sample(audio);
  assert.equal(memory.playedTracks().length, 0);
  audio.currentTime = 82;
  now = 3000;
  ctx.sample(audio);
  assert.equal(memory.playedTracks()[0].id, 'sample');
  assert.equal(session.playedSeconds, 2);
});

for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites']) {
  test(
    mood + ': restart remembers the beginning of a long previous wave, including its covers',
    async () => {
      const values = new Map();
      const storage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      };
      const memory = createWaveMemory(storage);
      const original = song('original', 'Nirvana', 'Smells Like Teen Spirit', 301);
      memory.recordPlayback(original, 30);
      for (let i = 0; i < 100; i++)
        memory.recordPlayback(song('heard' + i, 'Musician ' + i, 'Past tune ' + i), 30);
      const copy = song('cover', 'Neo Acoustix', "Smells Like Teen's Spirit", 234);
      const fresh = song('fresh', 'New singer', 'Unheard melody');
      const h = waveHarness([[copy, fresh]], [], storage);
      await h.api.startWave(mood);
      assert.ok(
        h.calls[0][2].includes('original'),
        'Provider exclusions retain the start of the previous wave',
      );
      assert.ok(
        h.calls[0][3].recentTracks.some((t) => t.id === 'original'),
        'Song-family history also crosses the platform bridge',
      );
      assert.deepEqual(
        Array.from(h.queueRef.current, (t) => t.id),
        ['fresh'],
      );
    },
  );
}

function deferredBatch() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('Restarted wave starts its own refill and old completion cannot clear the new owner flag or append tracks', async () => {
  const old = deferredBatch(),
    fresh = deferredBatch();
  const h = waveHarness([
    [song('old-current', 'Old singer', 'Old current')],
    () => old.promise,
    [song('new-current', 'New singer', 'New current')],
    () => fresh.promise,
  ]);
  await h.api.startWave('default');
  const oldRequest = h.api.fetchMoreWaveTracks();
  assert.equal(h.api.isFetchingMoreWaveRef.current, true);
  await h.api.startWave('energy');
  assert.equal(h.api.isFetchingMoreWaveRef.current, false);
  const newRequest = h.api.fetchMoreWaveTracks();
  assert.equal(h.calls.length, 4, 'New wave does not reuse the old refill promise');
  assert.equal(h.calls[3][0], 'energy');
  old.resolve([song('old-refill', 'Stale singer', 'Stale melody')]);
  await oldRequest;
  assert.equal(
    h.api.isFetchingMoreWaveRef.current,
    true,
    'Only the new refill can clear its loading state',
  );
  assert.deepEqual(
    Array.from(h.queueRef.current, (t) => t.id),
    ['new-current'],
  );
  fresh.resolve([song('new-refill', 'Fresh singer', 'Fresh melody')]);
  await newRequest;
  assert.equal(h.api.isFetchingMoreWaveRef.current, false);
  assert.deepEqual(
    Array.from(h.queueRef.current, (t) => t.id),
    ['new-current', 'new-refill'],
  );
});

test('Stopping a wave detaches its refill; a restart shares only the new generation refill', async () => {
  const old = deferredBatch(),
    fresh = deferredBatch();
  const h = waveHarness([
    [song('old-current', 'Old singer', 'Old current')],
    () => old.promise,
    [song('new-current', 'New singer', 'New current')],
    () => fresh.promise,
  ]);
  await h.api.startWave();
  const oldRequest = h.api.fetchMoreWaveTracks();
  h.api.stopWave();
  assert.equal(h.api.isFetchingMoreWaveRef.current, false);
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls.length, 2, 'Stopped waves make no refill calls');
  await h.api.startWave('discover');
  const first = h.api.fetchMoreWaveTracks();
  const shared = h.api.fetchMoreWaveTracks();
  assert.equal(
    h.calls.length,
    4,
    'Current generation still deduplicates end-of-queue and background requests',
  );
  old.reject(new Error('Old connection failed'));
  await oldRequest;
  assert.equal(h.api.isFetchingMoreWaveRef.current, true);
  fresh.resolve([song('new-refill', 'Fresh singer', 'New music')]);
  await Promise.all([first, shared]);
  assert.equal(h.api.isFetchingMoreWaveRef.current, false);
  assert.ok(!h.queueRef.current.some((t) => t.id === 'old-current'));
});

test('Wave restart, stop and unmount abort the actual bridge request signals', async () => {
  let firstSignal;
  const old = deferredBatch();
  const h = waveHarness([
    (...args) => {
      firstSignal = args[4];
      return old.promise;
    },
    [song('new', 'New singer', 'Fresh song')],
    [],
  ]);
  const first = h.api.startWave();
  assert.equal(firstSignal.aborted, false);
  await h.api.startWave('energy');
  assert.equal(firstSignal.aborted, true);
  old.resolve([song('stale', 'Old singer', 'Old song')]);
  await first;
  assert.equal(h.plays.length, 1);
  assert.equal(h.plays[0].id, 'new');
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[2][4].aborted, false);
  const refill = deferredBatch();
  const second = waveHarness([[song('current', 'Artist', 'Current')], () => refill.promise]);
  await second.api.startWave();
  const pending = second.api.fetchMoreWaveTracks();
  second.api.stopWave();
  assert.equal(second.calls[1][4].aborted, true);
  refill.resolve([]);
  await pending;
  const third = waveHarness([() => new Promise((resolve) => setImmediate(() => resolve([])))]);
  const starting = third.api.startWave();
  third.unmount();
  assert.equal(third.calls[0][4].aborted, true);
  await starting;
});

test('A quick skip adapts later music without replacing the announced next track', async () => {
  const current = { ...song('current-jazz', 'Current musician', 'Opening'), genre: 'Jazz' };
  const moreJazz = { ...song('more-jazz', 'Another jazz musician', 'Second'), genre: 'Jazz' };
  const rock = { ...song('rock', 'Rock musician', 'Third'), genre: 'Rock' };
  const h = waveHarness([[current, moreJazz, rock], []]);
  await h.api.startWave();
  h.queueRef.current = [
    current,
    moreJazz,
    { ...song('tail-jazz', 'Third jazz musician'), genre: 'Jazz' },
    rock,
  ];
  h.queueIndexRef.current = 0;
  h.api.recordWavePlayback(current, 5, 200);
  assert.equal(h.queueRef.current[0].id, current.id);
  assert.equal(h.queueRef.current[1].id, moreJazz.id);
  assert.equal(h.queueRef.current[2].id, rock.id);
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[1][3].skippedTracks[0].genre, 'Jazz');
  assert.equal(h.calls[1][3].positiveTracks.length, 0);
});

test('Successful listening adapts later music while keeping the current and announced tracks', async () => {
  const current = { ...song('current-jazz', 'Current musician', 'Opening'), genre: 'Jazz' };
  const rock = { ...song('rock', 'Rock musician', 'Second'), genre: 'Rock' };
  const jazz = { ...song('more-jazz', 'Another musician', 'Third'), genre: 'Jazz' };
  const h = waveHarness([[current, rock, jazz], []]);
  await h.api.startWave();
  // Deliberately start with the less compatible pending order to verify the reaction itself.
  h.queueRef.current = [
    current,
    rock,
    { ...song('tail-rock', 'Another rock musician'), genre: 'Rock' },
    jazz,
  ];
  h.queueIndexRef.current = 0;
  h.api.recordWavePlayback(current, 185, 200);
  assert.equal(h.queueRef.current[0].id, current.id);
  assert.equal(h.queueRef.current[1].id, rock.id);
  assert.equal(h.queueRef.current[2].id, jazz.id);
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[1][3].positiveTracks[0].genre, 'Jazz');
  assert.equal(h.calls[1][3].skippedTracks.length, 0);
});

test('Confirmed learning survives restart and reranks new artists independently of this session', async () => {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
  const anchor = { ...song('anchor', 'Anchor musician', 'Anchor song'), genre: 'Jazz' };
  const first = waveHarness([[anchor]], [], storage);
  await first.api.startWave();
  first.api.handleWaveLike(anchor);
  const rock = { ...song('rock-new', 'Rock musician', 'Rock song'), genre: 'Rock' };
  const jazz = { ...song('jazz-new', 'Jazz musician', 'Jazz song'), genre: 'Jazz' };
  const second = waveHarness([[rock, jazz]], [], storage);
  await second.api.startWave();
  assert.ok(second.calls[0][1].some((track) => track.id === 'anchor'));
  assert.equal(second.calls[0][3].learnedTracks[0].genre, 'Jazz');
  assert.equal(second.calls[0][3].positiveTracks.length, 0);
  assert.equal(second.plays[0].id, 'jazz-new');
});

test('A sequence of actual unfamiliar skips updates the next provider request with a cautious novelty reduction', async () => {
  const initial = song('known', 'Known musician', 'Known song');
  const h = waveHarness([[initial], []], [{ deezer_id: 'liked', artist: 'Known musician' }]);
  await h.api.startWave();
  for (let i = 0; i < 3; i++) {
    const skipped = song('skip-' + i, 'Unfamiliar ' + i, 'New song ' + i);
    h.queueRef.current = [skipped];
    h.queueIndexRef.current = 0;
    h.api.recordWavePlayback(skipped, 5, 200);
  }
  await h.api.fetchMoreWaveTracks();
  assert.ok(h.calls[1][3].discoveryAdjustment < 0);
  assert.ok(h.calls[1][3].discoveryAdjustment >= -0.2);
  assert.equal(h.calls[1][3].learnedTracks.length, 0);
});

test('Errors and seek-to-end transitions never train the session toward rejection', async () => {
  const current = song('current', 'Musician', 'Song');
  const h = waveHarness([[current], []]);
  await h.api.startWave();
  h.api.recordWavePlayback(current, 5, 200, 'ended');
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[1][3].skippedTracks.length, 0);
  assert.deepEqual(Object.keys(h.calls[1][3].artistFeedback), []);
  assert.equal(h.calls[1][3].discoveryAdjustment, 0);
});

test('a new session clears temporary genre and artist reactions while retaining the lasting profile', async () => {
  let now = 100000;
  const anchor = { ...song('anchor', 'Jazz musician', 'Jazz anchor'), genre: 'Jazz' };
  const next = song('next', 'Next musician', 'Next tune');
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
  const h = waveHarness([[anchor], [next]], [], storage, () => now);
  await h.api.startWave();
  h.api.handleWaveLike(anchor);
  now += WAVE_SESSION_IDLE_MS + 1;
  await h.api.startWave('chill');
  const context = h.calls[1][3];
  assert.equal(context.positiveTracks.length, 0);
  assert.equal(context.skippedTracks.length, 0);
  assert.deepEqual(Object.keys(context.artistFeedback), []);
  assert.equal(context.learnedTracks[0].id, 'anchor');
});

test('Wave source selection is applied to startup, refill, and mismatched provider results', async () => {
  const yt = (id, title) => ({ ...song('yt_' + id, 'Artist', title), source: 'youtube' });
  const h = waveHarness([
    [song('wrong', 'Wrong', 'Wrong source'), yt('start', 'Start')],
    [song('wrong-refill', 'Wrong', 'Wrong refill'), yt('next', 'Next')],
  ]);
  h.api.setWaveSource('youtube');
  await h.api.startWave();
  await h.api.fetchMoreWaveTracks();
  assert.deepEqual(
    h.calls.map((call) => call[3].source),
    ['youtube', 'youtube'],
  );
  assert.deepEqual(
    h.queueRef.current.map((track) => track.source),
    ['youtube', 'youtube'],
  );
});

test('Changing the active wave source rebuilds its queue and failed changes restore the previous source', async () => {
  const sc = song('sc-start', 'Artist A', 'First'),
    yt = { ...song('yt_second', 'Artist B', 'Second'), source: 'youtube' };
  const h = waveHarness([[sc], [yt], [], [yt]]);
  await h.api.startWave('energy');
  h.api.setWaveSource('youtube');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.calls[1][0], 'energy');
  assert.equal(h.calls[1][3].source, 'youtube');
  assert.deepEqual(
    h.queueRef.current.map((track) => track.id),
    ['yt_second'],
  );
  h.api.setWaveSource('soundcloud');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[3][3].source, 'youtube');
  assert.equal(h.queueRef.current[0].id, 'yt_second');
});

test('Listening feedback keeps the announced next wave track while learning from a skip', async () => {
  const current = song('current', 'Artist A', 'Current');
  const announced = song('announced', 'Artist A', 'Up next');
  const h = waveHarness([[current]]);
  await h.api.startWave();
  h.queueRef.current = [current, announced, song('other', 'Artist B', 'Another')];
  h.queueIndexRef.current = 0;
  h.api.recordWavePlayback(current, 5, 200);
  assert.equal(h.queueRef.current[1].id, announced.id);
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.calls[1][3].artistFeedback['artist a'], -0.6);
});

test('Background refill keeps the announced next track before newly ranked recommendations', async () => {
  const current = song('current', 'Artist A', 'Current');
  const announced = song('announced', 'Artist A', 'Up next');
  const h = waveHarness([[current], [song('new', 'Artist C', 'New discovery')]]);
  await h.api.startWave();
  h.queueRef.current = [current, announced, song('other', 'Artist B', 'Another')];
  h.queueIndexRef.current = 0;
  await h.api.fetchMoreWaveTracks();
  assert.equal(h.queueRef.current[1].id, announced.id);
  assert.ok(h.queueRef.current.some((track) => track.id === 'new'));
});
