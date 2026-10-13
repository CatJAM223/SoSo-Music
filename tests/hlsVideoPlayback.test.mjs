import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../src/shared/utils/videoStreamPlayback.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'hls-fixture',
      setup(b) {
        b.onResolve({ filter: /^hls\.js$/ }, () => ({ path: 'hls', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export default globalThis.FixtureHls;',
          loader: 'js',
        }));
      },
    },
  ],
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(native = false) {
  const timers = new Map(),
    intervals = new Map(),
    listeners = new Map(),
    instances = [];
  let sequence = 0,
    failed = 0,
    now = 0;
  class Hls {
    static Events = { ERROR: 'error' };
    static ErrorTypes = { MEDIA_ERROR: 'media' };
    static isSupported() {
      return true;
    }
    constructor(options) {
      this.options = options;
      this.destroyed = 0;
      this.recovered = 0;
      instances.push(this);
    }
    on(_event, handler) {
      this.error = handler;
    }
    loadSource(url) {
      this.url = url;
    }
    attachMedia(video) {
      this.video = video;
    }
    destroy() {
      this.destroyed++;
    }
    recoverMediaError() {
      this.recovered++;
    }
  }
  const video = {
    src: '',
    paused: 0,
    loads: 0,
    canPlayType: () => (native ? 'probably' : ''),
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: (n) => listeners.delete(n),
    pause() {
      this.paused++;
    },
    removeAttribute() {
      this.src = '';
    },
    load() {
      this.loads++;
    },
  };
  const context = {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setInterval(fn) {
      intervals.set(++sequence, fn);
      return sequence;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    module: { exports: {} },
    exports: {},
    FixtureHls: Hls,
    setTimeout(fn) {
      timers.set(++sequence, fn);
      return sequence;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  return {
    api: context.module.exports,
    video,
    timers,
    intervals,
    listeners,
    instances,
    advance(ms) {
      now += ms;
      for (const fn of intervals.values()) fn();
    },
    attach() {
      return context.module.exports.attachHlsVideo(
        video,
        'https://rr1.googlevideo.com/manifest/hls_playlist/video.m3u8',
        () => failed++,
      );
    },
    get failed() {
      return failed;
    },
  };
}
test('Closing the clip before HLS loads prevents attachment and leaves no timer or media resource', async () => {
  const f = fixture();
  const dispose = f.attach();
  dispose();
  await tick();
  assert.equal(f.instances.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.video.paused, 1);
  assert.equal(f.video.loads, 1);
  assert.equal(f.failed, 0);
});
test('HLS clip attaches, permits one fatal media recovery and stops on repeated or network failure', async () => {
  for (const type of ['media', 'network']) {
    const f = fixture();
    const dispose = f.attach();
    await tick();
    const hls = f.instances[0];
    assert.equal(hls.video, f.video);
    assert.match(hls.url, /video\.m3u8$/);
    assert.ok(hls.options.maxBufferSize <= 24 * 1024 * 1024);
    hls.error('error', { fatal: false, type });
    assert.equal(f.failed, 0);
    hls.error('error', { fatal: true, type });
    if (type === 'media') {
      assert.equal(hls.recovered, 1);
      assert.equal(f.failed, 0);
      hls.error('error', { fatal: true, type });
    }
    assert.equal(f.failed, 1);
    assert.equal(f.timers.size, 0);
    hls.error('error', { fatal: true, type });
    assert.equal(f.failed, 1);
    dispose();
    assert.equal(f.listeners.size, 0);
  }
});
test('Native HLS readiness clears deadline; a stuck clip reports failure once and disposes', () => {
  const ready = fixture(true);
  const dispose = ready.attach();
  assert.match(ready.video.src, /m3u8$/);
  ready.listeners.get('loadeddata')();
  assert.equal(ready.timers.size, 0);
  dispose();
  const stuck = fixture(true);
  const cleanup = stuck.attach();
  const deadline = [...stuck.timers.values()][0];
  deadline();
  deadline();
  assert.equal(stuck.failed, 1);
  cleanup();
  assert.equal(stuck.timers.size, 0);
  assert.equal(stuck.listeners.size, 0);
});

test('Progressive clip startup timeout is canceled when a frame arrives or the panel closes', () => {
  const f = fixture();
  f.video.readyState = 0;
  let failed = 0;
  const dispose = f.api.watchVideoStartup(f.video, () => failed++);
  const deadline = [...f.timers.values()][0];
  f.listeners.get('loadeddata')();
  assert.equal(f.timers.size, 0);
  dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.video.loads, 1);
  assert.equal(f.video.src, '');
  const dispose2 = f.api.watchVideoStartup(f.video, () => failed++);
  [...f.timers.values()][0]();
  assert.equal(failed, 1);
  dispose2();
  assert.equal(f.timers.size, 0);
  f.video.readyState = 2;
  f.api.watchVideoStartup(f.video, () => failed++);
  assert.equal(f.timers.size, 0);
});
test('Native clip sync waits for metadata and clamps seeks without changing the audio player', () => {
  const f = fixture();
  let seeks = 0;
  Object.defineProperty(f.video, 'currentTime', {
    get: () => 0,
    set: (value) => {
      seeks++;
      f.video.seek = value;
    },
  });
  f.video.play = async () => {};
  f.video.readyState = 0;
  f.api.syncVideoPlayback(f.video, 20, true);
  assert.equal(seeks, 0);
  f.video.readyState = 1;
  f.video.duration = 10;
  f.api.syncVideoPlayback(f.video, 20, false);
  assert.equal(f.video.seek, 9.95);
  assert.equal(f.video.paused, 1);
});

test('Advancing audio cannot keep restarting a clip seek while its first segment is loading', () => {
  const f = fixture();
  let seeks = 0,
    position = 0;
  f.video.readyState = 1;
  f.video.duration = 120;
  f.video.seeking = false;
  f.video.paused = false;
  f.video.play = async () => {};
  Object.defineProperty(f.video, 'currentTime', {
    get: () => position,
    set: (value) => {
      seeks++;
      position = value;
      f.video.seeking = true;
    },
  });
  f.api.syncVideoPlayback(f.video, 20, true);
  assert.equal(seeks, 1);
  for (const time of [21, 22, 23, 24]) f.api.syncVideoPlayback(f.video, time, true);
  assert.equal(
    seeks,
    1,
    'Keep the pending segment request instead of seeking again on every audio tick',
  );
  f.video.seeking = false;
  f.video.readyState = 2;
  f.api.syncVideoPlayback(f.video, 24, true);
  assert.equal(seeks, 2, 'Catch up after the pending seek finishes');
});

test('A decoded first frame does not hide a frozen clip, and seeking alone is not frame progress', () => {
  const f = fixture();
  let frames = 1;
  const failures = [];
  Object.assign(f.video, {
    currentTime: 0,
    readyState: 2,
    networkState: 2,
    ended: false,
    getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }),
  });
  const state = { time: 0, playing: true, enabled: true };
  const dispose = f.api.watchVideoProgress(
    f.video,
    () => state,
    (reason) => failures.push(reason),
  );
  f.advance(10000);
  frames++;
  f.advance(1000);
  assert.deepEqual(failures, []);
  f.video.currentTime = 12;
  f.advance(14000);
  assert.deepEqual(failures, []);
  f.advance(1000);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /stalled/);
  f.advance(20000);
  assert.equal(failures.length, 1);
  dispose();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.listeners.size, 0);
});
test('Pausing, finishing a shorter clip and closing the panel cannot trigger stalled recovery', () => {
  const f = fixture();
  const failures = [];
  Object.assign(f.video, { currentTime: 0, readyState: 2, networkState: 1, ended: false });
  const state = { time: 0, playing: false, enabled: true };
  const dispose = f.api.watchVideoProgress(
    f.video,
    () => state,
    (r) => failures.push(r),
  );
  for (let i = 0; i < 30; i++) f.advance(1000);
  state.playing = true;
  f.video.ended = true;
  for (let i = 0; i < 30; i++) f.advance(1000);
  assert.deepEqual(failures, []);
  dispose();
  f.video.ended = false;
  f.advance(30000);
  assert.deepEqual(failures, []);
  assert.equal(f.intervals.size, 0);
});
test('Progressive cleanup followed by re-attachment restores the source on the same video node', () => {
  const f = fixture();
  const url = 'https://rr1.googlevideo.com/clip.mp4';
  f.video.readyState = 0;
  const detach = f.api.watchVideoStartup(f.video, () => {}, url);
  assert.equal(f.video.src, url);
  detach();
  assert.equal(f.video.src, '');
  const detach2 = f.api.watchVideoStartup(f.video, () => {}, url);
  assert.equal(f.video.src, url);
  detach2();
  assert.equal(f.timers.size, 0);
});
