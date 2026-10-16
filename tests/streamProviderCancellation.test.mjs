import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as context from '../src/desktop/main/services/streamResolveContext.ts';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const failure = (error) =>
  /STREAM_RATE_LIMITED/.test(String(error?.message))
    ? 'rate-limit'
    : /STREAM_PROVIDER_UNAVAILABLE/.test(String(error?.message))
      ? 'provider'
      : null;
const errorFor = (kind) =>
  new Error(kind === 'rate-limit' ? 'STREAM_RATE_LIMITED' : 'STREAM_PROVIDER_UNAVAILABLE');
function load(file, name, dependencies = {}) {
  const raw = fs.readFileSync(
    new URL('../src/desktop/main/services/' + file, import.meta.url),
    'utf8',
  );
  let source = stripTypeScriptTypes(raw, { mode: 'strip' })
    .replace(/^import[\s\S]*?;\s*/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*/gm, '')
    .replace(/^export /gm, '')
    .replaceAll('import.meta', '({env:{}})');
  const globals = {
    ...context,
    AbortSignal,
    AbortController,
    Request,
    Response,
    Headers,
    URL,
    Buffer,
    Date,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    console: { warn() {}, debug() {}, error() {} },
    PlaybackLogger: logger,
    BoundedMap: class extends Map {
      constructor() {
        super();
      }
    },
    getStreamResolveFailure: failure,
    createStreamResolveError: errorFor,
    streamHttpFailure: (status) =>
      status === 429 ? 'rate-limit' : status >= 500 ? 'provider' : null,
    ...dependencies,
  };
  return vm.runInNewContext(source + '\n;' + name, globals, { filename: file });
}
const track = {
  id: 'sc_7',
  source: 'soundcloud',
  title: 'test',
  artist: { name: 'artist' },
  preview: 'https://cdn.example/direct.mp3',
};

