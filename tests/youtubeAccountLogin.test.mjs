import test from 'node:test';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  allowedYouTubeLoginUrl,
  youtubeLoginHost,
} from '../src/desktop/main/services/youtubeAccountNavigation.ts';

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../src/desktop/main/services/youtubeAccount.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['electron', 'youtubei.js'],
  plugins: [
    {
      name: 'fixture-logger',
      setup(builder) {
        builder.onLoad({ filter: /playbackLogger\.ts$/ }, () => ({
          contents: 'export const PlaybackLogger = globalThis.fixtureLogger;',
          loader: 'js',
        }));
      },
    },
  ],
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t) {
  const windows = [],
    logs = [];
  let cookies = [],
    loadError = null,
    changes = 0,
    connections = 0;
  let transport = async () => assert.fail('Account tests must supply an offline transport');
  let watchTransport = async () => new Response('', { status: 404 });
  const accountTransport = (input, init) =>
    new URL(input).pathname === '/watch' ? watchTransport(input, init) : transport(input, init);
  let mediaTransport = async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: { 'content-type': 'video/mp4' },
    });
  const jar = new EventEmitter();
  jar.get = async () => cookies;
  jar.flushStore = async () => {};
  const browser = {
    fetch: (input, init) => accountTransport(input, init),
    cookies: jar,
    async clearStorageData(options) {
      if (!options?.storages?.every((storage) => storage === 'cachestorage')) cookies = [];
    },
    async clearCache() {},
    async forceReloadProxyConfig() {},
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
  };
  class Window extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.destroyed = false;
      this.minimized = false;
      this.loads = 0;
      this.shown = 0;
      this.focused = 0;
      this.restored = 0;
      this.webContents = new EventEmitter();
      this.webContents.url = '';
      this.webContents.setAudioMuted = () => {};
      this.webContents.getURL = () => this.webContents.url;
      this.webContents.setWindowOpenHandler = (handler) => {
        this.popup = handler;
      };
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return this.minimized;
    }
    restore() {
      this.minimized = false;
      this.restored++;
    }
    show() {
      this.shown++;
    }
    focus() {
      this.focused++;
    }
    async loadURL(url) {
      this.loads++;
      if (loadError) throw loadError;
      this.webContents.url = url;
    }
    close() {
      this.destroy();
    }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit('closed');
      }
    }
    navigate(event, url) {
      let prevented = false;
      this.webContents.emit(
        event,
        {
          preventDefault() {
            prevented = true;
          },
        },
        url,
      );
      if (!prevented) this.webContents.url = url;
      return prevented;
    }
  }
  const net = {
    request(options) {
      const req = new EventEmitter();
      const headers = new Headers();
      let body;
      req.setHeader = (key, value) => headers.set(key, value);
      req.write = (value) => {
        body = Buffer.from(value).toString();
      };
      req.abort = () => req.emit('close');
      req.end = () => {
        Promise.resolve()
          .then(() =>
            accountTransport(options.url, { ...options, headers, body, signal: undefined }),
          )
          .then(async (response) => {
            if (response.status >= 300 && response.status < 400) {
              req.emit(
                'redirect',
                response.status,
                options.method,
                response.headers.get('location'),
                Object.fromEntries(response.headers),
              );
              return;
            }
            const stream = response.body ? Readable.fromWeb(response.body) : Readable.from([]);
            Object.assign(stream, {
              statusCode: response.status,
              statusMessage: response.statusText,
              headers: Object.fromEntries(response.headers),
            });
            stream.on('close', () => req.emit('close'));
            req.emit('response', stream);
          })
          .catch((error) => {
            req.emit('error', error);
            req.emit('close');
          });
      };
      return req;
    },
  };
  const context = {
    module: { exports: {} },
    exports: {},
    URL,
    Request,
    Headers,
    Response,
    AbortSignal,
    Buffer,
    setTimeout,
    clearTimeout,
    console,
    fetch: (input, init) => mediaTransport(input, init),
    fixtureLogger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      debug: (message) => logs.push(message),
    },
    require: (name) =>
      name === 'electron'
        ? { BrowserWindow: Window, net, session: { fromPartition: () => browser }, dialog: {} }
        : require(name),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(bundle.outputFiles[0].text, context, {
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  const account = new context.module.exports.YouTubeAccountService(
    () => null,
    () => {
      changes++;
    },
    () => {
      connections++;
    },
  );
  t.after(() => account.dispose());
  return {
    account,
    windows,
    logs,
    jar,
    Window,
    setTransport(value) {
      transport = value;
    },
    setWatchTransport(value) {
      watchTransport = value;
    },
    setMediaTransport(value) {
      mediaTransport = value;
    },
    setCookies(value) {
      cookies = value;
    },
    setLoadError(value) {
      loadError = value;
    },
    get changes() {
      return changes;
    },
    get connections() {
      return connections;
    },
  };
}

test('Sign-in navigation permits the Google→YouTube cookie handoff but rejects unrelated origins', () => {
  assert.equal(
    allowedYouTubeLoginUrl('https://accounts.youtube.com/accounts/SetSID?token=secret'),
    true,
  );
  for (const url of [
    'http://accounts.youtube.com/',
    'https://accounts.youtube.com.evil.test/',
    'https://user:secret@accounts.youtube.com/',
    'https://accounts.youtube.com:444/',
    'javascript:alert(1)',
    'https://example.com/',
  ])
    assert.equal(allowedYouTubeLoginUrl(url), false, url);
  assert.equal(
    youtubeLoginHost('https://accounts.youtube.com/accounts/SetSID?token=secret'),
    'accounts.youtube.com',
  );
});

test('The actual account service allows SetSID redirect and never logs challenge tokens', async (t) => {
  const f = fixture(t);
  await f.account.connect();
  const win = f.windows[0];
  assert.equal(
    win.navigate('will-redirect', 'https://accounts.youtube.com/accounts/SetSID?token=secret'),
    false,
  );
  assert.equal(
    win.navigate('will-navigate', 'https://accounts.google.com/challenge?token=secret'),
    false,
  );
  win.webContents.emit(
    'did-navigate',
    {},
    'https://accounts.youtube.com/accounts/SetSID?token=secret',
  );
  await tick();
  assert.equal(win.popup({ url: 'https://accounts.youtube.com/accounts/SetSID' }).action, 'allow');
  assert.equal(win.navigate('will-redirect', 'https://evil.test/?token=secret'), true);
  assert.equal(win.popup({ url: 'https://evil.test/' }).action, 'deny');
  assert.ok(f.logs.some((line) => line.includes('accounts.youtube.com')));
  assert.ok(!f.logs.join('\n').includes('secret'));
});

test('Reopen restores a minimized challenge without restarting two-factor authentication', async (t) => {
  const f = fixture(t);
  await f.account.connect();
  const win = f.windows[0];
  win.navigate('will-navigate', 'https://accounts.google.com/challenge');
  win.minimized = true;
  await Promise.all([f.account.connect(), f.account.connect()]);
  assert.equal(f.windows.length, 1);
  assert.equal(win.restored, 1);
  assert.equal(win.loads, 1);
  assert.equal(win.webContents.getURL(), 'https://accounts.google.com/challenge');
  assert.ok(win.focused > 0);
});

test('Closing and reopening sign-in creates a usable window and updates status', async (t) => {
  const f = fixture(t);
  assert.equal((await f.account.connect()).loginOpen, true);
  f.windows[0].destroy();
  assert.equal((await f.account.status()).loginOpen, false);
  assert.equal((await f.account.connect()).loginOpen, true);
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[1].loads, 1);
  assert.ok(f.changes >= 3);
});

