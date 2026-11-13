type VolumeTarget = Pick<HTMLAudioElement, 'muted' | 'volume'>;
type Envelope = {
  volume: number;
  factor: number;
  writer?: (volume: number, factor: number) => void;
};
const envelopes = new WeakMap<VolumeTarget, Envelope>();
const startupFades = new WeakMap<HTMLMediaElement, () => void>();
const STARTUP_FADE_MS = 64;

export function clampAudioVolume(value: number, fallback = 0.8): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** Keeps the user's volume separate from a transition's temporary envelope. */
export function setAudioFadeVolume(audio: VolumeTarget, volume: number, factor: number): void {
  const state = envelopes.get(audio) || { volume: 1, factor: 1 };
  state.volume = clampAudioVolume(volume);
  state.factor = clampAudioVolume(factor, 1);
  envelopes.set(audio, state);
  if (state.writer) state.writer(state.volume, state.factor);
  else audio.volume = state.volume * state.factor;
}

export function registerAudioVolumeWriter(
  audio: VolumeTarget,
  writer: (volume: number, factor: number) => void,
): void {
  const state = envelopes.get(audio) || { volume: audio.volume, factor: 1 };
  state.writer = writer;
  envelopes.set(audio, state);
}
export function releaseAudioVolumeWriter(audio: VolumeTarget): void {
  envelopes.delete(audio);
}

export function hasAudioStartupFade(audio: HTMLMediaElement): boolean {
  return startupFades.has(audio);
}

export function cancelAudioStartupFade(audio: HTMLMediaElement): void {
  startupFades.get(audio)?.();
}

/** Arm before play(), then ramp once decoded audio starts. */
export function armAudioStartupFade(audio: HTMLMediaElement, volume: number): void {
  cancelAudioStartupFade(audio);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    startupFades.delete(audio);
    audio.removeEventListener('playing', start);
    audio.removeEventListener('pause', pause);
    audio.removeEventListener('error', stop);
    audio.removeEventListener('ended', stop);
    clearTimeout(timer);
    resetAudioFadeVolume(audio);
  };
  const pause = () => {
    // Source replacement can leave a pause event queued after the new play() call.
    if (audio.paused) stop();
  };
  const start = () => {
    if (audio.paused) return;
    audio.removeEventListener('playing', start);
    const startedAt = performance.now();
    const step = () => {
      const progress = (performance.now() - startedAt) / STARTUP_FADE_MS;
      if (progress >= 1 || audio.paused) {
        stop();
        return;
      }
      setAudioFadeVolume(audio, envelopes.get(audio)?.volume ?? volume, progress);
      timer = setTimeout(step, 8);
    };
    timer = setTimeout(step, 8);
  };
  startupFades.set(audio, stop);
  setAudioFadeVolume(audio, volume, 0);
  audio.addEventListener('playing', start);
  audio.addEventListener('pause', pause);
  audio.addEventListener('error', stop);
  audio.addEventListener('ended', stop);
}
export function resetAudioFadeVolume(audio: VolumeTarget): void {
  const state = envelopes.get(audio);
  if (state) setAudioFadeVolume(audio, state.volume, 1);
}
export function isAudioFading(audio: VolumeTarget): boolean {
  return (envelopes.get(audio)?.factor ?? 1) < 1;
}

export function applyAudioVolume(
  audio: VolumeTarget | null,
  volume: number,
  isMuted: boolean,
): void {
  if (!audio) return;
  audio.muted = isMuted;
  setAudioFadeVolume(audio, isMuted ? 0 : volume, envelopes.get(audio)?.factor ?? 1);
}
