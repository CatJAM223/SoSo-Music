type VolumeTarget = Pick<HTMLAudioElement, 'muted' | 'volume'>;
type Envelope = {
  volume: number;
  factor: number;
  writer?: (volume: number, factor: number) => void;
};
const envelopes = new WeakMap<VolumeTarget, Envelope>();

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
