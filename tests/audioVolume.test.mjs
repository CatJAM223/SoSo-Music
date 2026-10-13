import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAudioVolume, clampAudioVolume } from '../src/shared/utils/audioVolume.ts';

test('Volume: muting and moving the slider restores audible playback', () => {
  const audio = { volume: 0.7, muted: false };
  applyAudioVolume(audio, 0.7, true);
  assert.deepEqual(audio, { volume: 0, muted: true });

  applyAudioVolume(audio, 0.4, false);
  assert.deepEqual(audio, { volume: 0.4, muted: false });
});

test('Volume: saved and incoming invalid values cannot reach the media element', () => {
  assert.equal(clampAudioVolume(Number('broken')), 0.8);
  assert.equal(clampAudioVolume(Infinity, 0.3), 0.3);
  assert.equal(clampAudioVolume(-1), 0);
  assert.equal(clampAudioVolume(2), 1);

  const audio = { volume: 0.5, muted: false };
  applyAudioVolume(audio, Number.NaN, false);
  assert.equal(audio.volume, 0.8);
});
