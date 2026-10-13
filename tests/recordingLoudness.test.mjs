import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RecordingLoudness,
  LoudnessProfiles,
  normalizationGain,
  recordingKey,
} from '../src/shared/utils/recordingLoudness.ts';
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

test('recording loudness: a 20 dB recording difference is cancelled by fixed gains', () => {
  const loud = new RecordingLoudness(),
    quiet = new RecordingLoudness();
  for (let i = 0; i < 80; i++) {
    loud.addPower(0.1);
    quiet.addPower(0.001);
  }
  near(quiet.gainDb() - loud.gainDb(), 20);
  near(
    Math.sqrt(0.001) * normalizationGain(quiet.gainDb()),
    Math.sqrt(0.1) * normalizationGain(loud.gainDb()),
  );
});
test('recording loudness: silence, corrupted samples and short fragments cannot produce a gain', () => {
  const m = new RecordingLoudness();
  for (let i = 0; i < 200; i++) for (const v of [0, -1, 1e-9, NaN, Infinity]) m.addPower(v);
  assert.equal(m.frames, 0);
  assert.equal(m.gainDb(), null);
  for (let i = 0; i < 15; i++) m.addPower(0.01);
  assert.equal(m.gainDb(), null);
  assert.equal(normalizationGain(NaN), 1);
  assert.ok(normalizationGain(100) <= normalizationGain(18));
});
test('recording loudness: quiet intros do not pull the average down when gated', () => {
  const gated = new RecordingLoudness(),
    body = new RecordingLoudness();
  for (let i = 0; i < 100; i++) {
    gated.addPower(0.00001);
    gated.addPower(0.01);
    body.addPower(0.01);
  }
  near(gated.gainDb(), body.gainDb());
  assert.equal(gated.counts.length, 96);
  assert.equal(gated.powers.length, 96);
});
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