test('SoundCloud cancellation during metadata neither returns legacy fallback nor writes unavailable/URL caches', async () => {
  const sc = load('soundcloud.ts', 'SoundCloudService', {
    isSoundCloudRestrictedTrack: () => false,
    isFullSoundCloudTranscoding: () => true,
    isSoundCloudPreviewUrl: () => false,
    isYouTubeAudioStreamUrl: () => false,
  });
  const c = new AbortController(),
    entered = deferred(),
    latch = deferred();
  let keySignal,
    calls = 0;
  sc.getSoundCloudKey = async () => {
    keySignal = context.currentStreamResolveSignal();
    return 'synthetic-key';
  };
  sc.fetchWithRelay = async () => {
    calls++;
    entered.resolve();
    return latch.promise;
  };
  const task = context.runStreamResolve(c.signal, () => sc.getFullStreamUrl(track));
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await entered.promise;
  c.abort();
  await rejected;
  latch.resolve({ id: 7, media: { transcodings: [] } });
  await Promise.resolve();
  assert.equal(keySignal, undefined);
  assert.equal(calls, 1);
  assert.equal(sc.streamCache.size, 0);
  assert.equal(sc.unavailableStreams.size, 0);
});
test('SoundCloud cancellation at a transcoding does not try the next rendition or preview endpoint', async () => {
  const sc = load('soundcloud.ts', 'SoundCloudService', {
    isSoundCloudRestrictedTrack: () => false,
    isFullSoundCloudTranscoding: () => true,
    isSoundCloudPreviewUrl: () => false,
    isYouTubeAudioStreamUrl: () => false,
  });
  const c = new AbortController(),
    entered = deferred(),
    latch = deferred();
  let calls = 0;
  sc.getSoundCloudKey = async () => '';
  sc.fetchWithRelay = async () => {
    calls++;
    if (calls === 1)
      return {
        id: 7,
        media: {
          transcodings: [
            {
              url: 'https://api-v2.soundcloud.com/media/first',
              format: { protocol: 'progressive' },
            },
            { url: 'https://api-v2.soundcloud.com/media/second', format: { protocol: 'hls' } },
          ],
        },
      };
    entered.resolve();
    return latch.promise;
  };
  const task = context.runStreamResolve(c.signal, () => sc.getFullStreamUrl(track));
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await entered.promise;
  c.abort();
  await rejected;
  latch.resolve({ url: 'https://cdn.example/obsolete.mp3' });
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(sc.streamCache.size, 0);
});
test('SoundCloud refresh-key wait is detached and cancellation prevents recursive transport/relay', async () => {
  const transport = load('soundcloudTransport.ts', 'SoundCloudTransport', {
    requestSignal: (signal, timeout) => signal || AbortSignal.timeout(timeout),
    withSoundCloudClientId: (url) => url,
    streamTransportFailure: () => 'network',
  });
  const c = new AbortController(),
    entered = deferred(),
    latch = deferred();
  let calls = 0,
    keySignal;
  transport.fetch = async () => {
    calls++;
    return new Response(null, { status: 401 });
  };
  const task = context.runStreamResolve(c.signal, () =>
    transport.fetchJson(
      'https://api-v2.soundcloud.com/tracks/7',
      'https://relay.example/',
      async () => {
        keySignal = context.currentStreamResolveSignal();
        entered.resolve();
        return latch.promise;
      },
      false,
      true,
      true,
    ),
  );
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await entered.promise;
  c.abort();
  await rejected;
  latch.resolve('new-key');
  await Promise.resolve();
  assert.equal(keySignal, undefined);
  assert.equal(calls, 1);
});
function account(transport) {
  const Service = load('youtubeAccount.ts', 'YouTubeAccountService', {
    YOUTUBE_ACCOUNT_USER_AGENT: 'test-agent',
    getYouTubeAudioAccessError: () => null,
    YOUTUBE_AUDIO_LOGIN_REQUIRED: 'LOGIN',
    isYouTubeStreamUrl: (url) => url.startsWith('https://rr1.googlevideo.com/'),
    desktopProviderFetch: (url, init, fetcher) => fetcher(url, init),
    electronFetch: transport,
    discardYouTubeResponse: async (response) => {
      await response.body?.cancel();
    },
  });
  const service = Object.create(Service.prototype);
  Object.assign(service, {
    cookieHeader: 'synthetic',
    epoch: 1,
    accountSession: {},
    preferredWatchUntil: 0,
    lastFailedMedia: null,
    sessionError: '',
    refreshError: '',
    onChange() {
      throw Error('cancel must not change login UI');
    },
  });
  return service;
}
test('signed account transport honors Request.signal, not just init.signal', async () => {
  const c = new AbortController(),
    entered = deferred(),
    latch = deferred();
  let received;
  const service = account(async (_url, init) => {
    received = init.signal;
    entered.resolve();
    return latch.promise;
  });
  const request = new Request('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    body: '{}',
    signal: c.signal,
  });
  const task = service.fetch(request);
  await entered.promise;
  assert.equal(received.aborted, false);
  c.abort();
  assert.equal(received.aborted, true);
  latch.resolve(Response.json({}));
  await task;
});
test('account resolve cancellation reaches its signed POST without cancelling bootstrap or marking account failed', async () => {
  const c = new AbortController(),
    entered = deferred(),
    latch = deferred();
  let received, bootstrapSignal;
  const service = account(async (_url, init) => {
    received = init.signal;
    entered.resolve();
    return latch.promise;
  });
  service.refreshCookies = async () => {};
  service.getClient = async () => {
    bootstrapSignal = context.currentStreamResolveSignal();
    return {
      session: { player: {} },
      getBasicInfo: async () =>
        service.fetch(
          new Request('https://www.youtube.com/youtubei/v1/player', { method: 'POST', body: '{}' }),
        ),
    };
  };
  const task = context.runStreamResolve(c.signal, () => service.resolve('recording', {}));
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await entered.promise;
  c.abort();
  await rejected;
  assert.equal(received.aborted, true);
  assert.equal(bootstrapSignal, undefined);
  assert.equal(service.lastFailedMedia, null);
  assert.equal(service.preferredWatchUntil, 0);
  latch.resolve(Response.json({}));
});
test('YouTube account cancellation never starts anonymous playback or poisons stream/access/gain caches', async () => {
  const entered = deferred(),
    latch = deferred(),
    c = new AbortController();
  let anonymous = 0;
  const yt = load('youtubeMusic.ts', 'YouTubeMusicService', {
    getYouTubeAudioAccessError: () => null,
    YouTubeMusicTransport: {
      postPlayer: async () => {
        anonymous++;
        throw Error('must not fallback');
      },
    },
    sharedStreamResolver: { invalidate() {} },
    selectYouTubeAudioFormat: (formats) => formats[0],
  });
  yt.accountResolver = async () => {
    entered.resolve();
    return latch.promise;
  };
  const task = context.runStreamResolve(c.signal, () =>
    yt.resolveDirectAudioStream('recording', false, false, { allowSessionRecovery: true }),
  );
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await entered.promise;
  c.abort();
  await rejected;
  latch.resolve({ url: 'https://rr1.googlevideo.com/videoplayback', duration: 99, gainDb: -3 });
  await Promise.resolve();
  assert.equal(anonymous, 0);
  assert.equal(yt.streamCache.size, 0);
  assert.equal(yt.audioAccessFailures.size, 0);
  assert.equal(yt.recordingGain.size, 0);
});
test('YouTube account rate limit is retained as a transport error with no anonymous request', async () => {
  let anonymous = 0;
  const yt = load('youtubeMusic.ts', 'YouTubeMusicService', {
    getYouTubeAudioAccessError: () => null,
    YouTubeMusicTransport: {
      postPlayer: async () => {
        anonymous++;
      },
    },
    sharedStreamResolver: { invalidate() {} },
  });
  yt.accountResolver = async () => {
    throw errorFor('rate-limit');
  };
  await assert.rejects(
    yt.resolveDirectAudioStream('recording', false, false, {}),
    /STREAM_RATE_LIMITED/,
  );
  assert.equal(anonymous, 0);
});
test('media probe caller cancellation is not converted into a network/CDN failure', async () => {
  const c = new AbortController(),
    entered = deferred(),
    latch = deferred();
  let cancelled = 0,
    received;
  const probe = load('youtubeMediaProbe.ts', 'probeYouTubeMedia', {
    youtubeAccountMediaUserAgent: () => '',
    isYouTubeStreamUrl: () => true,
    YouTubeMusicTransport: {
      fetch: async (_url, init) => {
        received = init.signal;
        return {
          status: 206,
          headers: new Headers({ 'content-type': 'audio/mp4' }),
          body: {
            getReader: () => ({
              read: () => {
                entered.resolve();
                return latch.promise;
              },
              cancel: async () => {
                cancelled++;
              },
            }),
          },
        };
      },
    },
  });
  const task = context.runStreamResolve(c.signal, () =>
    probe('https://rr1.googlevideo.com/videoplayback', 'audio'),
  );
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await entered.promise;
  c.abort();
  await rejected;
  assert.equal(received.aborted, true);
  assert.equal(cancelled, 1);
  latch.resolve({ done: false, value: new Uint8Array([1]) });
});