test('A network failure can be retried; an aborted redirect is not a login failure', async (t) => {
  const f = fixture(t);
  f.setLoadError(Object.assign(new Error('offline'), { code: 'ERR_CONNECTION_RESET' }));
  await f.account.connect();
  await tick();
  assert.ok((await f.account.status()).error);
  f.setLoadError(null);
  assert.equal((await f.account.connect()).error, undefined);
  assert.equal(f.windows[0].loads, 2);
  f.windows[0].destroy();
  f.setLoadError(Object.assign(new Error('redirect'), { code: 'ERR_ABORTED' }));
  await f.account.connect();
  await tick();
  assert.equal((await f.account.status()).error, undefined);
});

test('Main-frame load and renderer failures retry; subresource and aborted loads do not reset a challenge', async (t) => {
  const f = fixture(t);
  await f.account.connect();
  const win = f.windows[0];
  win.webContents.emit('did-fail-load', {}, -3, 'aborted', '', true);
  win.webContents.emit('did-fail-load', {}, -105, 'subresource', '', false);
  await f.account.connect();
  assert.equal(win.loads, 1);
  win.webContents.emit('did-fail-load', {}, -105, 'DNS', '', true);
  await f.account.connect();
  assert.equal(win.loads, 2);
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await f.account.connect();
  assert.equal(win.loads, 3);
});

test('An active challenge popup is focused and closed with its parent', async (t) => {
  const f = fixture(t);
  await f.account.connect();
  const win = f.windows[0];
  const child = new f.Window();
  win.webContents.emit('did-create-window', child);
  child.minimized = true;
  await f.account.connect();
  assert.equal(child.restored, 1);
  assert.equal(child.focused, 1);
  assert.equal(
    child.navigate('will-redirect', 'https://accounts.youtube.com/accounts/SetSID'),
    false,
  );
  win.destroy();
  assert.equal(child.isDestroyed(), true);
  assert.equal((await f.account.status()).loginOpen, false);
});

test('Cookies arriving after navigation finish sign-in without another page load', async (t) => {
  const f = fixture(t);
  await f.account.connect();
  const win = f.windows[0];
  win.navigate('will-navigate', 'https://accounts.google.com/challenge');
  win.navigate('will-navigate', 'https://www.youtube.com/');
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal(win.isDestroyed(), false);
  f.setCookies(
    ['SAPISID', 'SID'].map((name) => ({
      name,
      value: 'synthetic',
      domain: '.youtube.com',
      path: '/',
      secure: true,
    })),
  );
  f.jar.emit('changed');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(win.isDestroyed(), true);
  assert.equal((await f.account.status()).connected, true);
});

test('An anonymous parent page does not close an unfinished Google challenge popup', async (t) => {
  const f = fixture(t);
  await f.account.connect();
  const win = f.windows[0];
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  const child = new f.Window();
  win.webContents.emit('did-create-window', child);
  child.navigate('will-navigate', 'https://accounts.google.com/challenge');
  child.webContents.emit('did-navigate', {}, 'https://accounts.google.com/challenge');
  await tick();
  f.setCookies(
    ['SAPISID', 'SID'].map((name) => ({
      name,
      value: 'synthetic',
      domain: '.youtube.com',
      path: '/',
      secure: true,
    })),
  );
  f.jar.emit('changed');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(win.isDestroyed(), false);
  child.navigate('will-navigate', 'https://www.youtube.com/');
  child.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal(win.isDestroyed(), true);
});

