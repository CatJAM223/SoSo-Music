import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioCrossfade } from '../src/shared/services/audioCrossfade.ts';
import { TrackVolumeNormalization } from '../src/shared/services/trackVolumeNormalization.ts';
import * as volumes from '../src/shared/utils/audioVolume.ts';
import * as fade from '../src/shared/utils/crossfade.ts';
import { hookRuntime } from './helpers/hookRuntime.mjs';

class Audio extends EventTarget {
  rawVolume = 0.8;
  muted = false;
  paused = false;
  ended = false;
  error = null;
  currentTime = 116;
  duration = 120;
  readyState = 4;
  seeking = false;
  src = 'blob:fixture';
  get volume() {
    return this.rawVolume;
  }
  set volume(value) {
    this.rawVolume = value;
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  removeAttribute() {
    this.src = '';
  }
  getAttribute() {
    return this.src;
  }
  load() {}
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' ~= ' + expected);
function setup(t, gain = 12) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const values = new Map([
    ['soso_volume_normalization', 'true'],
    ['soso_volume', '.8'],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const service = new TrackVolumeNormalization(storage),
    outgoing = new Audio(),
    incoming = new Audio();
  for (const [audio, id] of [
    [outgoing, 'old'],
    [incoming, 'new'],
  ]) {
    service.remember({ id, source: 'soundcloud' }, gain);
    service.prepare(audio, { id, source: 'soundcloud' });
  }
  const transition = new AudioCrossfade();
  let volume = 0.8,
    completed = 0,
    disposed = 0;
  transition.hold(
    outgoing,
    () => {
      disposed++;
      service.release(outgoing);
    },
    () => volume,
  );
  transition.start(
    incoming,
    4,
    () => volume,
    () => completed++,
  );
  t.after(() => {
    transition.stop();
    service.release(incoming);
  });
  return {
    service,
    outgoing,
    incoming,
    transition,
    storage,
    setVolume(value) {
      volume = value;
      volumes.applyAudioVolume(incoming, value, false);
    },
    tick(ms) {
      now += ms;
      t.mock.timers.tick(ms);
    },
    completed: () => completed,
    disposed: () => disposed,
  };
}

test('Normalized crossfade fades the saturated endpoint instead of pinning both tracks at maximum', (t) => {
  const f = setup(t);
  f.tick(1000);
  near(f.outgoing.rawVolume, Math.cos(Math.PI / 8));
  near(f.incoming.rawVolume, Math.sin(Math.PI / 8));
  near(f.outgoing.rawVolume ** 2 + f.incoming.rawVolume ** 2, 1);
  f.tick(1000);
  near(f.incoming.rawVolume, Math.SQRT1_2);
  f.tick(2000);
  near(f.incoming.rawVolume, 1);
  assert.equal(f.completed(), 1);
  assert.equal(f.disposed(), 1);
});

test('Volume/mute changes retain both envelopes and pause restores the incoming endpoint', (t) => {
  const f = setup(t, -6);
  f.tick(2000);
  f.setVolume(0.03);
  const gain = Math.pow(10, -6 / 20);
  near(f.incoming.rawVolume, 0.03 * gain * Math.SQRT1_2);
  f.tick(25);
  near(f.outgoing.rawVolume, 0.03 * gain * Math.cos(((2025 / 4000) * Math.PI) / 2));
  f.setVolume(0);
  f.tick(25);
  assert.equal(f.outgoing.rawVolume, 0);
  assert.equal(f.incoming.rawVolume, 0);
  f.setVolume(0.03);
  f.incoming.pause();
  f.tick(25);
  assert.equal(f.transition.active, false);
  assert.equal(f.outgoing.paused, true);
  near(f.incoming.rawVolume, 0.03 * gain);
});

test('Waiting decoder freezes the fade rather than disposing a healthy outgoing stream', (t) => {
  const f = setup(t, -6);
  f.tick(1000);
  const before = f.outgoing.rawVolume;
  f.incoming.readyState = 2;
  f.incoming.dispatchEvent(new Event('waiting'));
  f.tick(5000);
  near(f.outgoing.rawVolume, before);
  assert.equal(f.outgoing.paused, false);
  assert.equal(f.completed(), 0);
  f.incoming.readyState = 4;
  f.incoming.dispatchEvent(new Event('playing'));
  f.tick(1000);
  near(f.outgoing.rawVolume, 0.8 * Math.pow(10, -6 / 20) * Math.SQRT1_2);
  f.tick(2000);
  assert.equal(f.completed(), 1);
  assert.equal(f.disposed(), 1);
});

test('Focus cannot overwrite an active transition and the real settings slider preserves its envelope', (t) => {
  const f = setup(t, -6),
    document = new EventTarget(),
    window = new EventTarget();
  document.hidden = false;
  const audioRef = { current: f.incoming };
  const h = hookRuntime(
    new URL('../src/shared/hooks/useAudioSettings.ts', import.meta.url),
    {
      '../services/trackVolumeNormalization': { trackVolumeNormalization: () => f.service },
      '../utils/logger': { logger: { debug() {} } },
      '../utils/audioVolume': volumes,
      '../utils/crossfade': fade,
    },
    { document, window, localStorage: f.storage, setInterval, clearInterval },
  );
  h.render({ audioRef });
  f.tick(2000);
  const before = f.incoming.rawVolume;
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  near(f.incoming.rawVolume, before);
  h.api().setVolume(0.03);
  h.render();
  near(f.incoming.rawVolume, 0.03 * Math.pow(10, -6 / 20) * Math.SQRT1_2);
  h.unmount();
});

test('Single-track fade also composes positive normalization without a plateau and cleans up its timer', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const storage = {
    getItem: (key) => (key === 'soso_volume_normalization' ? 'true' : null),
    setItem() {},
  };
  const service = new TrackVolumeNormalization(storage),
    audio = new Audio();
  service.remember({ id: 'quiet' }, 12);
  service.prepare(audio, { id: 'quiet' });
  const document = new EventTarget(),
    window = new EventTarget();
  document.hidden = false;
  const h = hookRuntime(
    new URL('../src/shared/hooks/useAudioSettings.ts', import.meta.url),
    {
      '../services/trackVolumeNormalization': { trackVolumeNormalization: () => service },
      '../utils/logger': { logger: { debug() {} } },
      '../utils/audioVolume': volumes,
      '../utils/crossfade': fade,
    },
    { document, window, localStorage: storage, setInterval, clearInterval },
  );
  h.render({ audioRef: { current: audio } });
  h.api().fadeIn(4);
  now = 2000;
  t.mock.timers.tick(25);
  near(audio.rawVolume, Math.SQRT1_2);
  h.unmount();
  near(audio.rawVolume, 1);
  service.release(audio);
});

test('Unmuting during overlap restores the outgoing decoder as well as the incoming decoder', (t) => {
  const f = setup(t, -6);
  f.outgoing.muted = true;
  f.incoming.muted = true;
  f.setVolume(0);
  f.tick(250);
  assert.equal(f.outgoing.rawVolume, 0);
  f.setVolume(0.03);
  f.incoming.muted = false;
  f.tick(25);
  assert.equal(f.outgoing.muted, false, 'The held decoder must not retain a stale mute flag');
  assert.ok(f.outgoing.rawVolume > 0);
  assert.ok(f.incoming.rawVolume > 0);
});

test('A stalled download does not freeze a transition that is still playing buffered audio', (t) => {
  const f = setup(t, -6);
  f.tick(1000);
  f.incoming.readyState = 4;
  f.incoming.dispatchEvent(new Event('stalled'));
  f.incoming.currentTime += 1;
  f.tick(1000);
  near(f.incoming.rawVolume, 0.8 * Math.pow(10, -6 / 20) * Math.SQRT1_2);
  f.tick(2000);
  assert.equal(f.completed(), 1);
  assert.equal(f.disposed(), 1);
});

test('After an output interruption canplay can resume the fade without a second playing event', (t) => {
  const f = setup(t, -6);
  f.tick(1000);
  f.incoming.readyState = 2;
  f.incoming.dispatchEvent(new Event('waiting'));
  f.tick(1000);
  f.incoming.readyState = 4;
  f.incoming.dispatchEvent(new Event('canplay'));
  f.tick(1000);
  near(f.incoming.rawVolume, 0.8 * Math.pow(10, -6 / 20) * Math.SQRT1_2);
  f.tick(2000);
  assert.equal(f.completed(), 1);
});

test('An outgoing decoder paused by an output interruption cannot prolong the incoming fade', (t) => {
  const f = setup(t, -6);
  f.tick(1000);
  f.outgoing.pause();
  f.tick(25);
  assert.equal(f.transition.active, false);
  near(f.incoming.rawVolume, 0.8 * Math.pow(10, -6 / 20));
  assert.equal(f.completed(), 1);
  assert.equal(f.disposed(), 1);
});
