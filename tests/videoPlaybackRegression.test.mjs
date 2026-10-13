import { extractEventRegistration, extractStatement } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import {
  VIDEO_AGE_RESTRICTED,
  getVideoPlaybackError,
  isAgeRestrictedVideo,
} from '../src/shared/utils/videoPlaybackError.ts';

test('Clip resolver preserves the verified age restriction across IPC, without redundant anonymous retries', async (t) => {
  let requests = 0;
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
    requests++;
    return Response.json({
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm your age',
        desktopLegacyAgeGateReason: 1,
      },
    });
  });
  await assert.rejects(YouTubeMusicService.resolveDirectVideoStream('agefixture1'), {
    message: VIDEO_AGE_RESTRICTED,
  });
  assert.equal(requests, 1);
  assert.equal(
    getVideoPlaybackError(
      new Error(
        "Error invoking remote method 'music:getVideoStream': Error: " + VIDEO_AGE_RESTRICTED,
      ),
    ),
    'age-restricted',
  );
  assert.equal(
    isAgeRestrictedVideo({
      status: 'LOGIN_REQUIRED',
      reason: 'Sign in to confirm you are not a bot',
    }),
    false,
  );
  assert.equal(getVideoPlaybackError(new Error('Network failed')), 'unavailable');
});

test('Clip resolver still selects a playable stream for an unrestricted clip', async (t) => {
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () =>
    Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          { url: 'https://media.example/360', mimeType: 'video/mp4', height: 360 },
          { url: 'https://media.example/720', mimeType: 'video/mp4', height: 720 },
        ],
      },
    }),
  );
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('okfixture01'),
    'https://media.example/720',
  );
});

for (const platform of ['desktop']) {
  test(`${platform} clip UI: retry uses the found ID and age gate explains the failure`, () => {
    const entry = fs.readFileSync(
      new URL(`../src/${platform}/ui/components/LyricsModal.tsx`, import.meta.url),
      'utf8',
    );
    assert.match(
      entry,
      /shared\/components\/LyricsModal/,
      'platform must use the shared karaoke implementation',
    );
    const source =
      fs.readFileSync(
        new URL('../src/shared/components/LyricsModal.tsx', import.meta.url),
        'utf8',
      ) +
      '\n' +
      fs.readFileSync(new URL('../src/shared/hooks/useLyricsVideo.ts', import.meta.url), 'utf8');
    const begin = source.indexOf('  const handleVideoToggle = () => {');
    const end = source.indexOf('  return {', begin);
    let error = 'unavailable',
      attempt = 0,
      show = false,
      toast = '',
      hint;
    const context = {
      youtubeDisabled: false,
      videoRecoveryRef: {},
      videoFreshRequestRef: {},
      activeVideoId: 'found-video',
      clipSearchStatus: 'found',
      clipPlaybackError: error,
      emitToast: (message) => (toast = message),
      currentTrack: { id: 'yt_fixture1234' },
      emitYouTubeAccessIssue: (value) => (hint = value),
      setClipPlaybackError: (value) => (error = value),
      setVideoResolveAttempt: (update) => (attempt = update(attempt)),
      setShowVideo: (value) => (show = value),
    };
    vm.runInNewContext(source.slice(begin, end) + '\nhandleVideoToggle();', context);
    assert.equal(error, null);
    assert.equal(attempt, 1);
    assert.equal(show, true);
    assert.equal(toast, '');
    vm.runInNewContext(source.slice(begin, end) + '\nhandleVideoToggle();', {
      ...context,
      clipPlaybackError: 'age-restricted',
    });
    assert.equal(hint.reason, 'age-restricted');
    assert.equal(hint.source, 'clip');
    assert.equal(hint.trackId, 'yt_fixture1234');
    assert.equal(attempt, 1, 'verified age gate should not repeat an anonymous request');
  });
  test(`${platform} clip UI: iframe error and timeout preserve the found clip for retry`, () => {
    const entry = fs.readFileSync(
      new URL(`../src/${platform}/ui/components/LyricsModal.tsx`, import.meta.url),
      'utf8',
    );
    assert.match(
      entry,
      /shared\/components\/LyricsModal/,
      'platform must use the shared karaoke implementation',
    );
    const source =
      fs.readFileSync(
        new URL('../src/shared/components/LyricsModal.tsx', import.meta.url),
        'utf8',
      ) +
      '\n' +
      fs.readFileSync(new URL('../src/shared/hooks/useLyricsVideo.ts', import.meta.url), 'utf8');
    const playerWindow = {};
    let show = true,
      error = null,
      id = 'found-video',
      status = 'found';
    const context = {
      console: { warn() {} },
      clearTimeout() {},
      videoIframeRef: { current: { contentWindow: playerWindow } },
      iframePlaybackTimerRef: { current: null },
      sendVideoCommand() {},
      setShowVideo: (value) => (show = value),
      setClipPlaybackError: (value) => (error = value),
      setActiveVideoId: (value) => (id = value),
      setClipSearchStatus: (value) => (status = value),
    };
    const registration = extractStatement(source, (text) =>
      text.startsWith("if (parsed.event === 'onError')"),
    );
    vm.runInNewContext(registration, {
      ...context,
      parsed: { event: 'onError', info: 150 },
    });
    assert.equal(show, false);
    assert.equal(error, 'unavailable');
    assert.equal(id, 'found-video');
    assert.equal(status, 'found');
    show = true;
    error = null;
    const timerStart = source.indexOf('iframePlaybackTimerRef.current = setTimeout(() => {');
    const timerEnd = source.indexOf('    }, 15000);', timerStart);
    const body = source.slice(source.indexOf('{', timerStart) + 1, timerEnd);
    vm.runInNewContext(body, context);
    assert.equal(show, false);
    assert.equal(error, 'unavailable');
    assert.equal(id, 'found-video');
    assert.equal(status, 'found');
  });
}