test('Redirects inside iframes do not reset or block the main sign-in challenge', async (t) => {
  const f = fixture(t);
  await f.account.connect();
  const win = f.windows[0];
  win.navigate('will-navigate', 'https://accounts.google.com/challenge');
  let blocked = false;
  win.webContents.emit(
    'will-redirect',
    {
      preventDefault() {
        blocked = true;
      },
    },
    'https://embedded.example.test/frame',
    false,
    false,
  );
  assert.equal(blocked, false);
  assert.equal((await f.account.status()).error, undefined);
  await f.account.connect();
  assert.equal(win.loads, 1);
  assert.ok(win.webContents.getURL().includes('challenge'));
});

test('Refreshing an existing account finishes after a new Google challenge and YouTube return', async (t) => {
  const f = fixture(t);
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'old-synthetic' })));
  assert.equal((await f.account.status()).connected, true);
  await f.account.connect();
  const win = f.windows[0];
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal(win.isDestroyed(), false);
  win.navigate('will-navigate', 'https://accounts.google.com/challenge');
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'new-synthetic' })));
  win.navigate('will-navigate', 'https://www.youtube.com/');
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal(win.isDestroyed(), true);
  assert.equal((await f.account.status()).connected, true);
});

test('Romanian Google account handoff can finish a reconnect without exposing challenge tokens', async (t) => {
  const f = fixture(t);
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'old-synthetic' })));
  await f.account.status();
  await f.account.connect();
  const win = f.windows[0];
  assert.equal(
    win.navigate('will-redirect', 'https://accounts.google.ro/challenge?token=secret'),
    false,
  );
  win.webContents.emit('did-navigate', {}, 'https://accounts.google.ro/challenge?token=secret');
  assert.equal(win.popup({ url: 'https://accounts.google.ro/challenge' }).action, 'allow');
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'new-synthetic' })));
  win.navigate('will-navigate', 'https://www.youtube.com/');
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal(win.isDestroyed(), true);
  assert.equal((await f.account.status()).error, undefined);
  assert.ok(!f.logs.join(' ').includes('secret'));
});

test('Regional account domains are exact Google hosts over HTTPS', () => {
  for (const host of [
    'accounts.google.ro',
    'accounts.google.de',
    'accounts.google.co.uk',
    'accounts.google.com.br',
  ])
    assert.equal(allowedYouTubeLoginUrl('https://' + host + '/challenge'), true);
  for (const host of [
    'accounts.google.ro.evil.test',
    'accounts.google.fake',
    'evil.google.ro',
    'accounts.evilgoogle.ro',
  ])
    assert.equal(allowedYouTubeLoginUrl('https://' + host + '/challenge'), false);
  for (const url of [
    'http://accounts.google.ro/',
    'https://user:secret@accounts.google.ro/',
    'https://accounts.google.ro:444/',
  ])
    assert.equal(allowedYouTubeLoginUrl(url), false);
});

function accountClient(f, getBasicInfo) {
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'synthetic' })));
  f.account.getClient = async () => ({ getBasicInfo, session: { player: undefined } });
}
const validAudioInfo = () => ({
  basic_info: { id: 'W0LiTBNjJ_o', duration: 106 },
  playability_status: { status: 'OK' },
  streaming_data: {
    adaptive_formats: [
      {
        url: 'https://rr1.googlevideo.com/videoplayback',
        itag: 140,
        bitrate: 128000,
        mime_type: 'audio/mp4',
        has_audio: true,
        has_video: false,
        decipher: async () => 'https://rr1.googlevideo.com/videoplayback?token=secret',
      },
    ],
  },
});

test('A stream transport failure does not report a connected session as broken', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => {
    throw new Error('Transport failed');
  });
  await f.account.status();
  const changes = f.changes;
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /Не удалось получить аудио/);
  assert.equal((await f.account.status()).connected, true);
  assert.equal((await f.account.status()).error, undefined);
  assert.equal(f.changes, changes);
  assert.ok(f.logs.some((x) => x.includes('stream unavailable')));
});

test('Age-restricted recordings preserve the access error without marking the whole account invalid', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => ({
    basic_info: { id: 'W0LiTBNjJ_o' },
    playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' },
  }));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_AGE_RESTRICTED/);
  assert.equal((await f.account.status()).error, undefined);
});

test('A genuine session denial remains visible and a successful account stream notifies its removal', async (t) => {
  const f = fixture(t);
  let denied = true;
  accountClient(f, async () =>
    denied
      ? {
          basic_info: { id: 'W0LiTBNjJ_o' },
          playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in' },
        }
      : validAudioInfo(),
  );
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  assert.match((await f.account.status()).error, /отклонил сессию/);
  const changes = f.changes;
  denied = false;
  await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal((await f.account.status()).error, undefined);
  assert.equal(f.changes, changes + 1);
  assert.ok(!f.logs.join(' ').includes('token=secret'));
});

test('A successful account stream does not erase an unrelated login-window error', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => validAudioInfo());
  await f.account.status();
  await f.account.connect();
  f.windows[0].webContents.emit('did-fail-load', {}, -105, 'DNS', '', true);
  const error = (await f.account.status()).error;
  assert.ok(error);
  await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal((await f.account.status()).error, error);
});

test('Disconnecting clears a genuine account denial before publishing disconnected status', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => ({
    basic_info: { id: 'W0LiTBNjJ_o' },
    playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in' },
  }));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  assert.ok((await f.account.status()).error);
  const disconnected = await f.account.disconnect();
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.error, undefined);
});

