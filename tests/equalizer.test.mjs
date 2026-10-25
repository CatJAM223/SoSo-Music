import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUALIZER_PRESETS,
  readEqualizerSettings,
  equalizerResponse,
} from '../src/shared/utils/equalizer.ts';
import { AudioEqualizer } from '../src/shared/services/audioEqualizer.ts';

test('equalizer: corrupt storage and non-finite bands recover to a neutral profile', () => {
  for (const value of [
    null,
    '{broken',
    'null',
    '[]',
    '{"gains":[]}',
    JSON.stringify({ gains: Array(10).fill('5') }),
    '{"gains":[0,0,0,0,0,0,0,0,0,1e400]}',
  ]) {
    const settings = readEqualizerSettings(value);
    assert.equal(settings.presetId, 'flat');
    assert.ok(settings.gains.every((gain) => gain === 0));
  }
  const saved = readEqualizerSettings(
    JSON.stringify({ enabled: false, gains: [-50, 50, 0.8, 0, 0, 0, 0, 0, 0, 0] }),
  );
  assert.equal(saved.enabled, false);
  assert.deepEqual(saved.gains.slice(0, 3), [-12, 12, 1]);
});
test('equalizer: neutral is unity; boost/cut filters are inverse at every plotted frequency', () => {
  for (const rate of [32000, 44100, 48000, 96000]) {
    const flat = equalizerResponse(Array(10).fill(0), rate);
    assert.equal(flat.headroomDb, 0);
    assert.ok(flat.db.every((db) => Math.abs(db) < 1e-7));
    const gains = [12, -8, 6, -3, 5, -11, 7, 2, -4, 9];
    const positive = equalizerResponse(gains, rate),
      negative = equalizerResponse(
        gains.map((gain) => -gain),
        rate,
      );
    assert.ok(
      positive.db.every((db, i) => Number.isFinite(db) && Math.abs(db + negative.db[i]) < 1e-5),
    );
    assert.ok(positive.db.every((db) => db + positive.headroomDb < 0.001));
  }
});
test('equalizer: headroom includes overlapping bands, and presets stay within the control range', () => {
  const response = equalizerResponse(Array(10).fill(6));
  assert.ok(
    response.headroomDb < -7,
    'overlapping filters need more headroom than a single +6 dB slider',
  );
  for (const preset of EQUALIZER_PRESETS) {
    assert.equal(preset.gains.length, 10);
    assert.ok(preset.gains.every((gain) => gain >= -12 && gain <= 12));
    assert.equal(
      readEqualizerSettings(JSON.stringify({ gains: preset.gains })).presetId,
      preset.id,
    );
  }
});
test('equalizer: edits persist, invalid controls are ignored, bypass preserves the curve', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const service = new AudioEqualizer(storage);
  let notifications = 0;
  const unsubscribe = service.subscribe(() => notifications++);
  service.selectPreset('headphones');
  service.setBandGain(5, 3.6);
  service.setEnabled(false);
  const saved = service.getSnapshot();
  assert.equal(saved.gains[5], 3.5);
  assert.equal(saved.presetId, 'custom');
  assert.deepEqual(new AudioEqualizer(storage).getSnapshot(), saved);
  for (const [index, value] of [
    [-1, 4],
    [10, 4],
    [1.5, 4],
    [2, NaN],
    [2, Infinity],
  ])
    service.setBandGain(index, value);
  service.selectPreset('invalid');
  assert.equal(notifications, 3);
  assert.deepEqual(service.getSnapshot(), saved);
  unsubscribe();
  service.selectPreset('flat');
  assert.equal(notifications, 3);
});