test('actual bridge/main handler/pool/aggregator/SoundCloud transport chain aborts only after its last renderer owner leaves', async () => {
  const { EventEmitter } = await import('node:events');
  const { SharedStreamResolver } =
    await import('../src/desktop/main/services/sharedStreamResolver.ts');
  const { StreamRequestRegistry } =
    await import('../src/desktop/main/services/streamRequestRegistry.ts');
  const { invokeStreamRequest } = await import('../src/shared/utils/streamRequest.ts');
  const entered = deferred(),
    latch = deferred();
  let calls = 0,
    mediaSignal;
  const transport = load('soundcloudTransport.ts', 'SoundCloudTransport', {
    requestSignal: (signal, timeout) =>
      signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    withSoundCloudClientId: (url) => url,
    streamTransportFailure: () => 'network',
    desktopFetch: async (_url, init) => {
      calls++;
      if (calls === 1)
        return Response.json({
          id: 7,
          media: {
            transcodings: [
              {
                url: 'https://api-v2.soundcloud.com/media/first',
                format: { protocol: 'progressive' },
              },
            ],
          },
        });
      mediaSignal = init.signal;
      entered.resolve();
      return latch.promise;
    },
  });
  const sc = load('soundcloud.ts', 'SoundCloudService', {
    SoundCloudTransport: transport,
    isSoundCloudRestrictedTrack: () => false,
    isFullSoundCloudTranscoding: () => true,
    isSoundCloudPreviewUrl: () => false,
    isYouTubeAudioStreamUrl: () => false,
  });
  sc.getSoundCloudKey = async () => 'synthetic-key';
  const aggregator = load('musicAggregator.ts', 'MusicAggregatorService', {
    SoundCloudService: sc,
  });
  const handlers = new Map(),
    registry = new StreamRequestRegistry(),
    pool = new SharedStreamResolver();
  const main = fs.readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');
  const fragment = main.slice(
    main.indexOf("  ipcMain.handle('music:cancelStreamResolve'"),
    main.indexOf("  ipcMain.handle('playlist:readExternal'"),
  );
  assert.match(fragment, /sharedStreamResolver\.resolve/);
  vm.runInNewContext(stripTypeScriptTypes(fragment, { mode: 'strip' }), {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    streamRequestRegistry: registry,
    sharedStreamResolver: pool,
    MusicAggregatorService: aggregator,
  });
  const a = Object.assign(new EventEmitter(), { isDestroyed: () => false }),
    b = Object.assign(new EventEmitter(), { isDestroyed: () => false }),
    ca = new AbortController(),
    cb = new AbortController();
  const request = (owner, options, c) =>
    invokeStreamRequest(
      (id) => handlers.get('music:getFullStreamUrl')({ sender: owner }, track, options, id),
      (id) => handlers.get('music:cancelStreamResolve')({ sender: owner }, id),
      c.signal,
    );
  const first = request(a, {}, ca),
    rejectedA = assert.rejects(first, { name: 'AbortError' });
  await entered.promise;
  const second = request(b, { allowSessionRecovery: true }, cb),
    rejectedB = assert.rejects(second, { name: 'AbortError' });
  ca.abort();
  await rejectedA;
  assert.equal(mediaSignal.aborted, false);
  assert.equal(calls, 2);
  cb.abort();
  await rejectedB;
  assert.equal(mediaSignal.aborted, true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sc.streamCache.size, 0);
  assert.equal(sc.unavailableStreams.size, 0);
  assert.equal(a.listenerCount('destroyed'), 0);
  assert.equal(b.listenerCount('destroyed'), 0);
  latch.resolve(Response.json({ url: 'https://cdn.example/obsolete.mp3' }));
});