test('A failed request from an old account cannot mark a newly connected account invalid', async (t) => {
  const f = fixture(t);
  let fail;
  accountClient(
    f,
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const pending = f.account.resolve('W0LiTBNjJ_o', {});
  await tick();
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'new-synthetic' })));
  await f.account.status();
  fail(new Error('YOUTUBE_AUDIO_LOGIN_REQUIRED'));
  await assert.rejects(pending, /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  assert.equal((await f.account.status()).connected, true);
  assert.equal((await f.account.status()).error, undefined);
});

test('Account bootstrap diagnostics identify rejected endpoints without leaking their URLs', async (t) => {
  const f = fixture(t);
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'synthetic' })));
  f.account.getClient = async () => {
    throw new Error('Unsupported YouTube endpoint https://private.test/?token=secret');
  };
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /Не удалось получить аудио/);
  const log = f.logs.find((x) => x.includes('Authenticated playback failed'));
  assert.match(log, /stage=bootstrap failure=unsupported-endpoint/);
  assert.ok(!log.includes('secret'));
  assert.ok(!log.includes('https:'));
});

test('Account audio-format diagnostics identify absent formats without changing account status', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => ({
    basic_info: { id: 'W0LiTBNjJ_o' },
    playability_status: { status: 'OK' },
  }));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /Не удалось получить аудио/);
  assert.ok(f.logs.some((x) => x.includes('stage=audio failure=no-supported-audio')));
  assert.equal((await f.account.status()).error, undefined);
});

// Only bootstrap/player-script discovery is omitted; use the installed library's real
// signer, Request transport, response parser and Format class with the actual service.
async function realAccountClient(f) {
  const { Innertube } = await import('youtubei.js');
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'synthetic' })));
  await f.account.status();
  const client = await Innertube.create({
    cookie: 'SAPISID=synthetic; SID=synthetic',
    generate_session_locally: true,
    retrieve_player: false,
    retrieve_innertube_config: false,
    enable_session_cache: false,
    fetch: (input, init) => f.account.fetch(input, init),
  });
  f.account.getClient = async () => client;
  return client;
}

test('Real YouTube.js signs the account POST and parses a playable Format through the account service', async (t) => {
  const f = fixture(t);
  const requests = [];
  f.setTransport(async (url, init) => {
    requests.push({ url, init });
    assert.equal(new URL(url).pathname, '/youtubei/v1/player');
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: 'W0LiTBNjJ_o', lengthSeconds: '106' },
      streamingData: {
        expiresInSeconds: '3600',
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
            audioQuality: 'AUDIO_QUALITY_MEDIUM',
            url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    });
  });
  await realAccountClient(f);
  const stream = await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal(stream.url, 'https://rr1.googlevideo.com/videoplayback?itag=140');
  assert.equal(stream.duration, 106);
  assert.equal(requests.length, 1);
  const { init } = requests[0];
  const payload = JSON.parse(init.body);
  assert.equal(init.method, 'POST');
  assert.equal(payload.videoId, 'W0LiTBNjJ_o');
  assert.equal(payload.context.client.clientName, 'WEB');
  assert.equal(payload.playbackContext.contentPlaybackContext.html5Preference, 'HTML5_PREF_WANTS');
  assert.equal(payload.context.client.browserName, 'Safari');
  assert.equal(payload.context.client.userAgent, init.headers.get('user-agent'));
  assert.equal(init.headers.get('cookie'), 'SAPISID=synthetic; SID=synthetic');
  assert.equal(init.headers.get('x-goog-authuser'), '0');
  const auth = init.headers.get('authorization');
  assert.match(auth, /^SAPISIDHASH \d+_[a-f0-9]{40}$/);
  const [timestamp, hash] = auth.slice('SAPISIDHASH '.length).split('_');
  assert.equal(
    hash,
    createHash('sha1')
      .update(timestamp + ' synthetic ' + init.headers.get('origin'))
      .digest('hex'),
  );
  assert.equal((await f.account.status()).error, undefined);
  assert.ok(!f.logs.join(' ').includes('synthetic'));
});

test('Real parsed account denial remains explicit and a later signed successful response clears it', async (t) => {
  const f = fixture(t);
  let denied = true;
  f.setTransport(async () =>
    Response.json(
      denied
        ? {
            playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' },
            videoDetails: { videoId: 'W0LiTBNjJ_o' },
          }
        : {
            playabilityStatus: { status: 'OK' },
            videoDetails: { videoId: 'W0LiTBNjJ_o' },
            streamingData: {
              expiresInSeconds: '3600',
              adaptiveFormats: [
                {
                  itag: 140,
                  bitrate: 128000,
                  mimeType: 'audio/mp4',
                  audioQuality: 'AUDIO_QUALITY_MEDIUM',
                  url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
                },
              ],
            },
          },
    ),
  );
  await realAccountClient(f);
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  assert.ok((await f.account.status()).error);
  denied = false;
  await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal((await f.account.status()).error, undefined);
});

test('Account transport removes cookie and authorization before fetching a CDN manifest', async (t) => {
  const f = fixture(t);
  await realAccountClient(f);
  let captured;
  f.setTransport(async (_url, init) => {
    captured = init;
    return new Response('#EXTM3U');
  });
  await f.account.fetch(
    new Request('https://rr1.googlevideo.com/manifest/hls', {
      headers: { Cookie: 'SAPISID=synthetic', Authorization: 'secret', 'X-Goog-Authuser': '0' },
    }),
  );
  for (const header of ['cookie', 'authorization', 'x-goog-authuser'])
    assert.equal(captured.headers.get(header), null);
  assert.equal(captured.method, 'GET');
});

