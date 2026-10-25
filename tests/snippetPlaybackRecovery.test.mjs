import test from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime } from './helpers/hookRuntime.mjs';
import { isPlayableDirectAudioUrl } from '../src/shared/utils/audioUrlValidator.ts';
import { getSnippetProgressState } from '../src/shared/utils/snippetProgress.ts';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const song = (id = '2057796724', source = 'soundcloud') => ({
  id,
  title: 'Fixture',
  source,
  duration: 232,
  artist: { name: 'Artist' },
  album: {},
  preview: '',
});
function fixture(
  resolve = async () => 'https://playback.media-streaming.soundcloud.cloud/fresh/playlist.m3u8',
) {
  const requests = [],
    loads = [],
    toasts = [],
    events = [],
    cache = new Map();
  const equalizer = { attached: [], released: [] };
  class AudioFixture extends EventTarget {
    src = '';
    currentTime = 0;
    readyState = 0;
    paused = true;
    error = null;
    volume = 0;
    preload = '';
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
    play() {
      this.paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    }
    load() {}
    removeAttribute() {
      this.src = '';
    }
  }
  const audio = new AudioFixture(),
    requestRef = { current: 0 };
  const bindings = {
    '../services/audioEqualizer': {
      audioEqualizer: () => ({
        attach: (audio) => equalizer.attached.push(audio),
        release: (audio) => equalizer.released.push(audio),
      }),
    },
    './useYouTubeAvailability': { useYouTubeAvailability: () => false },
    '../services/youtubeAvailability.ts': { isYouTubeItemDisabled: () => false },
    'hls.js': { __esModule: true, default: class {} },
    '../utils/formatters': { detectTrackSource: (t) => t.source },
    '../bridge/platformBridge': {
      platformBridge: {
        getFullStreamUrl: (track, options, signal) => {
          requests.push({ track, options, signal });
          return resolve(track, options, signal);
        },
      },
    },
    '../utils/audioUrlValidator': { isPlayableDirectAudioUrl },
    '../utils/snippetProgress': { getSnippetProgressState },
    '../services/playerStreamResolution': {
      source: new URL('../src/shared/services/playerStreamResolution.ts', import.meta.url),
    },
    '../utils/streamResolveDeadline.ts': {
      source: new URL('../src/shared/utils/streamResolveDeadline.ts', import.meta.url),
    },
    '../services/playbackLogger': {
      PlaybackLogger: {
        info: (...args) => events.push(args),
        warn: (...args) => events.push(args),
      },
    },
    '../context/ToastContext': { emitToast: (...args) => toasts.push(args) },
    '../context/audioTypes': {
      SNIPPET_DURATION: 10,
      DEFAULT_TRACK_DURATION: 180,
      STREAM_URL_MAX_AGE_MS: 420000,
    },
  };
  const props = {
    volume: 0.6,
    isMuted: false,
    onPauseMainAudio: () => events.push('main-paused'),
    resolvedStreamCache: { current: cache },
    streamRequestIdRef: requestRef,
    loadStreamIntoAudio: (element, hls, url, start, snippet, id, bypass, owner) => {
      element.src = url;
      element.currentTime = start;
      loads.push({ element, hls, url, start, snippet, id, bypass, owner });
    },
  };
  const h = hookRuntime(
    new URL('../src/shared/hooks/useSnippetController.ts', import.meta.url),
    bindings,
    {
      Audio: class {
        constructor() {
          return audio;
        }
      },
      AbortSignal,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
    },
  );
  h.render(props);
  return { h, props, audio, requests, loads, toasts, events, cache, requestRef, equalizer };
}
test('SoundCloud snippets resolve a fresh URL even while the generic cache still considers the rejected link valid', async () => {
  const f = fixture(),
    track = song();
  f.cache.set(track.id, {
    url: 'https://playback.media-streaming.soundcloud.cloud/expired/playlist.m3u8',
    timestamp: Date.now(),
  });
  f.h.api().previewSnippet(track);
  await f.h.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.forceRefresh, true);
  assert.equal(f.requests[0].track.id, track.id);
  assert.equal(f.loads.length, 1);
  assert.equal(f.loads[0].start, 111);
  assert.equal(f.loads[0].id, track.id);
  assert.equal(f.loads[0].snippet, true);
  assert.equal(f.loads[0].bypass, true);
  assert.ok(f.loads[0].owner.isCurrent());
  assert.ok(f.loads[0].url.includes('/fresh/'));
  f.h.unmount();
});
test('Repeated snippet manifest failures refresh once in an alternate rendition without changing the main queue', async () => {
  const f = fixture();
  f.h.api().previewSnippet(song());
  await f.h.flush();
  const first = f.loads[0].owner;
  first.onFailure('network');
  first.onFailure('network');
  await f.h.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].options.forceRefresh, true);
  assert.equal(f.requests[1].options.preferAlternateFormat, true);
  first.onFailure('network');
  assert.equal(f.requests.length, 2);
  f.loads[1].owner.onFailure('network');
  await f.h.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.h.api().isSnippetPlaying, false);
  assert.equal(f.toasts.length, 1);
  assert.equal(f.h.api().snippetTrack.id, '2057796724');
  assert.equal(f.events.filter((e) => e === 'main-paused').length, 1);
  f.h.unmount();
});
test('Closing or replacing a snippet cancels its pending lookup and cannot cache/play a late answer', async () => {
  for (const action of ['close', 'replace']) {
    const pending = deferred(),
      f = fixture((track) =>
        track.id === 'old' ? pending.promise : Promise.resolve('https://cdn.sndcdn.com/new.mp3'),
      );
    f.h.api().previewSnippet(song('old'));
    await f.h.flush();
    if (action === 'close') f.h.api().stopSnippet();
    else f.h.api().previewSnippet(song('new'));
    pending.resolve('https://cdn.sndcdn.com/obsolete.mp3');
    await f.h.flush();
    assert.equal(f.requests[0].signal.aborted, true);
    assert.equal(f.cache.has('old'), false);
    assert.ok(f.loads.every((l) => l.id !== 'old'));
    if (action === 'close') assert.equal(f.h.api().snippetTrack, null);
    else assert.equal(f.h.api().snippetTrack.id, 'new');
    f.h.unmount();
  }
});
test('Pausing a pending snippet prevents delayed playback and resume gets a usable fresh source', async () => {
  const pending = deferred();
  let calls = 0;
  const f = fixture(() =>
    ++calls === 1 ? pending.promise : Promise.resolve('https://cdn.sndcdn.com/fresh.mp3'),
  );
  f.h.api().previewSnippet(song());
  await f.h.flush();
  f.h.api().toggleSnippetPlay();
  await f.h.flush();
  pending.resolve('https://cdn.sndcdn.com/paused.mp3');
  await f.h.flush();
  assert.equal(f.loads.length, 0);
  f.h.api().toggleSnippetPlay();
  await f.h.flush();
  assert.equal(f.loads.length, 1);
  assert.equal(f.requests.length, 2);
  f.h.unmount();
});
test('An HLS callback arriving after pause or close cannot launch snippet recovery', async () => {
  const f = fixture();
  f.h.api().previewSnippet(song());
  await f.h.flush();
  const owner = f.loads[0].owner;
  f.h.api().toggleSnippetPlay();
  await f.h.flush();
  assert.equal(owner.isCurrent(), false);
  owner.onFailure('network');
  assert.equal(f.requests.length, 1);
  f.h.api().stopSnippet();
  owner.onFailure('network');
  assert.equal(f.requests.length, 1);
  assert.equal(owner.signal.aborted, true);
  f.h.unmount();
});
test('Snippet teardown and provider deadlines cancel work without a late state update', async () => {
  for (const action of ['unmount', 'deadline']) {
    const pending = deferred(),
      f = fixture(() => pending.promise);
    f.h.api().previewSnippet(song());
    await f.h.flush();
    if (action === 'unmount') f.h.unmount();
    else {
      f.h.fireTimers(30000);
      await f.h.flush();
      assert.equal(f.h.api().isSnippetPlaying, false);
      assert.equal(f.toasts.length, 1);
    }
    assert.equal(f.requests[0].signal.aborted, true);
    pending.resolve('https://cdn.sndcdn.com/late.mp3');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.loads.length, 0);
    assert.equal(f.h.lateUpdates(), 0);
    f.h.unmount();
  }
});
test('A manual retry after snippet recovery is exhausted starts a new bounded attempt', async () => {
  const f = fixture();
  f.h.api().previewSnippet(song());
  await f.h.flush();
  f.loads[0].owner.onFailure('network');
  await f.h.flush();
  f.loads[1].owner.onFailure('network');
  await f.h.flush();
  f.h.api().toggleSnippetPlay();
  await f.h.flush();
  assert.equal(f.requests.length, 3);
  assert.equal(f.loads.length, 3);
  assert.equal(f.requests[2].options.preferAlternateFormat, false);
  f.h.unmount();
});
test('Healthy cached YouTube snippets keep instant playback, volume and ten-second seeking', async () => {
  const f = fixture(),
    track = song('yt_fixture', 'youtube');
  f.cache.set(track.id, {
    url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
    timestamp: Date.now(),
  });
  f.h.api().previewSnippet(track);
  await f.h.flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.loads[0].start, 111);
  assert.equal(f.audio.volume, 0.6);
  f.h.api().seekSnippet(0.5);
  await f.h.flush();
  assert.equal(f.audio.currentTime, 116);
  assert.equal(f.h.api().snippetProgress, 0.5);
  f.audio.readyState = 4;
  await f.audio.play();
  await f.h.flush();
  f.h.api().toggleSnippetPlay();
  await f.h.flush();
  assert.equal(f.audio.paused, true);
  f.h.api().toggleSnippetPlay();
  await f.h.flush();
  assert.equal(f.audio.paused, false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.audio.currentTime, 116);
  f.h.unmount();
});
test('Rate-limited snippet playback stops automatic retries', async () => {
  const f = fixture();
  f.h.api().previewSnippet(song());
  await f.h.flush();
  f.loads[0].owner.onFailure('rate-limit');
  await f.h.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.toasts.length, 1);
  f.h.unmount();
});

