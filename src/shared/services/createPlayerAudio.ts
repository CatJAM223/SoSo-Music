import { audioEqualizer } from './audioEqualizer.ts';
import type { Track } from '../types/index.ts';
import { trackVolumeNormalization } from './trackVolumeNormalization';

export function createPlayerAudio(): HTMLAudioElement {
  const audio = new Audio();
  if (typeof window !== 'undefined' && window.electronAPI) audio.crossOrigin = 'anonymous';
  trackVolumeNormalization().attach(audio);
  audioEqualizer().attach(audio);
  return audio;
}

export function preparePlayerAudio(audio: HTMLAudioElement, track: Track): void {
  trackVolumeNormalization().prepare(audio, track);
}

export function releasePlayerAudio(audio: HTMLAudioElement): void {
  trackVolumeNormalization().release(audio);
  audioEqualizer().release(audio);
}