test('Connection animation is announced once after completed sign-in, never by a stored-cookie status read', async (t) => {
  const f = fixture(t);
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'synthetic' })));
  await f.account.status();
  assert.equal(f.connections, 0);
  await f.account.connect();
  const win = f.windows[0];
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal(f.connections, 0);
  win.navigate('will-navigate', 'https://accounts.google.com/challenge');
  win.navigate('will-navigate', 'https://www.youtube.com/');
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal(f.connections, 1);
  assert.equal(win.isDestroyed(), true);
  f.jar.emit('changed');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(f.connections, 1);
});

test('Real signed account POST resolves a video through the actual Format parser', async (t) => {
  const f = fixture(t);
  let posts = 0;
  f.setTransport(async (url, init) => {
    posts++;
    assert.equal(new URL(url).pathname, '/youtubei/v1/player');
    assert.match(init.headers.get('authorization'), /^SAPISIDHASH /);
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: 'W0LiTBNjJ_o', lengthSeconds: '106' },
      streamingData: {
        expiresInSeconds: '3600',
        adaptiveFormats: [
          {
            itag: 136,
            mimeType: 'video/mp4',
            bitrate: 1000000,
            qualityLabel: '720p',
            width: 1280,
            height: 720,
            url: 'https://rr1.googlevideo.com/videoplayback?itag=136',
          },
        ],
      },
    });
  });
  await realAccountClient(f);
  const stream = await f.account.resolveVideo('W0LiTBNjJ_o');
  assert.equal(stream.url, 'https://rr1.googlevideo.com/videoplayback?itag=136');
  assert.equal(posts, 1);
  assert.ok(f.logs.some((x) => x.includes('Authenticated video resolved')));
});

test('SABR-only account response reports missing streams, never a signature or login failure', async (t) => {
  const f = fixture(t);
  f.setTransport(async () =>
    Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: 'W0LiTBNjJ_o' },
      streamingData: {
        serverAbrStreamingUrl: 'https://rr1.googlevideo.com/sabr?secret=token',
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4',
            audioQuality: 'AUDIO_QUALITY_MEDIUM',
            bitrate: 128000,
          },
        ],
      },
    }),
  );
  await realAccountClient(f);
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /Не удалось получить аудио/);
  assert.ok(f.logs.some((x) => x.includes('failure=no-supported-audio')));
  assert.ok(f.logs.some((x) => x.includes('playable=0 hls=false sabr=true')));
  assert.ok(!f.logs.join(' ').includes('secret'));
  assert.equal((await f.account.status()).error, undefined);
});

test('Manual refresh keeps account cookies, retries the failed recording and clears a resolved denial', async (t) => {
  const f = fixture(t);
  let denied = true,
    calls = 0;
  accountClient(f, async () => {
    calls++;
    return denied
      ? {
          basic_info: { id: 'W0LiTBNjJ_o' },
          playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in' },
        }
      : validAudioInfo();
  });
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  const bootstrap = f.account.getClient;
  let bootstraps = 0;
  f.account.getClient = async () => {
    bootstraps++;
    return bootstrap();
  };
  denied = false;
  const [a, b] = await Promise.all([f.account.refresh(), f.account.refresh()]);
  assert.equal(a.connected, true);
  assert.equal(b.error, undefined);
  assert.equal(calls, 2);
  assert.equal(bootstraps, 1);
  assert.equal(f.windows.length, 0);
  assert.equal(f.connections, 1);
  assert.ok(f.logs.some((line) => line.includes('cookies preserved')));
  assert.ok(!f.logs.join(' ').includes('synthetic'));
});

test('Failed format refresh preserves the account and reports formats rather than demanding logout', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => ({
    basic_info: { id: 'W0LiTBNjJ_o' },
    playability_status: { status: 'OK' },
  }));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /Не удалось получить аудио/);
  const status = await f.account.refresh();
  assert.equal(status.connected, true);
  assert.match(status.error, /поддерживаемый поток/);
  assert.equal(f.connections, 0);
  assert.equal(f.windows.length, 0);
  assert.ok(!f.logs.join(' ').includes('synthetic'));
});

test('Completing login clears a previous denial even when Google keeps the same identity cookies', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => ({
    basic_info: { id: 'W0LiTBNjJ_o' },
    playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in' },
  }));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  await f.account.connect();
  const win = f.windows[0];
  win.navigate('will-navigate', 'https://accounts.google.com/challenge');
  win.navigate('will-navigate', 'https://www.youtube.com/');
  win.webContents.emit('did-navigate', {}, 'https://www.youtube.com/');
  await tick();
  assert.equal((await f.account.status()).error, undefined);
  assert.equal(f.connections, 1);
});

test('A current format failure after refresh replaces the older account-denial guidance', async (t) => {
  const f = fixture(t);
  let denied = true;
  accountClient(f, async () => ({
    basic_info: { id: 'W0LiTBNjJ_o' },
    playability_status: denied ? { status: 'LOGIN_REQUIRED', reason: 'Sign in' } : { status: 'OK' },
  }));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  denied = false;
  const status = await f.account.refresh();
  assert.equal(status.connected, true);
  assert.match(status.error, /поддерживаемый поток/);
  assert.ok(!status.error.includes('отклонил сессию'));
});

