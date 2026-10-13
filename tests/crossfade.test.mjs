import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampCrossfadeDuration,
  calculateFadeInVolume,
  calculateFadeOutVolume,
  shouldTriggerNearEndFade,
} from '../src/shared/utils/crossfade.ts';

test('Crossfade: Duration clamping between 0 and 12 seconds', () => {
  assert.equal(clampCrossfadeDuration(-5), 0);
  assert.equal(clampCrossfadeDuration(0), 0);
  assert.equal(clampCrossfadeDuration(3), 3);
  assert.equal(clampCrossfadeDuration(8), 8);
  assert.equal(clampCrossfadeDuration(12), 12);
  assert.equal(clampCrossfadeDuration(25), 12);
});

test('Crossfade: Smooth Sinusoidal Fade-In curve starts at 0 and reaches target volume', () => {
  const targetVol = 0.8;
  const vol0 = calculateFadeInVolume(targetVol, 0.0);
  const vol25 = calculateFadeInVolume(targetVol, 0.25);
  const vol50 = calculateFadeInVolume(targetVol, 0.5);
  const vol75 = calculateFadeInVolume(targetVol, 0.75);
  const vol100 = calculateFadeInVolume(targetVol, 1.0);

  assert.equal(vol0, 0);
  assert.ok(vol25 > vol0, 'Progress 0.25 must be louder than 0.0');
  assert.ok(vol50 > vol25, 'Progress 0.50 must be louder than 0.25');
  assert.ok(vol75 > vol50, 'Progress 0.75 must be louder than 0.50');
  assert.ok(Math.abs(vol100 - targetVol) < 0.0001, 'Progress 1.0 must reach target volume');
});

test('Crossfade: Smooth Sinusoidal Fade-Out curve starts at current volume and reaches 0', () => {
  const startVol = 0.9;
  const vol0 = calculateFadeOutVolume(startVol, 0.0);
  const vol25 = calculateFadeOutVolume(startVol, 0.25);
  const vol50 = calculateFadeOutVolume(startVol, 0.5);
  const vol75 = calculateFadeOutVolume(startVol, 0.75);
  const vol100 = calculateFadeOutVolume(startVol, 1.0);

  assert.ok(Math.abs(vol0 - startVol) < 0.0001, 'Progress 0.0 must equal start volume');
  assert.ok(vol25 < vol0, 'Progress 0.25 must be quieter than 0.0');
  assert.ok(vol50 < vol25, 'Progress 0.50 must be quieter than 0.25');
  assert.ok(vol75 < vol50, 'Progress 0.75 must be quieter than 0.50');
  assert.ok(Math.abs(vol100) < 0.0001, 'Progress 1.0 must reach 0');
});

test('Crossfade: Track near-end fade trigger conditions', () => {
  const duration = 180; // 3 min track
  const crossfadeSec = 4;

  // Before fade zone: 170s
  assert.equal(shouldTriggerNearEndFade(170, duration, crossfadeSec, false), false);

  // Exactly at boundary: 176s (180 - 4)
  assert.equal(shouldTriggerNearEndFade(176, duration, crossfadeSec, false), true);

  // Inside fade zone: 178s
  assert.equal(shouldTriggerNearEndFade(178, duration, crossfadeSec, false), true);

  // Already crossfading should not trigger duplicate fade
  assert.equal(shouldTriggerNearEndFade(178, duration, crossfadeSec, true), false);

  // When crossfade is disabled (0s)
  assert.equal(shouldTriggerNearEndFade(179, duration, 0, false), false);

  // Very short audio snippets (<15s) shouldn't fade out prematurely
  assert.equal(shouldTriggerNearEndFade(11, 12, 3, false), false);
});

test('Crossfade: paused playback, repeat-one and end-of-track sleep timer never advance early', () => {
  const position = 178;
  const duration = 180;
  const fadeSeconds = 4;
  assert.equal(
    shouldTriggerNearEndFade(position, duration, fadeSeconds, false, {
      isPlaying: false,
      repeatOne: false,
      stopAtEnd: false,
    }),
    false,
  );
  assert.equal(
    shouldTriggerNearEndFade(position, duration, fadeSeconds, false, {
      isPlaying: true,
      repeatOne: true,
      stopAtEnd: false,
    }),
    false,
  );
  assert.equal(
    shouldTriggerNearEndFade(position, duration, fadeSeconds, false, {
      isPlaying: true,
      repeatOne: false,
      stopAtEnd: true,
    }),
    false,
  );
  assert.equal(
    shouldTriggerNearEndFade(position, duration, fadeSeconds, false, {
      isPlaying: true,
      repeatOne: false,
      stopAtEnd: false,
    }),
    true,
  );
});