test('A delayed manual play promise cannot change snippet state after close or teardown', async () => {
  const f = fixture(),
    track = song('yt_resume', 'youtube');
  f.cache.set(track.id, {
    url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
    timestamp: Date.now(),
  });
  f.h.api().previewSnippet(track);
  await f.h.flush();
  f.audio.readyState = 4;
  await f.audio.play();
  await f.h.flush();
  f.h.api().toggleSnippetPlay();
  await f.h.flush();
  const pending = deferred();
  f.audio.play = () => pending.promise;
  f.h.api().toggleSnippetPlay();
  f.h.api().stopSnippet();
  f.h.unmount();
  pending.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.h.lateUpdates(), 0);
});

test('Snippet equalizer remains attached across preview stops and releases on teardown', async () => {
  const f = fixture();
  assert.deepEqual(f.equalizer.attached, [f.audio]);
  f.h.api().previewSnippet(song());
  await f.h.flush();
  f.h.api().stopSnippet();
  f.h.render(f.props);
  f.h.api().previewSnippet(song('another'));
  await f.h.flush();
  assert.equal(f.equalizer.attached.length, 1);
  assert.equal(f.equalizer.released.length, 0);
  f.h.unmount();
  assert.deepEqual(f.equalizer.released, [f.audio]);
});