test('Real signed account player handles the reported 23 descriptions with only progressive itag 18 addressed', async (t) => {
  const f = fixture(t);
  f.setTransport(async () =>
    Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: 'W0LiTBNjJ_o', lengthSeconds: '106' },
      streamingData: {
        expiresInSeconds: '3600',
        adaptiveFormats: Array.from({ length: 22 }, (_, i) => ({
          itag: 140 + i,
          mimeType: 'audio/mp4',
          audioQuality: 'AUDIO_QUALITY_MEDIUM',
          bitrate: 128000,
        })),
        formats: [
          {
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            qualityLabel: '360p',
            height: 360,
            bitrate: 400000,
            url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
          },
        ],
      },
    }),
  );
  await realAccountClient(f);
  const stream = await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal(stream.audioItag, 18);
  assert.equal(stream.audioIncludesVideo, true);
  assert.equal(stream.audioContainer, 'progressive');
  assert.ok(
    f.logs.some((line) =>
      line.includes('described=23 addressed=1 audioOnly=0 hls=false progressive=18'),
    ),
  );
  assert.ok(f.logs.some((line) => line.includes('delivery=progressive audioOnly=false itag=18')));
  assert.equal((await f.account.status()).error, undefined);
});

test('A signed player response is not success when the CDN returns 403; refresh retries actual delivery', async (t) => {
  const f = fixture(t);
  let posts = 0,
    probes = 0,
    denied = true;
  f.setTransport(async () => {
    posts++;
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: 'W0LiTBNjJ_o' },
      streamingData: {
        formats: [
          {
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            qualityLabel: '360p',
            height: 360,
            bitrate: 400000,
            url: 'https://rr1.googlevideo.com/videoplayback?itag=18&token=secret',
          },
        ],
      },
    });
  });
  f.setMediaTransport(async (url, init) => {
    probes++;
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('cookie'), null);
    return denied
      ? new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })
      : new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: { 'content-type': 'video/mp4' },
        });
  });
  await realAccountClient(f);
  await assert.rejects(
    f.account.resolve('W0LiTBNjJ_o', {}),
    (error) => error.cause.message === 'cdn-http-403',
  );
  assert.equal((await f.account.status()).connected, true);
  assert.equal((await f.account.status()).error, undefined); // A failed recording does not mean the account was logged out.
  const status = await f.account.refresh();
  assert.equal(posts, 2);
  assert.equal(probes, 2);
  assert.equal(status.connected, true);
  assert.match(status.error, /HTTP 403/);
  assert.equal(f.connections, 0);
  assert.ok(!f.logs.some((x) => x.includes('Authenticated audio resolved')));
  assert.ok(!f.logs.some((x) => x.includes('Playback session refreshed')));
  assert.ok(f.logs.some((x) => x.includes('stage=delivery failure=cdn-http-403')));
  assert.ok(!f.logs.join(' ').includes('secret'));
  assert.ok(!f.logs.join(' ').includes('synthetic'));
  denied = false;
  const recovered = await f.account.refresh();
  assert.equal(posts, 3);
  assert.equal(probes, 3);
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.connected, true);
  assert.equal(f.connections, 1);
  assert.ok(f.logs.some((x) => x.includes('failed recording delivery checked')));
});

test('Refresh without a failed recording does not announce that playback was verified', async (t) => {
  const f = fixture(t);
  let calls = 0;
  accountClient(f, async () => {
    calls++;
    return validAudioInfo();
  });
  const status = await f.account.refresh();
  assert.equal(status.connected, true);
  assert.equal(status.error, undefined);
  assert.equal(calls, 0);
  assert.equal(f.connections, 0);
  assert.ok(f.logs.some((x) => x.includes('no recording checked')));
});

test('A CDN network failure remains a network failure after refresh, preserving login cookies', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => validAudioInfo());
  f.setMediaTransport(async () => {
    throw new Error('ECONNRESET token=secret');
  });
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}), (e) => e.cause.message === 'network');
  const status = await f.account.refresh();
  assert.equal(status.connected, true);
  assert.match(status.error, /соединение/);
  assert.ok(!status.error.includes('проверку'));
  assert.equal(f.connections, 0);
  assert.ok(!f.logs.join(' ').includes('secret'));
});

test('A validated CDN redirect supplies the final playback URL and is checked only once', async (t) => {
  const f = fixture(t);
  accountClient(f, async () => validAudioInfo());
  let calls = 0;
  f.setMediaTransport(async () =>
    ++calls === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://rr2.googlevideo.com/videoplayback?itag=140' },
        })
      : new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'content-type': 'audio/mp4' },
        }),
  );
  const stream = await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal(stream.url, 'https://rr2.googlevideo.com/videoplayback?itag=140');
  assert.equal(stream.deliveryVerified, true);
  assert.equal(calls, 2);
});

test('Account CDN manifests follow trusted redirects without forwarding credentials', async (t) => {
  const f = fixture(t);
  await realAccountClient(f);
  let requests = [];
  f.setTransport(async (url, init) => {
    requests.push({ url, init });
    return requests.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://rr2.googlevideo.com/manifest/hls' },
        })
      : new Response('#EXTM3U');
  });
  assert.equal(
    await (await f.account.fetch('https://rr1.googlevideo.com/manifest/hls')).text(),
    '#EXTM3U',
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, 'https://rr2.googlevideo.com/manifest/hls');
  assert.equal(requests[0].init.redirect, 'manual');
  assert.equal(requests[1].init.redirect, 'manual');
  for (const { init } of requests) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.get('cookie'), null);
    assert.equal(init.headers.get('authorization'), null);
  }
  requests = [];
  f.setTransport(async (url) => {
    requests.push(url);
    return new Response(null, {
      status: 302,
      headers: { location: 'https://evil.test/?token=secret' },
    });
  });
  await assert.rejects(
    f.account.fetch('https://rr1.googlevideo.com/manifest/hls'),
    (e) => e.cause?.message === 'cdn-redirect',
  );
  assert.equal(requests.length, 1);
  assert.ok(!f.logs.join(' ').includes('secret'));
});

