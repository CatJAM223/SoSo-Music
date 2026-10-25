import { useEffect, useRef, useState } from 'react';
import type { AudioEqualizer } from '../../../shared/services/audioEqualizer';
import {
  EQUALIZER_PRESET_TIME_CONSTANT,
  type EqualizerSettings,
  type EqualizerResponse,
} from '../../../shared/utils/equalizer';

type Frame = { gains: readonly number[]; response: EqualizerResponse };
/** Animate locally: the animation never writes intermediate values to settings or storage. */
export function useEqualizerAnimation(
  service: AudioEqualizer,
  settings: EqualizerSettings,
  targetResponse: EqualizerResponse,
): Frame {
  const [frame, setFrame] = useState<Frame>({ gains: settings.gains, response: targetResponse });
  const displayed = useRef(frame);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = settings.enabled && service.getTransitionKind() === 'preset' && !reducedMotion;
  useEffect(() => {
    const target: Frame = { gains: settings.gains, response: targetResponse };
    if (!animate) {
      displayed.current = target;
      setFrame(target);
      return;
    }
    const origin = displayed.current.gains;
    if (origin.every((gain, index) => gain === settings.gains[index])) {
      displayed.current = target;
      setFrame(target);
      return;
    }
    const started = performance.now();
    const duration = EQUALIZER_PRESET_TIME_CONSTANT * 1000;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0;
    const finish = () => {
      cancelAnimationFrame(request);
      media.removeEventListener('change', onPreferenceChange);
      displayed.current = target;
      setFrame(target);
    };
    const tick = () => {
      const elapsed = Math.max(0, performance.now() - started);
      if (elapsed >= duration * 7 || media.matches) {
        finish();
        return;
      }
      // Follow the actual AudioParams when music is playing. Paused playback uses
      // the same exponential approach, so presets still flow into each other.
      const progress = 1 - Math.exp(-elapsed / duration);
      const gains =
        service.getLiveGains() ??
        origin.map((gain, index) => gain + (settings.gains[index] - gain) * progress);
      const next = { gains, response: service.responseForGains(gains) };
      displayed.current = next;
      setFrame(next);
      request = requestAnimationFrame(tick);
    };
    const onPreferenceChange = () => {
      if (media.matches) finish();
    };
    media.addEventListener('change', onPreferenceChange);
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      media.removeEventListener('change', onPreferenceChange);
    };
  }, [service, settings.gains, targetResponse, animate]);
  return animate ? frame : { gains: settings.gains, response: targetResponse };
}
