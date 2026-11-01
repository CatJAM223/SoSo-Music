import test from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime } from './helpers/hookRuntime.mjs';
import * as audioVolume from '../src/shared/utils/audioVolume.ts';
import * as crossfade from '../src/shared/utils/crossfade.ts';

import {
  calculateFadeInVolume,
  calculateFadeOutVolume,
  shouldTriggerNearEndFade,
} from '../src/shared/utils/crossfade.ts';

test('Playback settings clamp crossfade, persist it and restore the actual player setting', () => {
  const saved = new Map();
  const create = () => {
    const runtime = hookRuntime(
      new URL('../src/shared/hooks/useAudioSettings.ts', import.meta.url),
      {
        '../services/trackVolumeNormalization': {
          trackVolumeNormalization: () => ({ setEnabled() {} }),
        },
        '../utils/logger': { logger: { debug() {} } },
        '../utils/audioVolume': audioVolume,
        '../utils/crossfade': crossfade,
      },
      {
        window: new EventTarget(),
        document: new EventTarget(),
        localStorage: {
          getItem: (key) => saved.get(key) ?? null,
          setItem: (key, value) => saved.set(key, value),
        },
      },
    );
    runtime.render({ audioRef: { current: null } });
    return runtime;
  };
  const current = create();
  for (const [input, expected] of [
    [25, 12],
    [-4, 0],
    [4, 4],
  ]) {
    current.api().setCrossfadeDuration(input);
    current.render();
    assert.equal(current.api().crossfadeDuration, expected);
    assert.equal(current.api().crossfadeDurationRef.current, expected);
    assert.equal(saved.get('soso_crossfade_duration'), String(expected));
  }
  current.unmount();
  const restored = create();
  assert.equal(restored.api().crossfadeDuration, 4);
  assert.equal(restored.api().crossfadeDurationRef.current, 4);
  restored.unmount();
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