test('A rejected CDN URL gets one fresh account player response without disconnecting', async (t) => {
  const f = fixture(t);
  let players = 0,
    probes = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setMediaTransport(async () =>
    ++probes === 1
      ? new Response('Forbidden', { status: 403 })
      : new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'content-type': 'audio/mp4' },
        }),
  );
  const result = await f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true });
  assert.equal(result.deliveryVerified, true);
  assert.equal(players, 2);
  assert.equal(probes, 2);
  assert.equal((await f.account.status()).connected, true);
  assert.ok(f.logs.some((x) => x.includes('AccountRecovery')));
  assert.equal(f.windows.length, 0);
});

test('Persistent CDN rejection has a retry ceiling and recovery cooldown', async (t) => {
  const f = fixture(t);
  let players = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setMediaTransport(async () => new Response('Forbidden', { status: 403 }));
  for (let i = 0; i < 3; i++)
    await assert.rejects(
      f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true }),
      (e) => e.cause?.message === 'cdn-http-403',
    );
  assert.equal(players, 6);
  assert.equal((await f.account.status()).connected, true);
  assert.equal(f.windows.length, 0);
  assert.equal(f.logs.filter((x) => x.includes('Refreshing player and network route')).length, 1);
});

test('Speculative account resolution cannot reset the player cache or consume playback recovery', async (t) => {
  const f = fixture(t);
  let players = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setMediaTransport(async () => new Response('Forbidden', { status: 403 }));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', {}));
  assert.equal(players, 1);
  assert.ok(!f.logs.some((x) => x.includes('Refreshing player and network route')));
  await assert.rejects(f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true }));
  assert.equal(players, 3);
  assert.equal((await f.account.status()).connected, true);
});

test('Concurrent active CDN failures share recovery instead of clearing each others connection state', async (t) => {
  const f = fixture(t);
  let players = 0,
    probes = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setMediaTransport(async () =>
    ++probes <= 2
      ? new Response('Forbidden', { status: 403 })
      : new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'content-type': 'audio/mp4' },
        }),
  );
  const result = await Promise.all([
    f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true }),
    f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true }),
  ]);
  assert.ok(result.every((stream) => stream.deliveryVerified));
  assert.equal(players, 4);
  assert.equal(probes, 4);
  assert.equal(f.logs.filter((x) => x.includes('Refreshing player and network route')).length, 1);
});

test('CDN 403 can recover through the signed-in watch page for the same recording', async (t) => {
  const f = fixture(t);
  let players = 0,
    pages = 0,
    probes = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setWatchTransport(async (url, init) => {
    pages++;
    assert.equal(new URL(url).searchParams.get('v'), 'W0LiTBNjJ_o');
    assert.match(init.headers.get('cookie'), /SAPISID=synthetic/);
    return new Response(
      '<script>var ytInitialPlayerResponse = ' +
        JSON.stringify({
          playabilityStatus: { status: 'OK' },
          videoDetails: { videoId: 'W0LiTBNjJ_o', lengthSeconds: '106' },
          streamingData: {
            formats: [
              {
                itag: 18,
                mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
                bitrate: 400000,
                url: 'https://rr1.googlevideo.com/videoplayback?itag=18&c=WEB',
              },
            ],
          },
        }) +
        ';</script>',
      { headers: { 'content-type': 'text/html' } },
    );
  });
  f.setMediaTransport(async (url, init) => {
    probes++;
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('cookie'), null);
    if (probes === 1) return new Response('Forbidden', { status: 403 });
    assert.match(new Headers(init.headers).get('user-agent'), /Safari/);
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: { 'content-type': 'video/mp4' },
    });
  });
  const stream = await f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true });
  assert.equal(stream.deliveryVerified, true);
  assert.equal(players, 1);
  assert.equal(pages, 1);
  assert.equal(probes, 2);
  assert.equal((await f.account.status()).connected, true);
  assert.ok(f.logs.some((x) => x.includes('AccountWatch')));
  assert.ok(!f.logs.join(' ').includes('synthetic'));
});

test('A watch-page fallback never substitutes a different recording', async (t) => {
  const f = fixture(t);
  let pages = 0,
    players = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setWatchTransport(async () => {
    pages++;
    return new Response(
      '<script>ytInitialPlayerResponse = {"videoDetails":{"videoId":"anotherVideo"},"playabilityStatus":{"status":"OK"}};</script>',
      { headers: { 'content-type': 'text/html' } },
    );
  });
  f.setMediaTransport(async () => new Response('Forbidden', { status: 403 }));
  await assert.rejects(
    f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true }),
    (e) => e.cause?.message === 'cdn-http-403',
  );
  assert.equal(pages, 1);
  assert.equal(players, 2);
});

test('A cache-reset cooldown cannot suppress the signed watch fallback on the next playback', async (t) => {
  const f = fixture(t);
  let players = 0,
    pages = 0,
    probes = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.account.lastDeliveryRecoveryAt = Date.now();
  f.setWatchTransport(async () => {
    pages++;
    return new Response(
      '<script>ytInitialPlayerResponse = ' +
        JSON.stringify({
          playabilityStatus: { status: 'OK' },
          videoDetails: { videoId: 'W0LiTBNjJ_o' },
          streamingData: {
            formats: [
              {
                itag: 18,
                mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
                bitrate: 400000,
                url: 'https://rr1.googlevideo.com/videoplayback?itag=18&c=WEB',
              },
            ],
          },
        }) +
        ';</script>',
      { headers: { 'content-type': 'text/html' } },
    );
  });
  f.setMediaTransport(async () =>
    ++probes === 1
      ? new Response('Forbidden', { status: 403 })
      : new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'content-type': 'video/mp4' },
        }),
  );
  const result = await f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true });
  assert.equal(result.deliveryVerified, true);
  assert.equal(players, 1);
  assert.equal(pages, 1);
  assert.equal(probes, 2);
  assert.ok(!f.logs.some((x) => x.includes('Refreshing player and network route')));
  assert.ok(f.logs.some((x) => x.includes('cacheReset=false')));
});