test('Clips prefer the connected account over anonymous age-gated requests and cache the result', async (t) => {
  let accountRequests = 0,
    anonymousRequests = 0;
  YouTubeMusicService.setAccountVideoResolver(async () => {
    accountRequests++;
    return { url: 'https://rr1.googlevideo.com/manifest/hls_playlist/clip.m3u8' };
  });
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
    anonymousRequests++;
    assert.fail('A working authenticated clip must not use anonymous transport');
  });
  assert.match(await YouTubeMusicService.resolveDirectVideoStream('accountvid1'), /clip.m3u8/);
  assert.match(await YouTubeMusicService.resolveDirectVideoStream('accountvid1'), /clip.m3u8/);
  assert.equal(accountRequests, 1);
  assert.equal(anonymousRequests, 0);
});

test('An account age denial stays explicit; connecting another account invalidates cached video URLs', async (t) => {
  t.mock.method(
    YouTubeMusicTransport,
    'fetch',
    async () =>
      new Response(new Uint8Array([0, 0, 0, 1]), {
        status: 206,
        headers: { 'content-type': 'video/mp4' },
      }),
  );
  YouTubeMusicService.setAccountVideoResolver(async () => {
    throw new Error('YOUTUBE_AUDIO_AGE_RESTRICTED');
  });
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  await assert.rejects(YouTubeMusicService.resolveDirectVideoStream('accountage1'), {
    message: VIDEO_AGE_RESTRICTED,
  });
  YouTubeMusicService.setAccountVideoResolver(async () => ({
    url: 'https://rr1.googlevideo.com/new-account.mp4',
  }));
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('accountage1'),
    'https://rr1.googlevideo.com/new-account.mp4',
  );
});

