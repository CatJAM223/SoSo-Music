import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LoudnessProfiles,
  normalizationGain,
  recordingKey,
} from '../src/shared/utils/recordingLoudness.ts';
import { setAudioFadeVolume } from '../src/shared/utils/audioVolume.ts';
import { TrackVolumeNormalization } from '../src/shared/services/trackVolumeNormalization.ts';

import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';

function storage(enabled = false) {
  const values = new Map([['soso_volume_normalization', String(enabled)]]);
  return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}
class FakeAudio extends EventTarget {
  rawVolume = 0.03;
  paused = true;
  readyState = 4;
  seeking = false;
  get volume() {
    return this.rawVolume;
  }
  set volume(value) {
    this.rawVolume = value;
  }
  start() {
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
}
const near = (a, b, margin = 1e-8) => assert.ok(Math.abs(a - b) < margin, a + ' ~= ' + b);

test('recording profiles: metadata only, bounded to 128 and expired after 30 days', () => {
  const st = storage();
  let now = 1000000;
  const p = new LoudnessProfiles(st, () => now);
  for (let i = 0; i < 300; i++) p.set('youtube:yt_' + i, 5);
  const raw = st.values.get(LoudnessProfiles.STORAGE_KEY),
    rows = JSON.parse(raw);
  assert.equal(rows.length, 128);
  assert.ok(raw.length < 14000);
  assert.equal(p.get('youtube:yt_0'), null);
  assert.equal(p.get('youtube:yt_299'), 5);
  assert.equal(new LoudnessProfiles(st, () => now).get('youtube:yt_299'), 5);
  now += 30 * 86400000;
  assert.equal(p.get('youtube:yt_299'), null);
  assert.equal(new LoudnessProfiles(st, () => now).get('youtube:yt_299'), null);
  p.set('', 5);
  p.set('bad', NaN);
  assert.equal(p.get('bad'), null);
});
test('recording profiles: corrupted or unavailable storage leaves normal playback usable', () => {
  for (const raw of ['{', JSON.stringify([['bad', { db: Infinity, at: 0 }]]), 'x'.repeat(40001)]) {
    const p = new LoudnessProfiles({
      getItem: () => raw,
      setItem: () => {
        throw Error('full');
      },
    });
    assert.equal(p.get('bad'), null);
    p.set('safe', 1);
    assert.equal(p.get('safe'), 1);
  }
  const p = new LoudnessProfiles({
    getItem: () => {
      throw Error('denied');
    },
    setItem: () => {
      throw Error('denied');
    },
  });
  p.set('ok', 2);
  assert.equal(p.get('ok'), 2);
  assert.equal(recordingKey({ id: 'yt_demo' }), 'youtube:yt_demo');
  assert.equal(recordingKey({ id: 123, source: 'soundcloud' }), 'soundcloud:123');
});
test('normalization: warm gain preserves 3% slider, mute and existing fade volumes', () => {
  const service = new TrackVolumeNormalization(storage(true)),
    a = new FakeAudio();
  service.remember({ id: 'yt_warm' }, -6);
  service.prepare(a, { id: 'yt_warm' });
  near(a.volume, 0.03);
  near(a.rawVolume, 0.03 * normalizationGain(-6));
  a.volume = 0;
  assert.equal(a.rawVolume, 0);
  a.volume = 0.01;
  near(a.rawVolume, 0.01 * normalizationGain(-6));
  a.volume = 0.03;
  a.start();
  near(a.rawVolume, 0.03 * normalizationGain(-6));
  service.setEnabled(false);
  near(a.rawVolume, 0.03);
  service.setEnabled(true);
  near(a.rawVolume, 0.03 * normalizationGain(-6));
  service.release(a);
  near(a.volume, 0.03);
  assert.equal(Object.hasOwn(a, 'volume'), false);
});
test('normalization: late metadata and pause/resume never change the current song gain', () => {
  const service = new TrackVolumeNormalization(storage(true)),
    a = new FakeAudio();
  service.prepare(a, { id: 'yt_first' });
  a.start();
  const original = a.rawVolume;
  service.remember({ id: 'yt_first' }, -10);
  assert.equal(a.rawVolume, original);
  assert.equal(service.getGain(a), 1);
  a.pause();
  a.start();
  assert.equal(a.rawVolume, original);
  a.pause();
  service.prepare(a, { id: 'yt_first' });
  near(a.rawVolume, original * normalizationGain(-10));
  service.release(a);
});
test('normalization: available provider gain is applied before the first playing event', () => {
  const service = new TrackVolumeNormalization(storage(true)),
    a = new FakeAudio();
  service.prepare(a, { id: 'yt_provider' });
  service.remember({ id: 'yt_provider' }, -4);
  a.start();
  near(a.rawVolume, 0.03 * normalizationGain(-4));
  service.release(a);
});
test('normalization: switched tracks cannot inherit the preceding recording gain', () => {
  const service = new TrackVolumeNormalization(storage(true)),
    a = new FakeAudio();
  service.remember({ id: 'yt_prev' }, -10);
  service.prepare(a, { id: 'yt_prev' });
  a.start();
  a.pause();
  service.prepare(a, { id: 'yt_new' });
  a.start();
  near(a.rawVolume, 0.03);
  service.remember({ id: 'yt_prev' }, 6);
  near(a.rawVolume, 0.03);
  service.release(a);
});
test('normalization: boosts are bounded by volume 1 without corrupting the logical slider', () => {
  const service = new TrackVolumeNormalization(storage(true)),
    a = new FakeAudio();
  service.remember({ id: 'yt_quiet' }, 18);
  service.prepare(a, { id: 'yt_quiet' });
  a.volume = 0.8;
  assert.equal(a.rawVolume, 1);
  near(a.volume, 0.8);
  assert.throws(() => {
    a.volume = NaN;
  }, RangeError);
  near(a.volume, 0.8);
  service.release(a);
});
test('normalization: default-off does not create a meter or alter output', () => {
  const service = new TrackVolumeNormalization(storage()),
    a = new FakeAudio();
  let captured = 0;
  a.captureStream = () => {
    captured++;
    throw Error('must not run');
  };
  service.remember({ id: 'yt_saved' }, -9);
  service.prepare(a, { id: 'yt_saved' });
  a.start();
  near(a.rawVolume, 0.03);
  assert.equal(captured, 0);
  service.release(a);
});
test('normalization: context construction failure releases captured tracks and preserves audio', () => {
  const previous = globalThis.AudioContext;
  let stopped = 0;
  globalThis.AudioContext = class {
    constructor() {
      throw Error('no context');
    }
  };
  try {
    const service = new TrackVolumeNormalization(storage(true)),
      a = new FakeAudio();
    a.captureStream = () => ({ getTracks: () => [{ stop: () => stopped++ }] });
    service.prepare(a, { id: 'yt_fail' });
    a.start();
    assert.equal(stopped, 1);
    near(a.rawVolume, 0.03);
    service.release(a);
  } finally {
    globalThis.AudioContext = previous;
  }
});

test('YouTube recording loudness: optional numeric metadata accompanies the existing stream resolution', async (t) => {
  const original = YouTubeMusicTransport.postPlayer;
  const oldGain = YouTubeMusicService.recordingGain,
    oldVisitor = YouTubeMusicService.cachedVisitorData;
  YouTubeMusicService.cachedVisitorData = { visitorData: 'fixture', expiresAt: Date.now() + 60000 };
  YouTubeMusicService.recordingGain = new Map();
  t.after(() => {
    YouTubeMusicTransport.postPlayer = original;
    YouTubeMusicService.recordingGain = oldGain;
    YouTubeMusicService.cachedVisitorData = oldVisitor;
  });
  for (const [id, loudness, expected] of [
    ['normtrack01', 8, -8],
    ['normtrack02', -4, 4],
    ['normtrack03', undefined, undefined],
    ['normtrack04', '8', undefined],
  ]) {
    YouTubeMusicTransport.postPlayer = async () =>
      Response.json({
        playabilityStatus: { status: 'OK' },
        playerConfig: { audioConfig: { loudnessDb: loudness } },
        videoDetails: { lengthSeconds: '180' },
        streamingData: {
          adaptiveFormats: [
            {
              itag: 140,
              url: 'https://test.googlevideo.com/' + id,
              mimeType: 'audio/mp4',
              bitrate: 128000,
            },
          ],
        },
      });
    const result = await YouTubeMusicService.resolveDirectAudioStream(id);
    assert.ok(result.includes(id));
    assert.equal(YouTubeMusicService.getRecordingGain('yt_' + id), expected);
  }
});

test('normalization: graph gain preserves high slider and equal-power envelopes without saturation', () => {
  const gains = new Map();
  const service = new TrackVolumeNormalization(storage(true), (audio, gain) => {
    gains.set(audio, gain);
    return true;
  });
  const a = new FakeAudio();
  service.remember({ id: 'quiet-graph' }, 18);
  service.prepare(a, { id: 'quiet-graph' });
  a.volume = 0.8;
  near(a.rawVolume, 0.8);
  near(gains.get(a), normalizationGain(18));
  setAudioFadeVolume(a, 0.8, Math.SQRT1_2);
  near(a.rawVolume, 0.8 * Math.SQRT1_2);
  service.setEnabled(false);
  near(gains.get(a), 1);
  near(a.rawVolume, 0.8 * Math.SQRT1_2);
  service.setEnabled(true);
  near(gains.get(a), normalizationGain(18));
  near(a.rawVolume, 0.8 * Math.SQRT1_2);
  setAudioFadeVolume(a, 0, 0.5);
  near(a.rawVolume, 0);
  service.release(a);
  near(gains.get(a), 1);
  assert.equal(Object.hasOwn(a, 'volume'), false);
});

test('normalization: an unavailable output graph keeps the bounded native fallback audible', () => {
  const service = new TrackVolumeNormalization(storage(true), () => false);
  const a = new FakeAudio();
  service.remember({ id: 'fallback' }, 18);
  service.prepare(a, { id: 'fallback' });
  setAudioFadeVolume(a, 0.8, 0.5);
  near(a.rawVolume, 0.5);
  near(a.volume, 0.4);
  service.setEnabled(false);
  near(a.rawVolume, 0.4);
  service.release(a);
});

async function workletHarness(t) {
  const previous = {
    AudioContext: globalThis.AudioContext,
    AudioWorkletNode: globalThis.AudioWorkletNode,
    document: globalThis.document,
  };
  t.after(() => Object.assign(globalThis, previous));
  const nodes = [],
    contexts = [];
  let stopped = 0;
  globalThis.document = { baseURI: 'file:///fixture/index.html' };
  globalThis.AudioContext = class {
    state = 'running';
    destination = {};
    audioWorklet = {
      addModule: async (url) => assert.ok(url.endsWith('/compute/soso-normalization.js')),
    };
    constructor() {
      contexts.push(this);
    }
    async resume() {
      this.state = 'running';
    }
    async suspend() {
      this.state = 'suspended';
    }
    async close() {
      this.state = 'closed';
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
  };
  globalThis.AudioWorkletNode = class {
    port = { onmessage: null, postMessage() {}, close() {} };
    constructor() {
      nodes.push(this);
    }
    connect() {}
    disconnect() {}
  };
  const st = storage(true),
    service = new TrackVolumeNormalization(st),
    audio = new FakeAudio();
  audio.captureStream = () => ({ getTracks: () => [{ stop: () => stopped++ }] });
  service.prepare(audio, { id: 'capture' });
  audio.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes.length, 1);
  t.after(() => service.release(audio));
  return { service, audio, st, node: nodes[0], contexts, nodes, stopped: () => stopped };
}
test('normalization worklet: processor failure releases analysis and preserves the current playback volume', async (t) => {
  const h = await workletHarness(t),
    volume = h.audio.rawVolume;
  h.node.onprocessorerror();
  assert.equal(h.contexts[0].state, 'closed');
  assert.equal(h.stopped(), 1);
  near(h.audio.rawVolume, volume);
});
test('normalization worklet: stale results cannot write a profile for a new recording', async (t) => {
  const h = await workletHarness(t),
    late = h.node.port.onmessage;
  h.audio.pause();
  h.service.prepare(h.audio, { id: 'new-recording' });
  late({ data: { type: 'stats', stats: { gainDb: -15, blocks: 40, samples: 200000 } } });
  const saved = JSON.parse(h.st.values.get(LoudnessProfiles.STORAGE_KEY) || '[]');
  assert.equal(saved.length, 0);
  assert.equal(h.service.getGain(h.audio), 1);
  assert.equal(h.stopped(), 1);
});
test('normalization worklet: provider metadata supersedes sampled profiles without mid-song gain changes', async (t) => {
  const h = await workletHarness(t),
    late = h.node.port.onmessage;
  late({ data: { type: 'stats', stats: { gainDb: 5, blocks: 40, samples: 200000 } } });
  h.service.remember({ id: 'capture' }, -4);
  late({ data: { type: 'stats', stats: { gainDb: 12, blocks: 45, samples: 240000 } } });
  assert.equal(new LoudnessProfiles(h.st).get('soundcloud:capture'), -4);
  assert.equal(h.service.getGain(h.audio), 1);
  assert.equal(h.stopped(), 1);
});
test('normalization worklet: a ready processor that stops reporting is bounded by the watchdog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await workletHarness(t);
  h.node.port.onmessage({ data: { type: 'ready' } });
  t.mock.timers.tick(15001);
  assert.equal(h.stopped(), 1);
  assert.equal(h.contexts[0].state, 'closed');
  near(h.audio.rawVolume, 0.03);
});
test('recording profiles: legacy approximate loudness profiles are not reused by the new meter', () => {
  const st = storage();
  st.values.set(
    'soso_recording_loudness_v1',
    JSON.stringify([['youtube:old', { db: 18, at: Date.now() }]]),
  );
  assert.equal(new LoudnessProfiles(st).get('youtube:old'), null);
});