function fastWatchResponse(videoId) {
  return new Response(
    '<script>ytInitialPlayerResponse = ' +
      JSON.stringify({
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId, lengthSeconds: '106' },
        streamingData: {
          formats: [
            {
              itag: 18,
              mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
              bitrate: 400000,
              url: 'https://rr1.googlevideo.com/videoplayback?itag=18&c=WEB&route=watch',
            },
          ],
        },
      }) +
      ';</script>',
    { headers: { 'content-type': 'text/html' } },
  );
}
const fastMediaResponse = (url) =>
  new URL(url).searchParams.get('route') === 'watch'
    ? new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { 'content-type': 'video/mp4' },
      })
    : new Response('Forbidden', { status: 403 });

test('Speculative preparation resolves a verified watch stream without spending active playback recovery', async (t) => {
  const f = fixture(t);
  let players = 0,
    pages = 0,
    probes = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setWatchTransport(async (url) => {
    pages++;
    return fastWatchResponse(new URL(url).searchParams.get('v'));
  });
  f.setMediaTransport(async (url) => {
    probes++;
    return fastMediaResponse(url);
  });
  const stream = await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal(stream.deliveryVerified, true);
  assert.equal(players, 1);
  assert.equal(pages, 1);
  assert.equal(probes, 2);
  assert.equal(f.account.lastDeliveryRecoveryAt, 0);
  assert.ok(!f.logs.some((line) => line.includes('Refreshing player and network route')));
  assert.equal((await f.account.status()).connected, true);
});

test('A verified watch route skips the rejected player API and its CDN probe on the next recording', async (t) => {
  const f = fixture(t);
  let players = 0,
    pages = 0,
    probes = 0;
  accountClient(f, async (id) => {
    players++;
    return { ...validAudioInfo(), basic_info: { id, duration: 106 } };
  });
  f.setWatchTransport(async (url) => {
    pages++;
    return fastWatchResponse(new URL(url).searchParams.get('v'));
  });
  f.setMediaTransport(async (url) => {
    probes++;
    return fastMediaResponse(url);
  });
  await f.account.resolve('W0LiTBNjJ_o', {});
  const first = { players, pages, probes };
  const stream = await f.account.resolve('ph9KP2_lT5Q', { allowSessionRecovery: true });
  assert.equal(stream.deliveryVerified, true);
  assert.equal(players, first.players);
  assert.equal(pages, first.pages + 1);
  assert.equal(probes, first.probes + 1);
  assert.ok(f.logs.some((line) => line.includes('track=ph9KP2_lT5Q via=watch attempts=1')));
  assert.equal(f.account.lastDeliveryRecoveryAt, 0);
});

test('A preferred watch route falls back to the same recording player when its CDN stops working', async (t) => {
  const f = fixture(t);
  let players = 0,
    pages = 0,
    watchWorks = true;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  f.setWatchTransport(async (url) => {
    pages++;
    return fastWatchResponse(new URL(url).searchParams.get('v'));
  });
  f.setMediaTransport(async (url) =>
    watchWorks
      ? fastMediaResponse(url)
      : new URL(url).searchParams.get('route') === 'watch'
        ? new Response('Forbidden', { status: 403 })
        : new Response(new Uint8Array([1]), {
            status: 206,
            headers: { 'content-type': 'audio/mp4' },
          }),
  );
  await f.account.resolve('W0LiTBNjJ_o', {});
  watchWorks = false;
  const stream = await f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true });
  assert.equal(stream.deliveryVerified, true);
  assert.equal(players, 2);
  assert.equal(pages, 2);
  assert.equal(f.account.preferredWatchUntil, 0);
  assert.ok(f.logs.some((line) => line.includes('Trying player API after CDN 403')));
});

test('An expired route preference and a changed account cannot reuse an old watch preference', async (t) => {
  const f = fixture(t);
  let players = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  await f.account.status();
  f.account.preferredWatchUntil = Date.now() - 1;
  await f.account.resolve('W0LiTBNjJ_o', {});
  assert.equal(players, 1);
  f.account.preferredWatchUntil = Date.now() + 300000;
  f.setCookies(['SAPISID', 'SID'].map((name) => ({ name, value: 'different-synthetic' })));
  await f.account.status();
  assert.equal(f.account.preferredWatchUntil, 0);
});

test('Watch preference does not convert per-recording age restrictions into another playback route', async (t) => {
  const f = fixture(t);
  let players = 0;
  accountClient(f, async () => {
    players++;
    return validAudioInfo();
  });
  await f.account.status();
  f.account.preferredWatchUntil = Date.now() + 300000;
  f.setWatchTransport(
    async () =>
      new Response(
        '<script>ytInitialPlayerResponse = ' +
          JSON.stringify({
            videoDetails: { videoId: 'W0LiTBNjJ_o' },
            playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' },
          }) +
          ';</script>',
        { headers: { 'content-type': 'text/html' } },
      ),
  );
  await assert.rejects(
    f.account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true }),
    /YOUTUBE_AUDIO_AGE_RESTRICTED/,
  );
  assert.equal(players, 0);
});