test('Disconnecting while a clip is resolving cannot cache an old account URL', async (t) => {
  let resolve;
  YouTubeMusicService.setAccountVideoResolver(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  const pending = YouTubeMusicService.resolveDirectVideoStream('staleclip01');
  YouTubeMusicService.setAccountVideoResolver(null);
  resolve({ url: 'https://rr1.googlevideo.com/old-account.mp4' });
  assert.equal(await pending, '');
  assert.equal(YouTubeMusicService.videoStreamCache.size, 0);
});

test('Failed cached clip URLs can be refreshed, while prefetch and initial playback share a request', async (t) => {
  t.mock.method(
    YouTubeMusicTransport,
    'fetch',
    async () =>
      new Response(new Uint8Array([0, 0, 0, 1]), {
        status: 206,
        headers: { 'content-type': 'video/mp4' },
      }),
  );
  let calls = 0,
    finish;
  YouTubeMusicService.setAccountVideoResolver(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  const a = YouTubeMusicService.resolveDirectVideoStream('retryclip01'),
    b = YouTubeMusicService.resolveDirectVideoStream('retryclip01');
  assert.equal(calls, 1);
  finish({ url: 'https://rr1.googlevideo.com/old.mp4' });
  assert.equal(await a, await b);
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('retryclip01'),
    'https://rr1.googlevideo.com/old.mp4',
  );
  assert.equal(calls, 1);
  const fresh = YouTubeMusicService.resolveDirectVideoStream('retryclip01', false, true);
  assert.equal(calls, 2);
  finish({ url: 'https://rr1.googlevideo.com/fresh.mp4' });
  assert.equal(await fresh, 'https://rr1.googlevideo.com/fresh.mp4');
});
test('A late failed attempt cannot overwrite a forced new clip or return stale URLs to waiting callers', async (t) => {
  t.mock.method(
    YouTubeMusicTransport,
    'fetch',
    async () =>
      new Response(new Uint8Array([0, 0, 0, 1]), {
        status: 206,
        headers: { 'content-type': 'video/mp4' },
      }),
  );
  const finishes = [];
  YouTubeMusicService.setAccountVideoResolver(
    () => new Promise((resolve) => finishes.push(resolve)),
  );
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  const old = YouTubeMusicService.resolveDirectVideoStream('raceclip001'),
    shared = YouTubeMusicService.resolveDirectVideoStream('raceclip001');
  const fresh = YouTubeMusicService.resolveDirectVideoStream('raceclip001', false, true);
  assert.equal(finishes.length, 2);
  finishes[1]({ url: 'https://rr1.googlevideo.com/fresh.mp4' });
  assert.equal(await fresh, 'https://rr1.googlevideo.com/fresh.mp4');
  finishes[0]({ url: 'https://rr1.googlevideo.com/stale.mp4' });
  assert.equal(await old, '');
  assert.equal(await shared, '');
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('raceclip001'),
    'https://rr1.googlevideo.com/fresh.mp4',
  );
});

test('YouTube iframe readiness receives the latest audio position and playback state', () => {
  const source = fs.readFileSync(
    new URL('../src/shared/hooks/useLyricsVideo.ts', import.meta.url),
    'utf8',
  );
  const registration = extractStatement(source, (text) =>
    text.startsWith("if (parsed.event === 'onReady')"),
  );
  const commands = [];
  const ref = { current: { time: 41, playing: true, enabled: true } };
  const invoke = () =>
    vm.runInNewContext(registration, {
      parsed: { event: 'onReady' },
      clipPlaybackStateRef: ref,
      sendVideoCommand: (name, args) => commands.push({ name, args }),
    });
  invoke();
  assert.equal(commands.find((c) => c.name === 'seekTo').args[0], 41);
  assert.ok(commands.some((c) => c.name === 'playVideo'));
  assert.ok(commands.some((c) => c.name === 'mute'));
  commands.length = 0;
  ref.current = { time: 55, playing: false, enabled: true };
  invoke();
  assert.ok(commands.some((c) => c.name === 'pauseVideo'));
  assert.equal(commands.find((c) => c.name === 'seekTo').args[0], 55);
});

test('Actual preload and main video IPC pass force-refresh to the resolver', async () => {
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const { stripTypeScriptTypes } = await import('node:module');
  const main = fs.readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');
  const registration = extractEventRegistration(main, 'music:getVideoStream');
  let listener;
  const resolved = [];
  vm.runInNewContext(stripTypeScriptTypes(registration), {
    ipcMain: {
      handle(_channel, fn) {
        listener = fn;
      },
    },
    YouTubeMusicService: {
      resolveDirectVideoStream(...args) {
        resolved.push(args);
        return Promise.resolve('stream');
      },
    },
  });
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../src/desktop/preload/index.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  let api;
  const context = {
    module: { exports: {} },
    exports: {},
    require: () => ({
      contextBridge: {
        exposeInMainWorld(_name, value) {
          api = value;
        },
      },
      ipcRenderer: {
        invoke(channel, ...args) {
          assert.equal(channel, 'music:getVideoStream');
          return listener({}, ...args);
        },
      },
    }),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  await api.getVideoStream('retryclip01', { forceRefresh: true });
  assert.deepEqual(resolved[0], ['retryclip01', false, true]);
  await api.getVideoStream('retryclip01');
  assert.deepEqual(resolved[1], ['retryclip01', false, false]);
  assert.equal(await api.getVideoStream('../file', { forceRefresh: true }), '');
  assert.equal(resolved.length, 2);
});

test('An authenticated video address rejected by the CDN falls back before caching or showing it', async (t) => {
  let probes = 0,
    anonymous = 0;
  YouTubeMusicService.setAccountVideoResolver(async () => ({
    url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
  }));
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  t.mock.method(YouTubeMusicTransport, 'fetch', async (url, options) => {
    probes++;
    assert.equal(options.headers.Range, 'bytes=0-1023');
    assert.equal(options.cache, 'no-store');
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  });
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
    anonymous++;
    return Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        formats: [
          { url: 'https://rr2.googlevideo.com/working.mp4', mimeType: 'video/mp4', height: 360 },
        ],
      },
    });
  });
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('cdnfail0001'),
    'https://rr2.googlevideo.com/working.mp4',
  );
  assert.equal(probes, 1);
  assert.equal(anonymous, 1);
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('cdnfail0001'),
    'https://rr2.googlevideo.com/working.mp4',
  );
  assert.equal(
    probes,
    1,
    'Cache contains the working fallback, never the rejected account address',
  );
});

test('A playable account clip is probed once and a full-file response is canceled after its first chunk', async (t) => {
  let canceled = 0,
    probes = 0;
  YouTubeMusicService.setAccountVideoResolver(async () => ({
    url: 'https://rr1.googlevideo.com/probe.mp4',
  }));
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  t.mock.method(YouTubeMusicTransport, 'fetch', async () => {
    probes++;
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([0, 0, 0, 1]));
        },
        cancel() {
          canceled++;
        },
      }),
      { status: 200, headers: { 'content-type': 'video/mp4' } },
    );
  });
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () =>
    assert.fail('Verified account video must keep priority'),
  );
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('goodprobe01'),
    'https://rr1.googlevideo.com/probe.mp4',
  );
  assert.equal(
    await YouTubeMusicService.resolveDirectVideoStream('goodprobe01'),
    'https://rr1.googlevideo.com/probe.mp4',
  );
  assert.equal(canceled, 1);
  assert.equal(probes, 1);
});
test('An account change during CDN validation discards the previous account result', async (t) => {
  let finish;
  YouTubeMusicService.setAccountVideoResolver(async () => ({
    url: 'https://rr1.googlevideo.com/old.mp4',
  }));
  t.after(() => YouTubeMusicService.setAccountVideoResolver(null));
  t.mock.method(
    YouTubeMusicTransport,
    'fetch',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = YouTubeMusicService.resolveDirectVideoStream('probechange');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finish, 'function');
  YouTubeMusicService.setAccountVideoResolver(null);
  finish(
    new Response(new Uint8Array([1]), { status: 206, headers: { 'content-type': 'video/mp4' } }),
  );
  assert.equal(await pending, '');
  assert.equal(YouTubeMusicService.videoStreamCache.size, 0);
});

for (const [reason, code, expected] of [
  ['Sign in to confirm you are not a bot', 'YOUTUBE_VIDEO_BOT_CHECK', 'verification-required'],
  ['Please sign in', 'YOUTUBE_VIDEO_LOGIN_REQUIRED', 'sign-in-required'],
]) {
  test('Clip access cause survives anonymous retry and IPC: ' + expected, async (t) => {
    YouTubeMusicService.setAccountVideoResolver(null);
    let calls = 0;
    t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
    t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
      calls++;
      return Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason } });
    });
    await assert.rejects(
      YouTubeMusicService.resolveDirectVideoStream(
        expected === 'verification-required' ? 'hintbot0001' : 'hintlogin01',
      ),
      { message: code },
    );
    assert.equal(calls, 2, 'The access hint appears after the existing bounded retry');
    assert.equal(
      getVideoPlaybackError(
        new Error("Error invoking remote method 'music:getVideoStream': Error: " + code),
      ),
      expected,
    );
  });
}
